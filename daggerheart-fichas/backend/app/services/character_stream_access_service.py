from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter

type CharacterStreamRole = Literal["owner", "viewer"]


class CharacterStreamAccessError(Exception):
    """Base class for stream authorization domain errors."""


class CharacterStreamAccessNotFoundError(CharacterStreamAccessError):
    """Raised when the current account cannot open or keep a character stream.

    Missing characters, deleted characters, inactive shares, and third-party access
    deliberately use the same error so callers can avoid resource enumeration.
    """

    def __init__(self, character_id: UUID) -> None:
        self.character_id = character_id
        super().__init__(f"Character event stream {character_id} was not found")


@dataclass(frozen=True, slots=True)
class CharacterStreamAccess:
    character: CloudCharacter
    role: CharacterStreamRole
    user_id: UUID
    share_id: UUID | None = None
    _character_id: UUID = field(init=False, repr=False)
    _server_revision: int = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if self.role == "owner" and self.share_id is not None:
            raise ValueError("owner stream access cannot reference a share")
        if self.role == "viewer" and self.share_id is None:
            raise ValueError("viewer stream access requires the active share ID")
        object.__setattr__(self, "_character_id", self.character.id)
        object.__setattr__(self, "_server_revision", self.character.server_revision)

    @property
    def character_id(self) -> UUID:
        return self._character_id

    @property
    def server_revision(self) -> int:
        return self._server_revision


def _active_viewer_join(*, user_id: UUID):
    return and_(
        CharacterShare.character_id == CloudCharacter.id,
        CharacterShare.target_user_id == user_id,
        CharacterShare.status == "active",
    )


def _character_stream_access_statement(
    *,
    user_id: UUID,
    character_id: UUID,
    viewer_only: bool,
):
    statement = (
        select(CloudCharacter, CharacterShare.id)
        .outerjoin(CharacterShare, _active_viewer_join(user_id=user_id))
        .where(
            CloudCharacter.id == character_id,
            CloudCharacter.deleted_at.is_(None),
        )
    )
    if viewer_only:
        return statement.where(CharacterShare.id.is_not(None))
    return statement.where(
        or_(
            CloudCharacter.owner_user_id == user_id,
            CharacterShare.id.is_not(None),
        )
    )


async def _get_character_stream_access(
    session: AsyncSession,
    *,
    user_id: UUID,
    character_id: UUID,
    viewer_only: bool,
) -> CharacterStreamAccess:
    result = await session.execute(
        _character_stream_access_statement(
            user_id=user_id,
            character_id=character_id,
            viewer_only=viewer_only,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise CharacterStreamAccessNotFoundError(character_id)

    character, active_share_id = row
    if not viewer_only and character.owner_user_id == user_id:
        return CharacterStreamAccess(
            character=character,
            role="owner",
            user_id=user_id,
        )

    if active_share_id is None:
        # This should be unreachable because the SQL predicate requires an active
        # share for viewers, but retaining the guard keeps the authorization result
        # safe if that query changes later.
        raise CharacterStreamAccessNotFoundError(character_id)

    return CharacterStreamAccess(
        character=character,
        role="viewer",
        user_id=user_id,
        share_id=active_share_id,
    )


async def get_character_stream_access(
    session: AsyncSession,
    *,
    user_id: UUID,
    character_id: UUID,
) -> CharacterStreamAccess:
    """Authorize an owner or active viewer for a character event stream."""

    return await _get_character_stream_access(
        session,
        user_id=user_id,
        character_id=character_id,
        viewer_only=False,
    )


async def get_shared_character_stream_access(
    session: AsyncSession,
    *,
    viewer_user_id: UUID,
    character_id: UUID,
) -> CharacterStreamAccess:
    """Authorize only an active viewer for the `/shared/characters` stream.

    The character owner is intentionally not accepted by this function. A future
    owner-facing stream can reuse :func:`get_character_stream_access` instead.
    """

    return await _get_character_stream_access(
        session,
        user_id=viewer_user_id,
        character_id=character_id,
        viewer_only=True,
    )


async def is_character_stream_access_active(
    session: AsyncSession,
    *,
    access: CharacterStreamAccess,
) -> bool:
    """Revalidate an already-open stream using its original authorization grant.

    Viewer access is tied to the exact share ID that opened the stream. Revoking a
    share therefore invalidates the existing connection even if the owner creates a
    new share for the same viewer immediately afterwards.
    """

    if access.role == "owner":
        predicate = exists().where(
            CloudCharacter.id == access.character_id,
            CloudCharacter.owner_user_id == access.user_id,
            CloudCharacter.deleted_at.is_(None),
        )
    else:
        predicate = exists().where(
            CharacterShare.id == access.share_id,
            CharacterShare.character_id == access.character_id,
            CharacterShare.target_user_id == access.user_id,
            CharacterShare.status == "active",
            exists().where(
                CloudCharacter.id == access.character_id,
                CloudCharacter.deleted_at.is_(None),
            ),
        )

    result = await session.execute(select(predicate))
    return bool(result.scalar_one())


async def require_character_stream_access_active(
    session: AsyncSession,
    *,
    access: CharacterStreamAccess,
) -> None:
    """Raise the masked stream-access error when an open grant is no longer valid."""

    if not await is_character_stream_access_active(session, access=access):
        raise CharacterStreamAccessNotFoundError(access.character_id)
