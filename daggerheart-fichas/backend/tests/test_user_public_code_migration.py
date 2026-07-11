from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import sqlalchemy as sa

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "202607090003_add_user_public_codes.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("user_public_code_migration", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_user_public_code_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090003"
    assert migration.down_revision == "202607090002"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_backfills_public_codes_before_requiring_and_indexing_them() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    added_column = fake_op.add_column.call_args.args[1]
    assert isinstance(added_column, sa.Column)
    assert added_column.name == "public_user_code"
    assert added_column.type.length == 32
    assert added_column.nullable is True

    executed_sql = str(fake_op.execute.call_args.args[0])
    assert "upper(replace(id::text, '-', ''))" in executed_sql

    fake_op.alter_column.assert_called_once()
    alter_call = fake_op.alter_column.call_args
    assert alter_call.args == ("users", "public_user_code")
    assert alter_call.kwargs["existing_type"].length == 32
    assert alter_call.kwargs["nullable"] is False
    fake_op.create_index.assert_called_once_with(
        "ix_users_public_user_code",
        "users",
        ["public_user_code"],
        unique=True,
    )


def test_downgrade_removes_index_before_column() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    fake_op.drop_index.assert_called_once_with(
        "ix_users_public_user_code",
        table_name="users",
    )
    fake_op.drop_column.assert_called_once_with("users", "public_user_code")
