from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest

from app.core.config import Settings
from app.models.character_event import CharacterEvent
from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import CharacterMutationAppliedCreate, CharacterMutationRequest
from app.services import character_mutation_service as service

FIXED_TIME = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        add=Mock(),
        execute=AsyncMock(),
        flush=AsyncMock(),
    )


def make_character(
    *,
    owner_user_id: UUID | None = None,
    server_revision: int = 2,
    data: dict | None = None,
) -> CloudCharacter:
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="local-character-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data=data or {"hp_current": "4", "gold": "2"},
        server_revision=server_revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
        deleted_at=None,
        updated_by_device_id="device-web",
    )


def make_request(
    *,
    base_revision: int = 2,
    mutation_id=None,
    device_id: str = "device-mobile",
    path: str = "/data/hp_current",
    value: object = "5",
) -> CharacterMutationRequest:
    return CharacterMutationRequest.model_validate(
        {
            "mode": "mutation",
            "baseRevision": base_revision,
            "deviceId": device_id,
            "mutationId": str(mutation_id or uuid4()),
            "schemaVersion": 1,
            "changedPaths": [path],
            "operations": [{"op": "set", "path": path, "value": value}],
        }
    )


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=values)))
    )


async def prepare_service(monkeypatch, character: CloudCharacter) -> None:
    monkeypatch.setattr(
        service.character_service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "find_character_mutation",
        AsyncMock(return_value=None),
    )


@pytest.mark.asyncio
async def test_apply_current_revision_mutation_updates_character_and_persists_applied(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=2)
    input_data = make_request(base_revision=2, value="6")
    session = make_session()
    await prepare_service(monkeypatch, character)

    result = await service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert isinstance(result, service.CharacterMutationAppliedResult)
    assert result.duplicate is False
    assert result.mutation.status == "applied"
    assert result.mutation.base_revision == 2
    assert result.mutation.applied_revision == 3
    assert result.mutation.merged is False
    assert result.mutation.unchanged is False
    assert result.should_emit_updated_event is True
    assert character.server_revision == 3
    assert character.data["hp_current"] == "6"
    assert character.updated_by_device_id == "device-mobile"
    session.add.assert_called_once_with(result.mutation)
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_apply_stale_mutation_merges_when_remote_paths_do_not_intersect(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=3)
    input_data = make_request(base_revision=2, path="/data/hp_current", value="7")
    session = make_session()
    await prepare_service(monkeypatch, character)
    monkeypatch.setattr(
        service,
        "load_remote_changed_paths",
        AsyncMock(
            return_value=service.CharacterRemotePathHistory(
                changed_paths=("/data/gold",),
                oldest_available_revision=3,
            )
        ),
    )

    result = await service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert isinstance(result, service.CharacterMutationAppliedResult)
    assert result.mutation.status == "applied"
    assert result.mutation.merged is True
    assert result.mutation.applied_revision == 4
    assert character.server_revision == 4
    assert character.data == {"hp_current": "7", "gold": "2"}


@pytest.mark.asyncio
async def test_apply_stale_mutation_persists_conflict_without_mutating_character(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=3)
    original_data = dict(character.data)
    input_data = make_request(base_revision=2, path="/data/details/story", value="Local")
    session = make_session()
    await prepare_service(monkeypatch, character)
    monkeypatch.setattr(
        service,
        "load_remote_changed_paths",
        AsyncMock(
            return_value=service.CharacterRemotePathHistory(
                changed_paths=("/data/details",),
                oldest_available_revision=3,
            )
        ),
    )

    result = await service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert isinstance(result, service.CharacterMutationConflictResult)
    assert result.mutation.status == "conflict"
    assert result.mutation.conflict_paths == ["/data/details/story"]
    assert result.mutation.server_changed_paths == ["/data/details"]
    assert result.mutation.conflict_server_revision == 3
    assert result.mutation.conflict_server_character["serverRevision"] == 3
    assert character.server_revision == 3
    assert character.data == original_data
    session.add.assert_called_once_with(result.mutation)
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_apply_duplicate_applied_mutation_returns_idempotent_result_without_rewrite(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=4)
    input_data = make_request(base_revision=2)
    existing = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner_id,
        request=input_data,
        appliedRevision=3,
        merged=True,
        unchanged=False,
    ).to_model()
    session = make_session()
    monkeypatch.setattr(
        service.character_service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "find_character_mutation",
        AsyncMock(return_value=existing),
    )

    result = await service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert isinstance(result, service.CharacterMutationAppliedResult)
    assert result.duplicate is True
    assert result.mutation is existing
    assert result.should_emit_updated_event is False
    assert character.server_revision == 4
    session.add.assert_not_called()
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_apply_rejects_revision_history_barrier_as_persisted_rejection(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=5)
    input_data = make_request(base_revision=2)
    session = make_session()
    await prepare_service(monkeypatch, character)
    monkeypatch.setattr(
        service,
        "load_remote_changed_paths",
        AsyncMock(
            side_effect=service._CharacterRemoteHistoryUnavailable(  # noqa: SLF001
                oldest_available_revision=4,
                reason="A required revision does not contain mutation path metadata.",
            )
        ),
    )

    result = await service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
    )

    assert isinstance(result, service.CharacterMutationRejectedResult)
    assert result.code == "REVISION_NOT_AVAILABLE"
    assert result.oldest_available_revision == 4
    assert result.mutation.status == "rejected"
    assert character.server_revision == 5
    session.add.assert_called_once_with(result.mutation)
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_load_remote_changed_paths_requires_contiguous_revisions(monkeypatch) -> None:
    character_id = uuid4()
    session = make_session()
    event = CharacterEvent(
        character_id=character_id,
        server_revision=4,
        event_type="updated",
        snapshot={"name": "Lyra"},
        changed_paths=["/data/gold"],
        actor_user_id=uuid4(),
        device_id="device-web",
        created_at=FIXED_TIME,
    )
    session.execute.return_value = scalar_list_result([event])
    monkeypatch.setattr(
        service.event_service,
        "get_oldest_mergeable_revision",
        AsyncMock(return_value=4),
    )

    with pytest.raises(service._CharacterRemoteHistoryUnavailable) as exc_info:  # noqa: SLF001
        await service.load_remote_changed_paths(
            session,
            character_id=character_id,
            base_revision=2,
            server_revision=4,
        )

    assert exc_info.value.oldest_available_revision == 4
    assert "complete event" in exc_info.value.reason


@pytest.mark.asyncio
async def test_load_remote_changed_paths_deduplicates_and_normalizes_history(monkeypatch) -> None:
    character_id = uuid4()
    session = make_session()
    events = [
        CharacterEvent(
            character_id=character_id,
            server_revision=3,
            event_type="updated",
            snapshot={"name": "Lyra"},
            changed_paths=["/data/hp_current", "/data/gold"],
            actor_user_id=uuid4(),
            device_id="device-web",
            created_at=FIXED_TIME,
        ),
        CharacterEvent(
            character_id=character_id,
            server_revision=4,
            event_type="updated",
            snapshot={"name": "Lyra"},
            changed_paths=["/data/hp_current"],
            actor_user_id=uuid4(),
            device_id="device-web",
            created_at=FIXED_TIME,
        ),
    ]
    session.execute.return_value = scalar_list_result(events)
    monkeypatch.setattr(
        service.event_service,
        "get_oldest_mergeable_revision",
        AsyncMock(return_value=3),
    )

    history = await service.load_remote_changed_paths(
        session,
        character_id=character_id,
        base_revision=2,
        server_revision=4,
    )

    assert history.changed_paths == ("/data/hp_current", "/data/gold")
    assert history.oldest_available_revision == 3


@pytest.mark.asyncio
async def test_load_remote_changed_paths_accepts_compacted_path_only_event(monkeypatch) -> None:
    character_id = uuid4()
    session = make_session()
    compacted = CharacterEvent(
        character_id=character_id,
        server_revision=3,
        event_type="updated",
        snapshot=None,
        patch={"format": "changed_paths_v1"},
        compacted_at=FIXED_TIME,
        changed_paths=["/data/hp_current"],
        actor_user_id=uuid4(),
        device_id="device-web",
        created_at=FIXED_TIME,
    )
    session.execute.return_value = scalar_list_result([compacted])
    monkeypatch.setattr(
        service.event_service,
        "get_oldest_mergeable_revision",
        AsyncMock(return_value=3),
    )

    history = await service.load_remote_changed_paths(
        session,
        character_id=character_id,
        base_revision=2,
        server_revision=3,
    )

    assert history.changed_paths == ("/data/hp_current",)
    assert history.oldest_available_revision == 3
