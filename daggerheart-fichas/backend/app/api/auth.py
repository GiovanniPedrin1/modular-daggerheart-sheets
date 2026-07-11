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
from app.core.config import Settings, get_settings
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
    CurrentUserResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RegisterRequest,
    UserPublic,
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


def get_user_agent(request: Request) -> str | None:
    value = request.headers.get("user-agent")
    if not value:
        return None
    return value[:512]


def set_refresh_cookie(
    response: Response,
    *,
    settings: Settings,
    token: str,
    expires_at: datetime,
) -> None:
    max_age = max(0, int((expires_at - utc_now()).total_seconds()))
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        expires=max_age,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_refresh_cookie(response: Response, *, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite="lax",
        path="/",
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
        logger.exception(
            "Could not activate pending character shares after authentication",
            extra={"user_id": str(user.id)},
        )
        return None

    if result.changed_count:
        logger.info(
            "Activated pending character shares after authentication",
            extra={
                "user_id": str(user.id),
                "activated_count": len(result.activated),
                "superseded_count": len(result.superseded),
            },
        )
    return result


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
            user_agent=get_user_agent(request),
        )
        await activate_pending_shares_after_auth(session, user=user)
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
        user_agent=get_user_agent(request),
    )
    await activate_pending_shares_after_auth(session, user=user)
    await session.commit()
    await session.refresh(user)

    set_refresh_cookie(
        response,
        settings=settings,
        token=raw_token,
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
    # The Cookie dependency cannot use a runtime cookie name,
    # so read manually when configured differently.
    refresh_token = request.cookies.get(settings.session_cookie_name) or refresh_token
    active_session = await get_active_refresh_session(
        session,
        settings=settings,
        token=refresh_token,
    )

    if active_session is None:
        clear_refresh_cookie(response, settings=settings)
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
        user_agent=get_user_agent(request),
    )
    await session.commit()

    set_refresh_cookie(
        response,
        settings=settings,
        token=raw_token,
        expires_at=new_session.expires_at,
    )

    return LoginResponse(
        user=UserPublic.model_validate(active_session.user),
        expires_at=new_session.expires_at,
    )


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
        token=request.cookies.get(settings.session_cookie_name),
    )

    if active_session is None:
        clear_refresh_cookie(response, settings=settings)
        return CurrentUserResponse(user=None)

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
        token=request.cookies.get(settings.session_cookie_name),
    )

    if active_session is not None:
        await revoke_refresh_session(session, active_session)
        await session.commit()

    clear_refresh_cookie(response, settings=settings)
    return LogoutResponse(ok=True)
