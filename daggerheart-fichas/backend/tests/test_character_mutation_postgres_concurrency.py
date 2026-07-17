from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app import models as _models  # noqa: F401 - populate Base.metadata
from app.core.config import Settings
from app.db.base import Base
from app.models.character_event import CharacterEvent
from app.models.character_mutation import CharacterMutation
from app.models.cloud_character import CloudCharacter
from app.models.user import User
from app.schemas.character_sync import CharacterMutationRequest
from app.services import character_mutation_service as mutation_service
from app.services.character_mutation_transaction_service import (
    execute_owner_character_mutation,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(
        not TEST_DATABASE_URL,
        reason="TEST_DATABASE_URL is required for PostgreSQL concurrency tests",
    ),
]


def make_request(*, path: str, value: object, mutation_id=None) -> CharacterMutationRequest:
    return CharacterMutationRequest.model_validate(
        {
            "mode": "mutation",
            "baseRevision": 1,
            "deviceId": f"device-{uuid4()}",
            "mutationId": str(mutation_id or uuid4()),
            "schemaVersion": 1,
            "changedPaths": [path],
            "operations": [{"op": "set", "path": path, "value": value}],
        }
    )


@pytest_asyncio.fixture
async def postgres_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    assert TEST_DATABASE_URL is not None
    schema = f"test_character_concurrency_{uuid4().hex}"
    admin_engine = create_async_engine(TEST_DATABASE_URL, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))

    engine: AsyncEngine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"server_settings": {"search_path": f'"{schema}",public'}},
        pool_size=5,
        max_overflow=0,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    try:
        yield sessions
    finally:
        await engine.dispose()
        async with admin_engine.connect() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await admin_engine.dispose()


async def create_owner_character(
    sessions: async_sessionmaker[AsyncSession],
) -> tuple[User, CloudCharacter]:
    owner = User(
        email=f"owner-{uuid4()}@example.com",
        public_user_code=f"USR-{uuid4().hex[:12].upper()}",
        password_hash="test-password-hash",
        display_name="Owner",
    )
    character = CloudCharacter(
        owner=owner,
        local_character_id=f"local-{uuid4()}",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "4", "gold": "2"},
        server_revision=1,
        content_hash="a" * 64,
        schema_version=1,
        updated_by_device_id="device-initial",
    )
    async with sessions() as session:
        session.add_all([owner, character])
        await session.commit()
    return owner, character


async def submit_mutation(
    sessions: async_sessionmaker[AsyncSession],
    *,
    owner_id,
    character_id,
    request: CharacterMutationRequest,
):
    async with sessions() as session:
        return await execute_owner_character_mutation(
            session,
            owner_user_id=owner_id,
            character_id=character_id,
            input_data=request,
            settings=Settings(
                app_env="test",
                character_write_retry_attempts=4,
                character_write_retry_base_delay_ms=5,
                character_write_retry_max_delay_ms=20,
            ),
        )


@pytest.mark.asyncio
async def test_same_mutation_from_two_workers_creates_one_revision(
    postgres_sessions: async_sessionmaker[AsyncSession],
) -> None:
    owner, character = await create_owner_character(postgres_sessions)
    mutation_id = uuid4()
    first = make_request(path="/data/hp_current", value="5", mutation_id=mutation_id)
    second = first.model_copy(deep=True)

    results = await asyncio.gather(
        submit_mutation(
            postgres_sessions,
            owner_id=owner.id,
            character_id=character.id,
            request=first,
        ),
        submit_mutation(
            postgres_sessions,
            owner_id=owner.id,
            character_id=character.id,
            request=second,
        ),
    )

    assert all(
        isinstance(result, mutation_service.CharacterMutationAppliedResult) for result in results
    )
    assert sorted(result.duplicate for result in results) == [False, True]

    async with postgres_sessions() as session:
        stored = await session.get(CloudCharacter, character.id)
        mutation_count = await session.scalar(select(func.count()).select_from(CharacterMutation))
        event_count = await session.scalar(select(func.count()).select_from(CharacterEvent))
    assert stored is not None
    assert stored.server_revision == 2
    assert stored.data["hp_current"] == "5"
    assert mutation_count == 1
    assert event_count == 1


@pytest.mark.asyncio
async def test_same_base_revision_on_different_paths_merges_serially(
    postgres_sessions: async_sessionmaker[AsyncSession],
) -> None:
    owner, character = await create_owner_character(postgres_sessions)
    hp = make_request(path="/data/hp_current", value="6")
    gold = make_request(path="/data/gold", value="9")

    results = await asyncio.gather(
        submit_mutation(
            postgres_sessions,
            owner_id=owner.id,
            character_id=character.id,
            request=hp,
        ),
        submit_mutation(
            postgres_sessions,
            owner_id=owner.id,
            character_id=character.id,
            request=gold,
        ),
    )

    assert all(
        isinstance(result, mutation_service.CharacterMutationAppliedResult) for result in results
    )
    assert sorted(result.mutation.merged for result in results) == [False, True]

    async with postgres_sessions() as session:
        stored = await session.get(CloudCharacter, character.id)
        event_count = await session.scalar(select(func.count()).select_from(CharacterEvent))
    assert stored is not None
    assert stored.server_revision == 3
    assert stored.data == {"hp_current": "6", "gold": "9"}
    assert event_count == 2


@pytest.mark.asyncio
async def test_same_base_revision_on_same_path_persists_one_conflict(
    postgres_sessions: async_sessionmaker[AsyncSession],
) -> None:
    owner, character = await create_owner_character(postgres_sessions)
    first = make_request(path="/data/hp_current", value="6")
    second = make_request(path="/data/hp_current", value="7")

    results = await asyncio.gather(
        submit_mutation(
            postgres_sessions,
            owner_id=owner.id,
            character_id=character.id,
            request=first,
        ),
        submit_mutation(
            postgres_sessions,
            owner_id=owner.id,
            character_id=character.id,
            request=second,
        ),
    )

    assert (
        sum(
            isinstance(result, mutation_service.CharacterMutationAppliedResult)
            for result in results
        )
        == 1
    )
    assert (
        sum(
            isinstance(result, mutation_service.CharacterMutationConflictResult)
            for result in results
        )
        == 1
    )

    async with postgres_sessions() as session:
        stored = await session.get(CloudCharacter, character.id)
        mutation_count = await session.scalar(select(func.count()).select_from(CharacterMutation))
        event_count = await session.scalar(select(func.count()).select_from(CharacterEvent))
    assert stored is not None
    assert stored.server_revision == 2
    assert stored.data["hp_current"] in {"6", "7"}
    assert mutation_count == 2
    assert event_count == 1
