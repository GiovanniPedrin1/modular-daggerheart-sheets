from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import utc_now
from app.core.user_codes import normalize_public_user_code
from app.models.character_share import CharacterShare
from app.models.user import User
from app.schemas.shares import CreateCharacterShareRequest, ShareTargetKind


class InvalidShareTargetError(Exception):
    def __init__(self, target_kind: ShareTargetKind) -> None:
        super().__init__(f"Invalid character share target: {target_kind}")
        self.target_kind = target_kind


@dataclass(frozen=True, slots=True)
class ResolvedShareTarget:
    kind: ShareTargetKind
    label: str
    user: User | None

    @property
    def is_pending(self) -> bool:
        return self.user is None

    @property
    def target_email(self) -> str | None:
        return self.label if self.kind == "email" else None

    @property
    def target_public_user_code(self) -> str | None:
        return self.label if self.kind == "publicUserCode" else None


@dataclass(frozen=True, slots=True)
class PendingShareActivationResult:
    activated: tuple[CharacterShare, ...]
    superseded: tuple[CharacterShare, ...]

    @property
    def changed_count(self) -> int:
        return len(self.activated) + len(self.superseded)


def normalize_target_email(value: str) -> str:
    return value.strip().lower()


async def find_user_by_email(session: AsyncSession, email: str) -> User | None:
    normalized_email = normalize_target_email(email)
    result = await session.execute(select(User).where(User.email == normalized_email))
    return result.scalar_one_or_none()


async def find_user_by_public_code(
    session: AsyncSession,
    public_user_code: str,
) -> User | None:
    normalized_code = normalize_public_user_code(public_user_code)
    result = await session.execute(
        select(User).where(User.public_user_code == normalized_code)
    )
    return result.scalar_one_or_none()


async def resolve_share_target(
    session: AsyncSession,
    input_data: CreateCharacterShareRequest,
) -> ResolvedShareTarget:
    if input_data.target_email is not None:
        normalized_email = normalize_target_email(str(input_data.target_email))
        user = await find_user_by_email(session, normalized_email)
        return ResolvedShareTarget(kind="email", label=normalized_email, user=user)

    if input_data.public_user_code is None:  # pragma: no cover - schema protects this
        raise InvalidShareTargetError("publicUserCode")

    normalized_code = normalize_public_user_code(input_data.public_user_code)
    user = await find_user_by_public_code(session, normalized_code)
    if user is None:
        raise InvalidShareTargetError("publicUserCode")

    return ResolvedShareTarget(
        kind="publicUserCode",
        label=normalized_code,
        user=user,
    )


async def activate_pending_shares_for_user(
    session: AsyncSession,
    *,
    user: User,
    accepted_at: datetime | None = None,
) -> PendingShareActivationResult:
    """Activate pending e-mail shares after registration or login.

    Existing active access for the same user and character wins. In that rare case,
    the redundant pending e-mail share is revoked instead of violating the unique
    current-target constraint.
    """
    normalized_email = normalize_target_email(user.email)
    activation_time = accepted_at or utc_now()

    pending_result = await session.execute(
        select(CharacterShare)
        .where(
            CharacterShare.status == "pending",
            CharacterShare.target_email == normalized_email,
        )
        .order_by(CharacterShare.created_at.asc(), CharacterShare.id.asc())
        .with_for_update()
    )
    pending_shares = list(pending_result.scalars().all())
    if not pending_shares:
        return PendingShareActivationResult(activated=(), superseded=())

    character_ids = {share.character_id for share in pending_shares}
    active_result = await session.execute(
        select(CharacterShare)
        .where(
            CharacterShare.status == "active",
            CharacterShare.target_user_id == user.id,
            CharacterShare.character_id.in_(character_ids),
        )
        .with_for_update()
    )
    active_character_ids = {
        share.character_id for share in active_result.scalars().all()
    }

    activated: list[CharacterShare] = []
    superseded: list[CharacterShare] = []

    for share in pending_shares:
        if share.character_id in active_character_ids:
            share.status = "revoked"
            share.revoked_at = activation_time
            superseded.append(share)
        else:
            share.target_user_id = user.id
            share.status = "active"
            share.accepted_at = activation_time
            activated.append(share)
            active_character_ids.add(share.character_id)
        session.add(share)

    await session.flush()
    return PendingShareActivationResult(
        activated=tuple(activated),
        superseded=tuple(superseded),
    )
