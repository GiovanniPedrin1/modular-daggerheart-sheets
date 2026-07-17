from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import utc_now
from app.core.user_codes import normalize_public_user_code
from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter
from app.models.user import User
from app.schemas.shares import CreateCharacterShareRequest
from app.services import character_event_service as event_service
from app.services.cloud_character_service import get_owner_cloud_character
from app.services.share_target_service import (
    ResolvedShareTarget,
    normalize_target_email,
    resolve_share_target,
)

type CreateCharacterShareReason = Literal["existing_share"]


class CharacterShareServiceError(Exception):
    """Base class for domain errors raised by the Character Share service."""


class CannotShareWithSelfError(CharacterShareServiceError):
    def __init__(self, character_id: UUID) -> None:
        self.character_id = character_id
        super().__init__(f"Cloud character {character_id} cannot be shared with its owner")


class CharacterShareNotFoundError(CharacterShareServiceError):
    def __init__(self, *, character_id: UUID, share_id: UUID) -> None:
        self.character_id = character_id
        self.share_id = share_id
        super().__init__(
            f"Character share {share_id} was not found for cloud character {character_id}"
        )


class SharedCharacterNotFoundError(CharacterShareServiceError):
    def __init__(self, character_id: UUID) -> None:
        self.character_id = character_id
        super().__init__(f"Shared cloud character {character_id} was not found")


@dataclass(frozen=True, slots=True)
class CreateCharacterShareResult:
    share: CharacterShare
    created: bool
    reason: CreateCharacterShareReason | None = None


@dataclass(frozen=True, slots=True)
class RevokeCharacterShareResult:
    share_id: UUID
    character_id: UUID
    revoked_at: datetime
    target_user_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class SharedCharacterAccess:
    character: CloudCharacter
    owner_display_name: str | None


def _is_self_target(*, owner: User, target: ResolvedShareTarget) -> bool:
    if target.user is not None and target.user.id == owner.id:
        return True
    if target.kind == "email":
        return normalize_target_email(target.label) == normalize_target_email(owner.email)
    return normalize_public_user_code(target.label) == normalize_public_user_code(
        owner.public_user_code
    )


def _target_matches_share(target: ResolvedShareTarget):
    label_match = (
        CharacterShare.target_email == target.target_email
        if target.kind == "email"
        else CharacterShare.target_public_user_code == target.target_public_user_code
    )
    if target.user is None:
        return label_match
    return or_(label_match, CharacterShare.target_user_id == target.user.id)


async def find_current_character_share(
    session: AsyncSession,
    *,
    character_id: UUID,
    owner_user_id: UUID,
    target: ResolvedShareTarget,
) -> CharacterShare | None:
    """Find an idempotent current share by its label or resolved account.

    Looking up by account as well as label means sharing the same character through
    an e-mail and later through that user's public code still resolves to the
    existing access instead of creating a duplicate current share.
    """

    result = await session.execute(
        select(CharacterShare)
        .where(
            CharacterShare.character_id == character_id,
            CharacterShare.owner_user_id == owner_user_id,
            CharacterShare.status.in_(("pending", "active")),
            _target_matches_share(target),
        )
        .order_by(CharacterShare.created_at.asc(), CharacterShare.id.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_character_share(
    session: AsyncSession,
    *,
    owner: User,
    character_id: UUID,
    input_data: CreateCharacterShareRequest,
) -> CreateCharacterShareResult:
    """Create a pending or active read-only share for an owned character.

    The public response intentionally does not reveal whether an e-mail resolved to
    an existing account. The service flushes but leaves the transaction commit to
    the API layer.
    """

    await get_owner_cloud_character(
        session,
        owner_user_id=owner.id,
        character_id=character_id,
        for_update=True,
    )
    target = await resolve_share_target(session, input_data)

    if _is_self_target(owner=owner, target=target):
        raise CannotShareWithSelfError(character_id)

    existing = await find_current_character_share(
        session,
        character_id=character_id,
        owner_user_id=owner.id,
        target=target,
    )
    if existing is not None:
        return CreateCharacterShareResult(
            share=existing,
            created=False,
            reason="existing_share",
        )

    accepted_at = None if target.is_pending else utc_now()
    share = CharacterShare(
        character_id=character_id,
        owner_user_id=owner.id,
        target_user_id=target.user.id if target.user is not None else None,
        target_email=target.target_email,
        target_public_user_code=target.target_public_user_code,
        role="viewer",
        status="pending" if target.is_pending else "active",
        accepted_at=accepted_at,
        revoked_at=None,
    )
    session.add(share)

    try:
        await session.flush()
    except IntegrityError:
        # Another request can win one of the partial unique indexes after our
        # lookup. Resolve the winner and return the same idempotent result.
        await session.rollback()
        concurrent = await find_current_character_share(
            session,
            character_id=character_id,
            owner_user_id=owner.id,
            target=target,
        )
        if concurrent is None:
            raise
        return CreateCharacterShareResult(
            share=concurrent,
            created=False,
            reason="existing_share",
        )

    return CreateCharacterShareResult(share=share, created=True)


async def list_character_shares(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
) -> list[CharacterShare]:
    await get_owner_cloud_character(
        session,
        owner_user_id=owner_user_id,
        character_id=character_id,
    )
    result = await session.execute(
        select(CharacterShare)
        .where(
            CharacterShare.character_id == character_id,
            CharacterShare.owner_user_id == owner_user_id,
            CharacterShare.status.in_(("pending", "active")),
        )
        .order_by(CharacterShare.created_at.asc(), CharacterShare.id.asc())
    )
    return list(result.scalars().all())


async def revoke_character_share(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    share_id: UUID,
    revoked_at: datetime | None = None,
) -> RevokeCharacterShareResult:
    character = await get_owner_cloud_character(
        session,
        owner_user_id=owner_user_id,
        character_id=character_id,
        for_update=True,
    )
    result = await session.execute(
        select(CharacterShare)
        .where(
            CharacterShare.id == share_id,
            CharacterShare.character_id == character_id,
            CharacterShare.owner_user_id == owner_user_id,
            CharacterShare.status.in_(("pending", "active")),
        )
        .with_for_update()
    )
    share = result.scalar_one_or_none()
    if share is None:
        raise CharacterShareNotFoundError(
            character_id=character_id,
            share_id=share_id,
        )

    revocation_time = revoked_at or utc_now()
    share.status = "revoked"
    share.revoked_at = revocation_time
    session.add(share)
    if share.target_user_id is not None:
        await event_service.append_share_revoked_event(
            session,
            character_id=character.id,
            server_revision=character.server_revision,
            audience_user_id=share.target_user_id,
            revoked_at=revocation_time,
            actor_user_id=owner_user_id,
        )
    else:
        await session.flush()

    return RevokeCharacterShareResult(
        share_id=share.id,
        character_id=share.character_id,
        target_user_id=share.target_user_id,
        revoked_at=revocation_time,
    )


def _shared_character_statement(*, viewer_user_id: UUID):
    return (
        select(CloudCharacter, User.display_name)
        .join(CharacterShare, CharacterShare.character_id == CloudCharacter.id)
        .join(User, User.id == CloudCharacter.owner_user_id)
        .where(
            CharacterShare.target_user_id == viewer_user_id,
            CharacterShare.status == "active",
            CloudCharacter.deleted_at.is_(None),
        )
    )


async def list_shared_characters(
    session: AsyncSession,
    *,
    viewer_user_id: UUID,
) -> list[SharedCharacterAccess]:
    result = await session.execute(
        _shared_character_statement(viewer_user_id=viewer_user_id).order_by(
            CloudCharacter.updated_at.desc(),
            CloudCharacter.id.desc(),
        )
    )
    return [
        SharedCharacterAccess(
            character=character,
            owner_display_name=owner_display_name,
        )
        for character, owner_display_name in result.all()
    ]


async def get_shared_character(
    session: AsyncSession,
    *,
    viewer_user_id: UUID,
    character_id: UUID,
) -> SharedCharacterAccess:
    result = await session.execute(
        _shared_character_statement(viewer_user_id=viewer_user_id).where(
            CloudCharacter.id == character_id
        )
    )
    row = result.one_or_none()
    if row is None:
        raise SharedCharacterNotFoundError(character_id)

    character, owner_display_name = row
    return SharedCharacterAccess(
        character=character,
        owner_display_name=owner_display_name,
    )
