from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.models.cloud_character import CloudCharacter
from app.services import character_stream_access_service as service


def make_session() -> SimpleNamespace:
    return SimpleNamespace(execute=AsyncMock())


def row_result(value):
    return SimpleNamespace(one_or_none=Mock(return_value=value))


def scalar_result(value):
    return SimpleNamespace(scalar_one=Mock(return_value=value))


def make_character(*, owner_user_id=None, deleted: bool = False) -> CloudCharacter:
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="local-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=7,
        content_hash="a" * 64,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=now if deleted else None,
        updated_by_device_id="device-1",
    )


def test_character_stream_access_invariants() -> None:
    character = make_character()

    with pytest.raises(ValueError, match="owner stream access"):
        service.CharacterStreamAccess(
            character=character,
            role="owner",
            user_id=character.owner_user_id,
            share_id=uuid4(),
        )

    with pytest.raises(ValueError, match="viewer stream access"):
        service.CharacterStreamAccess(
            character=character,
            role="viewer",
            user_id=uuid4(),
        )


@pytest.mark.asyncio
async def test_get_character_stream_access_returns_owner_grant() -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    session = make_session()
    session.execute.return_value = row_result((character, None))

    access = await service.get_character_stream_access(
        session,
        user_id=owner_id,
        character_id=character.id,
    )

    assert access.character is character
    assert access.role == "owner"
    assert access.user_id == owner_id
    assert access.share_id is None
    assert access.character_id == character.id
    assert access.server_revision == 7

    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "cloud_characters.deleted_at IS NULL" in sql
    assert "cloud_characters.owner_user_id =" in sql
    assert "character_shares.status =" in sql
    assert "character_shares.target_user_id =" in sql


@pytest.mark.asyncio
async def test_get_character_stream_access_returns_active_viewer_grant() -> None:
    viewer_id = uuid4()
    share_id = uuid4()
    character = make_character()
    session = make_session()
    session.execute.return_value = row_result((character, share_id))

    access = await service.get_character_stream_access(
        session,
        user_id=viewer_id,
        character_id=character.id,
    )

    assert access.character is character
    assert access.role == "viewer"
    assert access.user_id == viewer_id
    assert access.share_id == share_id


@pytest.mark.asyncio
async def test_get_shared_character_stream_access_requires_viewer_even_for_owner() -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    session = make_session()
    session.execute.return_value = row_result(None)

    with pytest.raises(service.CharacterStreamAccessNotFoundError) as error:
        await service.get_shared_character_stream_access(
            session,
            viewer_user_id=owner_id,
            character_id=character.id,
        )

    assert error.value.character_id == character.id
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "character_shares.id IS NOT NULL" in sql
    assert "cloud_characters.owner_user_id =" not in sql


@pytest.mark.asyncio
async def test_get_shared_character_stream_access_returns_exact_share_grant() -> None:
    viewer_id = uuid4()
    share_id = uuid4()
    character = make_character()
    session = make_session()
    session.execute.return_value = row_result((character, share_id))

    access = await service.get_shared_character_stream_access(
        session,
        viewer_user_id=viewer_id,
        character_id=character.id,
    )

    assert access.role == "viewer"
    assert access.share_id == share_id
    assert access.user_id == viewer_id


@pytest.mark.asyncio
async def test_stream_access_masks_missing_deleted_pending_revoked_or_third_party() -> None:
    character_id = uuid4()
    session = make_session()
    session.execute.return_value = row_result(None)

    with pytest.raises(service.CharacterStreamAccessNotFoundError) as error:
        await service.get_character_stream_access(
            session,
            user_id=uuid4(),
            character_id=character_id,
        )

    assert error.value.character_id == character_id


@pytest.mark.asyncio
async def test_owner_stream_revalidation_uses_owner_and_active_character() -> None:
    owner_id = uuid4()
    access = service.CharacterStreamAccess(
        character=make_character(owner_user_id=owner_id),
        role="owner",
        user_id=owner_id,
    )
    session = make_session()
    session.execute.return_value = scalar_result(True)

    assert await service.is_character_stream_access_active(session, access=access) is True

    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "cloud_characters.id =" in sql
    assert "cloud_characters.owner_user_id =" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql
    assert "character_shares" not in sql


@pytest.mark.asyncio
async def test_viewer_stream_revalidation_is_tied_to_original_share() -> None:
    viewer_id = uuid4()
    original_share_id = uuid4()
    access = service.CharacterStreamAccess(
        character=make_character(),
        role="viewer",
        user_id=viewer_id,
        share_id=original_share_id,
    )
    session = make_session()
    session.execute.return_value = scalar_result(True)

    assert await service.is_character_stream_access_active(session, access=access) is True

    statement = session.execute.await_args.args[0]
    sql = str(statement)
    params = statement.compile().params
    assert "character_shares.id =" in sql
    assert "character_shares.character_id =" in sql
    assert "character_shares.target_user_id =" in sql
    assert "character_shares.status =" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql
    assert original_share_id in params.values()
    assert viewer_id in params.values()


@pytest.mark.asyncio
async def test_stream_revalidation_returns_false_after_revoke_or_delete() -> None:
    access = service.CharacterStreamAccess(
        character=make_character(),
        role="viewer",
        user_id=uuid4(),
        share_id=uuid4(),
    )
    session = make_session()
    session.execute.return_value = scalar_result(False)

    assert await service.is_character_stream_access_active(session, access=access) is False


@pytest.mark.asyncio
async def test_require_stream_access_active_raises_masked_error() -> None:
    access = service.CharacterStreamAccess(
        character=make_character(),
        role="viewer",
        user_id=uuid4(),
        share_id=uuid4(),
    )
    session = make_session()
    session.execute.return_value = scalar_result(False)

    with pytest.raises(service.CharacterStreamAccessNotFoundError) as error:
        await service.require_character_stream_access_active(session, access=access)

    assert error.value.character_id == access.character_id


@pytest.mark.asyncio
async def test_require_stream_access_active_accepts_valid_grant() -> None:
    owner_id = uuid4()
    access = service.CharacterStreamAccess(
        character=make_character(owner_user_id=owner_id),
        role="owner",
        user_id=owner_id,
    )
    session = make_session()
    session.execute.return_value = scalar_result(True)

    assert (
        await service.require_character_stream_access_active(session, access=access)
        is None
    )
