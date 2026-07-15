from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.models.cloud_character import CloudCharacter
from app.schemas.characters import CreateCloudCharacterRequest, UpdateCloudCharacterRequest
from app.services import cloud_character_service as service


def make_create_request(**overrides) -> CreateCloudCharacterRequest:
    payload = {
        "localCharacterId": "local-char-1",
        "deviceId": "device-1",
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {"hp_current": "5", "level": "1"},
        "schemaVersion": 1,
    }
    payload.update(overrides)
    return CreateCloudCharacterRequest.model_validate(payload)


def make_update_request(**overrides) -> UpdateCloudCharacterRequest:
    payload = {
        "baseRevision": 1,
        "deviceId": "device-2",
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {"hp_current": "4", "level": "1"},
        "schemaVersion": 1,
    }
    payload.update(overrides)
    return UpdateCloudCharacterRequest.model_validate(payload)


def make_character(
    *,
    owner_user_id: UUID | None = None,
    content_hash: str = "a" * 64,
    server_revision: int = 1,
) -> CloudCharacter:
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="local-char-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5", "level": "1"},
        server_revision=server_revision,
        content_hash=content_hash,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=None,
        updated_by_device_id="device-1",
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        add=Mock(),
        execute=AsyncMock(),
        flush=AsyncMock(),
        rollback=AsyncMock(),
    )


def scalar_result(value):
    return SimpleNamespace(scalar_one_or_none=Mock(return_value=value))


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=values)))
    )


def test_validate_snapshot_calculates_size_and_hash() -> None:
    settings = Settings(app_env="test")
    input_data = make_create_request()

    result = service.validate_cloud_character_snapshot(input_data, settings=settings)

    assert result.encoded_size > 0
    assert len(result.content_hash) == 64


def test_validate_snapshot_rejects_unsupported_schema_version() -> None:
    settings = Settings(
        app_env="test",
        supported_cloud_character_schema_version=2,
    )

    with pytest.raises(service.UnsupportedCloudCharacterSchemaVersionError) as exc_info:
        service.validate_cloud_character_snapshot(make_create_request(), settings=settings)

    assert exc_info.value.supported_version == 2
    assert exc_info.value.received_version == 1


def test_validate_snapshot_rejects_payload_over_limit() -> None:
    settings = Settings(app_env="test", max_cloud_character_payload_bytes=10)

    with pytest.raises(service.CloudCharacterTooLargeError) as exc_info:
        service.validate_cloud_character_snapshot(make_create_request(), settings=settings)

    assert exc_info.value.max_bytes == 10
    assert exc_info.value.actual_bytes > 10


@pytest.mark.asyncio
async def test_find_and_list_only_return_active_owned_characters() -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    session = make_session()
    session.execute.side_effect = [scalar_result(character), scalar_list_result([character])]

    found = await service.get_owner_cloud_character(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
    )
    listed = await service.list_owner_cloud_characters(session, owner_user_id=owner_id)

    assert found is character
    assert listed == [character]
    assert session.execute.await_count == 2


@pytest.mark.asyncio
async def test_get_owner_character_masks_missing_deleted_or_foreign_records() -> None:
    session = make_session()
    session.execute.return_value = scalar_result(None)
    character_id = uuid4()

    with pytest.raises(service.CloudCharacterNotFoundError) as exc_info:
        await service.get_owner_cloud_character(
            session,
            owner_user_id=uuid4(),
            character_id=character_id,
        )

    assert exc_info.value.character_id == character_id


@pytest.mark.asyncio
async def test_create_cloud_character_persists_revision_one(monkeypatch) -> None:
    session = make_session()
    owner_id = uuid4()
    input_data = make_create_request()
    monkeypatch.setattr(
        service,
        "find_active_cloud_character_by_local_id",
        AsyncMock(return_value=None),
    )

    result = await service.create_cloud_character(
        session,
        owner_user_id=owner_id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert result.created is True
    assert result.reason is None
    assert result.character.owner_user_id == owner_id
    assert result.character.server_revision == 1
    assert result.character.updated_by_device_id == "device-1"
    assert result.character.content_hash != ""
    session.add.assert_called_once_with(result.character)
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_is_idempotent_for_identical_active_snapshot(monkeypatch) -> None:
    input_data = make_create_request()
    validated = service.validate_cloud_character_snapshot(
        input_data,
        settings=Settings(app_env="test"),
    )
    existing = make_character(content_hash=validated.content_hash)
    monkeypatch.setattr(
        service,
        "find_active_cloud_character_by_local_id",
        AsyncMock(return_value=existing),
    )
    session = make_session()

    result = await service.create_cloud_character(
        session,
        owner_user_id=existing.owner_user_id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert result.character is existing
    assert result.created is False
    assert result.reason == "existing_identical_snapshot"
    session.add.assert_not_called()
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_rejects_existing_local_id_with_different_snapshot(monkeypatch) -> None:
    existing = make_character(content_hash="b" * 64)
    monkeypatch.setattr(
        service,
        "find_active_cloud_character_by_local_id",
        AsyncMock(return_value=existing),
    )

    with pytest.raises(service.CloudCharacterAlreadyExistsError) as exc_info:
        await service.create_cloud_character(
            make_session(),
            owner_user_id=existing.owner_user_id,
            input_data=make_create_request(),
            settings=Settings(app_env="test"),
        )

    assert exc_info.value.character is existing


@pytest.mark.asyncio
async def test_create_recovers_idempotently_from_concurrent_unique_insert(monkeypatch) -> None:
    session = make_session()
    session.flush.side_effect = IntegrityError("insert", {}, Exception("unique"))
    input_data = make_create_request()
    validated = service.validate_cloud_character_snapshot(
        input_data,
        settings=Settings(app_env="test"),
    )
    concurrent = make_character(content_hash=validated.content_hash)
    finder = AsyncMock(side_effect=[None, concurrent])
    monkeypatch.setattr(service, "find_active_cloud_character_by_local_id", finder)

    result = await service.create_cloud_character(
        session,
        owner_user_id=concurrent.owner_user_id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert result.created is False
    assert result.character is concurrent
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_rejects_revision_mismatch_before_writing(monkeypatch) -> None:
    character = make_character(server_revision=3)
    get_character = AsyncMock(return_value=character)
    monkeypatch.setattr(service, "get_owner_cloud_character", get_character)
    session = make_session()

    with pytest.raises(service.CloudCharacterRevisionMismatchError) as exc_info:
        await service.update_cloud_character(
            session,
            owner_user_id=character.owner_user_id,
            character_id=character.id,
            input_data=make_update_request(baseRevision=1),
            settings=Settings(app_env="test"),
        )

    assert exc_info.value.character is character
    assert exc_info.value.received_base_revision == 1
    get_character.assert_awaited_once_with(
        session,
        owner_user_id=character.owner_user_id,
        character_id=character.id,
        for_update=True,
    )
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_does_not_increment_identical_snapshot(monkeypatch) -> None:
    input_data = make_update_request(data={"hp_current": "4", "level": "1"})
    validated = service.validate_cloud_character_snapshot(
        input_data,
        settings=Settings(app_env="test"),
    )
    character = make_character(content_hash=validated.content_hash)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    append_event = AsyncMock()
    monkeypatch.setattr(
        service.event_service,
        "append_character_updated_event",
        append_event,
    )
    session = make_session()

    result = await service.update_cloud_character(
        session,
        owner_user_id=character.owner_user_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert result.unchanged is True
    assert character.server_revision == 1
    append_event.assert_not_awaited()
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_replaces_snapshot_and_increments_revision(monkeypatch) -> None:
    character = make_character(content_hash="b" * 64)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    append_event = AsyncMock()
    monkeypatch.setattr(
        service.event_service,
        "append_character_updated_event",
        append_event,
    )
    session = make_session()
    input_data = make_update_request(name="Lyra Updated")

    result = await service.update_cloud_character(
        session,
        owner_user_id=character.owner_user_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert result.unchanged is False
    assert character.name == "Lyra Updated"
    assert character.data == input_data.data
    assert character.server_revision == 2
    assert character.updated_by_device_id == "device-2"
    append_event.assert_awaited_once_with(
        session,
        character=character,
        actor_user_id=character.owner_user_id,
        changed_paths=("/name", "/data/hp_current"),
        device_id="device-2",
    )
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_uses_history_barrier_when_snapshot_diff_exceeds_path_limit(
    monkeypatch,
) -> None:
    character = make_character(content_hash="b" * 64)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    append_event = AsyncMock()
    monkeypatch.setattr(
        service.event_service,
        "append_character_updated_event",
        append_event,
    )
    input_data = make_update_request(
        data={f"field_{index}": index for index in range(129)}
    )

    session = make_session()
    result = await service.update_cloud_character(
        session,
        owner_user_id=character.owner_user_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert result.unchanged is False
    assert character.server_revision == 2
    append_event.assert_awaited_once_with(
        session,
        character=character,
        actor_user_id=character.owner_user_id,
        changed_paths=None,
        device_id="device-2",
    )


@pytest.mark.asyncio
async def test_soft_delete_sets_tombstone_and_flushes(monkeypatch) -> None:
    character = make_character()
    get_character = AsyncMock(return_value=character)
    monkeypatch.setattr(service, "get_owner_cloud_character", get_character)
    append_event = AsyncMock()
    monkeypatch.setattr(
        service.event_service,
        "append_character_deleted_event",
        append_event,
    )
    session = make_session()

    result = await service.soft_delete_cloud_character(
        session,
        owner_user_id=character.owner_user_id,
        character_id=character.id,
    )

    assert result.character_id == character.id
    assert result.deleted_at == character.deleted_at
    assert character.updated_at == character.deleted_at
    assert character.server_revision == 2
    get_character.assert_awaited_once_with(
        session,
        owner_user_id=character.owner_user_id,
        character_id=character.id,
        for_update=True,
    )
    append_event.assert_awaited_once_with(
        session,
        character=character,
        actor_user_id=character.owner_user_id,
    )
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_propagates_event_failure_before_commit(monkeypatch) -> None:
    character = make_character(content_hash="b" * 64)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    append_event = AsyncMock(side_effect=RuntimeError("event insert failed"))
    monkeypatch.setattr(
        service.event_service,
        "append_character_updated_event",
        append_event,
    )
    session = make_session()

    with pytest.raises(RuntimeError, match="event insert failed"):
        await service.update_cloud_character(
            session,
            owner_user_id=character.owner_user_id,
            character_id=character.id,
            input_data=make_update_request(name="Changed"),
            settings=Settings(app_env="test"),
        )

    assert character.server_revision == 2
    append_event.assert_awaited_once()
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_propagates_event_failure_before_commit(monkeypatch) -> None:
    character = make_character()
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    append_event = AsyncMock(side_effect=RuntimeError("event insert failed"))
    monkeypatch.setattr(
        service.event_service,
        "append_character_deleted_event",
        append_event,
    )

    with pytest.raises(RuntimeError, match="event insert failed"):
        await service.soft_delete_cloud_character(
            make_session(),
            owner_user_id=character.owner_user_id,
            character_id=character.id,
        )

    assert character.deleted_at is not None
    assert character.server_revision == 2
    append_event.assert_awaited_once()
