from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from app.models.cloud_character import CloudCharacter
from app.services import cloud_character_service as service


class CapturingSession:
    def __init__(self, result) -> None:
        self.result = result
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.result


def compile_postgres(statement) -> str:
    compiled = statement.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    )
    return " ".join(str(compiled).split())


def scalar_result(value):
    return SimpleNamespace(scalar_one_or_none=lambda: value)


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: values),
    )


def make_character(*, owner_user_id):
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id,
        local_character_id="local-char-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={},
        server_revision=1,
        content_hash="a" * 64,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=None,
        updated_by_device_id="device-1",
    )


@pytest.mark.asyncio
async def test_find_by_local_id_is_scoped_to_owner_and_active_rows() -> None:
    owner_id = uuid4()
    session = CapturingSession(scalar_result(None))

    result = await service.find_active_cloud_character_by_local_id(
        session,
        owner_user_id=owner_id,
        local_character_id="local-char-1",
    )

    assert result is None
    sql = compile_postgres(session.statements[0])
    assert f"cloud_characters.owner_user_id = '{owner_id}'" in sql
    assert "cloud_characters.local_character_id = 'local-char-1'" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql


@pytest.mark.asyncio
async def test_owner_list_is_active_only_and_deterministically_ordered() -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    session = CapturingSession(scalar_list_result([character]))

    result = await service.list_owner_cloud_characters(
        session,
        owner_user_id=owner_id,
    )

    assert result == [character]
    sql = compile_postgres(session.statements[0])
    assert f"cloud_characters.owner_user_id = '{owner_id}'" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql
    assert (
        "ORDER BY cloud_characters.updated_at DESC, cloud_characters.id DESC"
        in sql
    )


@pytest.mark.asyncio
async def test_mutable_lookup_masks_foreign_rows_and_uses_row_lock() -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    session = CapturingSession(scalar_result(character))

    result = await service.get_owner_cloud_character(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        for_update=True,
    )

    assert result is character
    sql = compile_postgres(session.statements[0])
    assert f"cloud_characters.id = '{character.id}'" in sql
    assert f"cloud_characters.owner_user_id = '{owner_id}'" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql
    assert sql.endswith("FOR UPDATE")
