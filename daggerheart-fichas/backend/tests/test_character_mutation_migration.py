from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "202607090005_create_character_mutations.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "character_mutation_migration",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_character_mutation_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090005"
    assert migration.down_revision == "202607090004"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_creates_character_mutation_table_constraints_and_indexes() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    table_call = fake_op.create_table.call_args
    assert table_call.args[0] == "character_mutations"
    table_items = table_call.args[1:]

    columns = {item.name: item for item in table_items if isinstance(item, sa.Column)}
    assert set(columns) == {
        "id",
        "character_id",
        "owner_user_id",
        "mutation_id",
        "device_id",
        "base_revision",
        "applied_revision",
        "schema_version",
        "changed_paths",
        "operations",
        "request_hash",
        "status",
        "merged",
        "unchanged",
        "conflict_paths",
        "server_changed_paths",
        "conflict_server_revision",
        "conflict_server_character",
        "rejection_code",
        "rejection_reason",
        "created_at",
    }
    assert isinstance(columns["id"].type, postgresql.UUID)
    assert isinstance(columns["changed_paths"].type, postgresql.JSONB)
    assert isinstance(columns["operations"].type, postgresql.JSONB)
    assert isinstance(columns["conflict_paths"].type, postgresql.JSONB)
    assert isinstance(columns["server_changed_paths"].type, postgresql.JSONB)
    assert isinstance(columns["conflict_server_character"].type, postgresql.JSONB)
    assert columns["device_id"].type.length == 128
    assert columns["request_hash"].type.length == 64
    assert columns["merged"].server_default.arg.text == "false"
    assert columns["unchanged"].server_default.arg.text == "false"
    assert columns["created_at"].server_default.arg.text == "now()"

    foreign_keys = [item for item in table_items if isinstance(item, sa.ForeignKeyConstraint)]
    assert {
        (
            foreign_key.column_keys[0],
            foreign_key.elements[0].target_fullname,
            foreign_key.ondelete,
        )
        for foreign_key in foreign_keys
    } == {
        ("character_id", "cloud_characters.id", "CASCADE"),
        ("owner_user_id", "users.id", "CASCADE"),
    }

    checks = {item.name for item in table_items if isinstance(item, sa.CheckConstraint)}
    assert checks == {
        "ck_character_mutations_applied_revision_positive",
        "ck_character_mutations_base_revision_positive",
        "ck_character_mutations_changed_paths_array",
        "ck_character_mutations_lifecycle_consistent",
        "ck_character_mutations_operations_array",
        "ck_character_mutations_request_hash_sha256",
        "ck_character_mutations_schema_version_positive",
        "ck_character_mutations_status_supported",
    }

    index_calls = {call.args[0]: call for call in fake_op.create_index.call_args_list}
    assert set(index_calls) == {
        "idx_character_mutations_character_applied_revision",
        "idx_character_mutations_character_created",
        "idx_character_mutations_owner_created",
        "uq_character_mutations_character_device_mutation",
    }

    idempotency = index_calls["uq_character_mutations_character_device_mutation"]
    assert idempotency.args[2] == ["character_id", "device_id", "mutation_id"]
    assert idempotency.kwargs["unique"] is True

    applied_revision = index_calls["idx_character_mutations_character_applied_revision"]
    assert applied_revision.args[2] == ["character_id", "applied_revision"]
    assert applied_revision.kwargs["unique"] is False
    assert str(applied_revision.kwargs["postgresql_where"]) == "status = 'applied'"


def test_downgrade_removes_indexes_before_table() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.drop_index.call_args_list] == [
        "uq_character_mutations_character_device_mutation",
        "idx_character_mutations_owner_created",
        "idx_character_mutations_character_created",
        "idx_character_mutations_character_applied_revision",
    ]
    fake_op.drop_table.assert_called_once_with("character_mutations")
