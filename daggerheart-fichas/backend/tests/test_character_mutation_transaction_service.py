from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.config import Settings
from app.core.database_concurrency import (
    extract_postgres_constraint_name,
    extract_postgres_sqlstate,
    is_retryable_character_write_error,
)
from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import CharacterMutationAppliedCreate, CharacterMutationRequest
from app.services import character_mutation_service as mutation_service
from app.services import character_mutation_transaction_service as service

FIXED_TIME = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)


class DriverError(Exception):
    def __init__(self, *, sqlstate: str, constraint_name: str | None = None) -> None:
        self.sqlstate = sqlstate
        self.constraint_name = constraint_name
        super().__init__(sqlstate)


def make_character(*, owner_user_id: UUID, server_revision: int = 2) -> CloudCharacter:
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id,
        local_character_id="local-character-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=server_revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
        deleted_at=None,
        updated_by_device_id="device-mobile",
    )


def make_request(*, mutation_id: UUID | None = None) -> CharacterMutationRequest:
    return CharacterMutationRequest.model_validate(
        {
            "mode": "mutation",
            "baseRevision": 1,
            "deviceId": "device-mobile",
            "mutationId": str(mutation_id or uuid4()),
            "schemaVersion": 1,
            "changedPaths": ["/data/hp_current"],
            "operations": [{"op": "set", "path": "/data/hp_current", "value": "5"}],
        }
    )


def make_applied_result(
    *,
    owner_user_id: UUID,
    character: CloudCharacter,
    input_data: CharacterMutationRequest,
    duplicate: bool = False,
) -> mutation_service.CharacterMutationAppliedResult:
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner_user_id,
        request=input_data,
        appliedRevision=character.server_revision,
        merged=True,
        unchanged=False,
    ).to_model()
    return mutation_service.CharacterMutationAppliedResult(
        character=character,
        mutation=mutation,
        duplicate=duplicate,
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        commit=AsyncMock(),
        rollback=AsyncMock(),
        refresh=AsyncMock(),
        execute=AsyncMock(),
    )


def test_extracts_asyncpg_style_sqlstate_and_constraint() -> None:
    error = IntegrityError(
        "insert",
        {},
        DriverError(
            sqlstate="23505",
            constraint_name=service.MUTATION_IDEMPOTENCY_CONSTRAINT,
        ),
    )

    assert extract_postgres_sqlstate(error) == "23505"
    assert extract_postgres_constraint_name(error) == service.MUTATION_IDEMPOTENCY_CONSTRAINT
    assert is_retryable_character_write_error(error) is False


@pytest.mark.asyncio
async def test_retries_serialization_failure_and_commits_once(monkeypatch) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    input_data = make_request()
    applied = make_applied_result(
        owner_user_id=owner_id,
        character=character,
        input_data=input_data,
    )
    session = make_session()
    serialization_error = OperationalError(
        "commit",
        {},
        DriverError(sqlstate="40001"),
    )
    run_once = AsyncMock(side_effect=[serialization_error, applied])
    sleep = AsyncMock()
    monkeypatch.setattr(service, "_run_once", run_once)

    result = await service.execute_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(
            app_env="test",
            character_write_retry_attempts=3,
            character_write_retry_base_delay_ms=10,
            character_write_retry_max_delay_ms=50,
        ),
        sleep=sleep,
    )

    assert result is applied
    assert run_once.await_count == 2
    session.rollback.assert_awaited_once()
    sleep.assert_awaited_once_with(0.01)


@pytest.mark.asyncio
async def test_recovers_concurrent_duplicate_after_unique_violation(monkeypatch) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    input_data = make_request()
    duplicate = make_applied_result(
        owner_user_id=owner_id,
        character=character,
        input_data=input_data,
        duplicate=True,
    )
    session = make_session()
    unique_error = IntegrityError(
        "insert",
        {},
        DriverError(
            sqlstate="23505",
            constraint_name=service.MUTATION_IDEMPOTENCY_CONSTRAINT,
        ),
    )
    monkeypatch.setattr(service, "_run_once", AsyncMock(side_effect=unique_error))
    load_duplicate = AsyncMock(return_value=duplicate)
    monkeypatch.setattr(service, "_load_duplicate_result", load_duplicate)

    result = await service.execute_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=input_data,
        settings=Settings(app_env="test"),
        sleep=AsyncMock(),
    )

    assert result is duplicate
    session.rollback.assert_awaited_once()
    session.commit.assert_awaited_once()
    load_duplicate.assert_awaited_once()


@pytest.mark.asyncio
async def test_duplicate_recovery_preserves_idempotency_key_reuse_detection(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    input_data = make_request()
    session = make_session()
    unique_error = IntegrityError(
        "insert",
        {},
        DriverError(
            sqlstate="23505",
            constraint_name=service.MUTATION_IDEMPOTENCY_CONSTRAINT,
        ),
    )
    monkeypatch.setattr(service, "_run_once", AsyncMock(side_effect=unique_error))
    reuse_error = mutation_service.CharacterMutationIdempotencyKeyReuseError(
        mutation=make_applied_result(
            owner_user_id=owner_id,
            character=character,
            input_data=input_data,
        ).mutation,
        received_request_hash="b" * 64,
    )
    monkeypatch.setattr(
        service,
        "_load_duplicate_result",
        AsyncMock(side_effect=reuse_error),
    )

    with pytest.raises(mutation_service.CharacterMutationIdempotencyKeyReuseError):
        await service.execute_owner_character_mutation(
            session,
            owner_user_id=owner_id,
            character_id=character.id,
            input_data=input_data,
            settings=Settings(app_env="test"),
            sleep=AsyncMock(),
        )

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_exhausted_retryable_writes_return_busy_error(monkeypatch) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    input_data = make_request()
    session = make_session()
    deadlock = OperationalError(
        "commit",
        {},
        DriverError(sqlstate="40P01"),
    )
    monkeypatch.setattr(service, "_run_once", AsyncMock(side_effect=deadlock))
    sleep = AsyncMock()

    with pytest.raises(service.CharacterWriteBusyError) as exc_info:
        await service.execute_owner_character_mutation(
            session,
            owner_user_id=owner_id,
            character_id=character.id,
            input_data=input_data,
            settings=Settings(
                app_env="test",
                character_write_retry_attempts=3,
                character_write_retry_base_delay_ms=10,
                character_write_retry_max_delay_ms=15,
            ),
            sleep=sleep,
        )

    assert exc_info.value.attempts == 3
    assert session.rollback.await_count == 3
    assert [call.args[0] for call in sleep.await_args_list] == [0.01, 0.015]


@pytest.mark.asyncio
async def test_non_retryable_database_error_is_not_replayed(monkeypatch) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    input_data = make_request()
    session = make_session()
    invalid_text = OperationalError(
        "insert",
        {},
        DriverError(sqlstate="22P02"),
    )
    run_once = AsyncMock(side_effect=invalid_text)
    monkeypatch.setattr(service, "_run_once", run_once)

    with pytest.raises(OperationalError):
        await service.execute_owner_character_mutation(
            session,
            owner_user_id=owner_id,
            character_id=character.id,
            input_data=input_data,
            settings=Settings(app_env="test"),
            sleep=AsyncMock(),
        )

    assert run_once.await_count == 1
    session.rollback.assert_awaited_once()
