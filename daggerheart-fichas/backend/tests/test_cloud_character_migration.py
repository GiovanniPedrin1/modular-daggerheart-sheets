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
    / "202607090001_create_cloud_characters.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("cloud_character_migration", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cloud_character_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090001"
    assert migration.down_revision == "202607020001"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_creates_cloud_character_table_constraints_and_indexes() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    table_call = fake_op.create_table.call_args
    assert table_call.args[0] == "cloud_characters"
    table_items = table_call.args[1:]

    columns = {
        item.name: item
        for item in table_items
        if isinstance(item, sa.Column)
    }
    assert set(columns) == {
        "id",
        "owner_user_id",
        "local_character_id",
        "name",
        "system",
        "class_key",
        "language",
        "data",
        "server_revision",
        "content_hash",
        "schema_version",
        "created_at",
        "updated_at",
        "deleted_at",
        "updated_by_device_id",
    }
    assert columns["data"].type.__class__.__name__ == "JSONB"
    assert columns["server_revision"].server_default.arg == "1"
    assert columns["schema_version"].server_default.arg == "1"
    assert columns["deleted_at"].nullable is True

    foreign_keys = [
        item
        for item in table_items
        if isinstance(item, sa.ForeignKeyConstraint)
    ]
    assert len(foreign_keys) == 1
    assert foreign_keys[0].elements[0].target_fullname == "users.id"
    assert foreign_keys[0].ondelete == "CASCADE"

    checks = {
        item.name
        for item in table_items
        if isinstance(item, sa.CheckConstraint)
    }
    assert checks == {
        "ck_cloud_characters_class_key_matches_system",
        "ck_cloud_characters_language_supported",
        "ck_cloud_characters_schema_version_positive",
        "ck_cloud_characters_server_revision_positive",
        "ck_cloud_characters_system_supported",
    }

    index_calls = {
        call.args[0]: call
        for call in fake_op.create_index.call_args_list
    }
    assert set(index_calls) == {
        "idx_cloud_characters_owner_updated_active",
        "ix_cloud_characters_owner_user_id",
        "uq_cloud_characters_owner_local_active",
    }
    unique_call = index_calls["uq_cloud_characters_owner_local_active"]
    assert unique_call.args[2] == ["owner_user_id", "local_character_id"]
    assert unique_call.kwargs["unique"] is True
    assert str(unique_call.kwargs["postgresql_where"]) == (
        "deleted_at IS NULL AND local_character_id IS NOT NULL"
    )


def test_downgrade_removes_indexes_before_table() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.drop_index.call_args_list] == [
        "uq_cloud_characters_owner_local_active",
        "ix_cloud_characters_owner_user_id",
        "idx_cloud_characters_owner_updated_active",
    ]
    fake_op.drop_table.assert_called_once_with("cloud_characters")
