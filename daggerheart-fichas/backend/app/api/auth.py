from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.errors import api_error
from app.core import audit_actions
from app.core.config import Settings, get_settings
from app.core.cookie_security import delete_hardened_cookie, set_hardened_cookie
from app.core.csrf import clear_csrf_cookie, issue_csrf_token
from app.core.observability import log_event
from app.core.security import (
    expires_after_days,
    generate_session_token,
    hash_password,
    hash_session_token,
    password_hash_needs_rehash,
    utc_now,
    verify_password,
)
from app.db.session import get_db_session
from app.models.refresh_session import RefreshSession
from app.models.user import User
from app.schemas.auth import (
    CsrfTokenResponse,
    CurrentUserResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RegisterRequest,
    UserPublic,
)
from app.services import audit_service
from app.services.rate_limit_service import (
    enforce_auth_attempt_rate_limit,
    enforce_read_rate_limit_for_user,
)
from app.services.share_target_service import (
    PendingShareActivationResult,
    activate_pending_shares_for_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_agent(request: Request, *, max_length: int) -> str | None:
    value = request.headers.get("user-agent")
    if not value:
        return None
    return value[:max_length]


def validate_auth_device_id(device_id: str | None, *, settings: Settings) -> None:
    if device_id is None or len(device_id) <= settings.max_device_id_length:
        return
    raise api_error(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "INVALID_DEVICE_ID",
        "deviceId exceeds the configured maximum length.",
        {
            "maxLength": settings.max_device_id_length,
            "actualLength": len(device_id),
        },
    )


def set_refresh_cookie(
    response: Response,
    *,
    settings: Settings,
    token: str,
    expires_at: datetime,
) -> None:
    max_age = max(0, int((expires_at - utc_now()).total_seconds()))
    set_hardened_cookie(
        response,
        settings=settings,
        key=settings.effective_session_cookie_name,
        value=token,
        max_age=max_age,
        expires=max_age,
    )


def clear_session_cookies(response: Response, *, settings: Settings) -> None:
    clear_refresh_cookie(response, settings=settings)
    clear_csrf_cookie(response, settings=settings)


def issue_session_csrf_token(
    response: Response,
    *,
    settings: Settings,
    session_token: str,
    expires_at: datetime,
) -> str:
    return issue_csrf_token(
        response,
        settings=settings,
        session_token=session_token,
        expires_at=expires_at,
    )


def clear_refresh_cookie(response: Response, *, settings: Settings) -> None:
    delete_hardened_cookie(
        response,
        settings=settings,
        key=settings.effective_session_cookie_name,
    )


async def find_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == normalize_email(email)))
    return result.scalar_one_or_none()


async def create_refresh_session(
    session: AsyncSession,
    *,
    settings: Settings,
    user: User,
    raw_token: str,
    device_id: str | None,
    user_agent: str | None,
) -> RefreshSession:
    refresh_session = RefreshSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token, settings.session_secret),
        device_id=device_id,
        user_agent=user_agent,
        expires_at=expires_after_days(settings.session_duration_days),
    )
    session.add(refresh_session)
    await session.flush()
    return refresh_session


async def get_active_refresh_session(
    session: AsyncSession,
    *,
    settings: Settings,
    token: str | None,
) -> RefreshSession | None:
    if not token:
        return None

    result = await session.execute(
        select(RefreshSession)
        .options(selectinload(RefreshSession.user))
        .where(
            RefreshSession.token_hash == hash_session_token(token, settings.session_secret),
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > utc_now(),
        )
    )
    return result.scalar_one_or_none()


async def revoke_refresh_session(session: AsyncSession, refresh_session: RefreshSession) -> None:
    refresh_session.revoked_at = utc_now()
    session.add(refresh_session)
    await session.flush()


async def activate_pending_shares_after_auth(
    session: AsyncSession,
    *,
    user: User,
) -> PendingShareActivationResult | None:
    """Activate pending shares without making authentication depend on it.

    A nested transaction isolates stale data or a temporarily unavailable sharing
    table from the login/registration transaction. A later login can retry the
    activation because the operation is idempotent.
    """
    try:
        async with session.begin_nested():
            result = await activate_pending_shares_for_user(session, user=user)
    except SQLAlchemyError:
        log_event(
            logger,
            logging.ERROR,
            "character.share_activation.failed",
            exc_info=True,
        )
        return None

    if result.changed_count:
        log_event(
            logger,
            logging.INFO,
            "character.share_activation.completed",
            activatedCount=len(result.activated),
            supersededCount=len(result.superseded),
        )
    return result


async def append_share_activation_audits(
    session: AsyncSession,
    *,
    user: User,
    result: PendingShareActivationResult | None,
    source: str,
    settings: Settings,
) -> None:
    if result is None:
        return
    for share in result.activated:
        await audit_service.append_audit_event(
            session,
            action=audit_actions.CHARACTER_SHARE_ACCEPTED,
            actor_user_id=user.id,
            target_user_id=user.id,
            character_id=share.character_id,
            resource_type="character_share",
            resource_id=share.id,
            metadata={"activationSource": source},
            settings=settings,
        )


@router.post(
    "/register",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    input_data: RegisterRequest,
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
) -> LoginResponse:
    validate_auth_device_id(input_data.device_id, settings=settings)
    await enforce_auth_attempt_rate_limit(
        request,
        response,
        identity=normalize_email(input_data.email),
        settings=settings,
    )
    existing_user = await find_user_by_email(session, input_data.email)
    if existing_user is not None:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
        )

    user = User(
        email=normalize_email(input_data.email),
        password_hash=hash_password(input_data.password),
        display_name=input_data.display_name,
    )
    session.add(user)

    raw_token = generate_session_token()

    try:
        await session.flush()
        refresh_session = await create_refresh_session(
            session,
            settings=settings,
            user=user,
            raw_token=raw_token,
            device_id=input_data.device_id,
            user_agent=get_user_agent(request, max_length=settings.audit_user_agent_max_length),
        )
        activation_result = await activate_pending_shares_after_auth(session, user=user)
        await audit_service.append_audit_event(
            session,
            action=audit_actions.AUTH_REGISTERED,
            actor_user_id=user.id,
            resource_type="user",
            resource_id=user.id,
            device_id=input_data.device_id,
            metadata={
                "activatedShareCount": len(activation_result.activated)
                if activation_result is not None
                else 0
            },
            settings=settings,
        )
        await append_share_activation_audits(
            session,
            user=user,
            result=activation_result,
            source="register",
            settings=settings,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(
            status.HTTP_409_CONFLICT,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
        ) from exc

    await session.refresh(user)
    set_refresh_cookie(
        response,
        settings=settings,
        token=raw_token,
        expires_at=refresh_session.expires_at,
    )
    issue_session_csrf_token(
        response,
        settings=settings,
        session_token=raw_token,
        expires_at=refresh_session.expires_at,
    )

    return LoginResponse(
        user=UserPublic.model_validate(user),
        expires_at=refresh_session.expires_at,
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    input_data: LoginRequest,
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
) -> LoginResponse:
    validate_auth_device_id(input_data.device_id, settings=settings)
    await enforce_auth_attempt_rate_limit(
        request,
        response,
        identity=normalize_email(input_data.email),
        settings=settings,
    )
    user = await find_user_by_email(session, input_data.email)

    if user is None or not verify_password(input_data.password, user.password_hash):
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
        )

    if password_hash_needs_rehash(user.password_hash):
        user.password_hash = hash_password(input_data.password)
        session.add(user)

    raw_token = generate_session_token()
    refresh_session = await create_refresh_session(
        session,
        settings=settings,
        user=user,
        raw_token=raw_token,
        device_id=input_data.device_id,
        user_agent=get_user_agent(request, max_length=settings.audit_user_agent_max_length),
    )
    activation_result = await activate_pending_shares_after_auth(session, user=user)
    await audit_service.append_audit_event(
        session,
        action=audit_actions.AUTH_LOGIN,
        actor_user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        device_id=input_data.device_id,
        metadata={
            "activatedShareCount": len(activation_result.activated)
            if activation_result is not None
            else 0
        },
        settings=settings,
    )
    await append_share_activation_audits(
        session,
        user=user,
        result=activation_result,
        source="login",
        settings=settings,
    )
    await session.commit()
    await session.refresh(user)

    set_refresh_cookie(
        response,
        settings=settings,
        token=raw_token,
        expires_at=refresh_session.expires_at,
    )
    issue_session_csrf_token(
        response,
        settings=settings,
        session_token=raw_token,
        expires_at=refresh_session.expires_at,
    )

    return LoginResponse(
        user=UserPublic.model_validate(user),
        expires_at=refresh_session.expires_at,
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_session(
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
    refresh_token: Annotated[str | None, Cookie(alias="daggerheart_refresh_token")] = None,
) -> LoginResponse:
    await enforce_auth_attempt_rate_limit(
        request,
        response,
        identity="session-refresh",
        settings=settings,
    )
    # The Cookie dependency cannot use a runtime cookie name,
    # so read manually when configured differently.
    refresh_token = request.cookies.get(settings.effective_session_cookie_name) or refresh_token
    active_session = await get_active_refresh_session(
        session,
        settings=settings,
        token=refresh_token,
    )

    if active_session is None:
        clear_session_cookies(response, settings=settings)
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "SESSION_EXPIRED",
            "Your session has expired. Please sign in again.",
        )

    await revoke_refresh_session(session, active_session)

    raw_token = generate_session_token()
    new_session = await create_refresh_session(
        session,
        settings=settings,
        user=active_session.user,
        raw_token=raw_token,
        device_id=active_session.device_id,
        user_agent=get_user_agent(request, max_length=settings.audit_user_agent_max_length),
    )
    await audit_service.append_audit_event(
        session,
        action=audit_actions.AUTH_SESSION_REFRESHED,
        actor_user_id=active_session.user.id,
        resource_type="refresh_session",
        resource_id=new_session.id,
        device_id=active_session.device_id,
        settings=settings,
    )
    await session.commit()

    set_refresh_cookie(
        response,
        settings=settings,
        token=raw_token,
        expires_at=new_session.expires_at,
    )
    issue_session_csrf_token(
        response,
        settings=settings,
        session_token=raw_token,
        expires_at=new_session.expires_at,
    )

    return LoginResponse(
        user=UserPublic.model_validate(active_session.user),
        expires_at=new_session.expires_at,
    )


@router.get("/csrf", response_model=CsrfTokenResponse)
async def get_csrf_token(
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
) -> CsrfTokenResponse:
    session_token = request.cookies.get(settings.effective_session_cookie_name)
    active_session = await get_active_refresh_session(
        session,
        settings=settings,
        token=session_token,
    )
    if active_session is None or session_token is None:
        clear_session_cookies(response, settings=settings)
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "SESSION_EXPIRED",
            "Your session has expired. Please sign in again.",
        )

    rate_limit_user_id = getattr(active_session, "user_id", None)
    if rate_limit_user_id is None:
        active_user = getattr(active_session, "user", None)
        rate_limit_user_id = getattr(active_user, "id", None)
    if rate_limit_user_id is not None:
        await enforce_read_rate_limit_for_user(
            request,
            response,
            user_id=rate_limit_user_id,
            settings=settings,
        )
    token = issue_session_csrf_token(
        response,
        settings=settings,
        session_token=session_token,
        expires_at=active_session.expires_at,
    )
    return CsrfTokenResponse(csrfToken=token)


@router.get("/me", response_model=CurrentUserResponse)
async def me(
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
) -> CurrentUserResponse:
    active_session = await get_active_refresh_session(
        session,
        settings=settings,
        token=request.cookies.get(settings.effective_session_cookie_name),
    )

    if active_session is None:
        clear_session_cookies(response, settings=settings)
        return CurrentUserResponse(user=None)

    await enforce_read_rate_limit_for_user(
        request,
        response,
        user_id=active_session.user.id,
        settings=settings,
    )
    session_token = request.cookies.get(settings.effective_session_cookie_name)
    if session_token is not None:
        issue_session_csrf_token(
            response,
            settings=settings,
            session_token=session_token,
            expires_at=active_session.expires_at,
        )
    return CurrentUserResponse(user=UserPublic.model_validate(active_session.user))


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
) -> LogoutResponse:
    active_session = await get_active_refresh_session(
        session,
        settings=settings,
        token=request.cookies.get(settings.effective_session_cookie_name),
    )

    if active_session is not None:
        await revoke_refresh_session(session, active_session)
        await audit_service.append_audit_event(
            session,
            action=audit_actions.AUTH_LOGOUT,
            actor_user_id=active_session.user.id,
            resource_type="refresh_session",
            resource_id=active_session.id,
            device_id=active_session.device_id,
            settings=settings,
        )
        await session.commit()

    clear_session_cookies(response, settings=settings)
    return LogoutResponse(ok=True)
