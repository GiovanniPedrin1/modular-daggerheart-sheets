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
    / "202607090007_create_audit_events.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("audit_event_migration", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_audit_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090007"
    assert migration.down_revision == "202607090006"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_creates_minimized_append_only_audit_table() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    table_call = fake_op.create_table.call_args
    assert table_call.args[0] == "audit_events"
    table_items = table_call.args[1:]
    columns = {item.name: item for item in table_items if isinstance(item, sa.Column)}
    assert set(columns) == {
        "id",
        "actor_user_id",
        "target_user_id",
        "character_id",
        "action",
        "outcome",
        "resource_type",
        "resource_id",
        "request_id",
        "device_id",
        "client_ip",
        "user_agent",
        "metadata",
        "created_at",
    }
    assert isinstance(columns["id"].type, postgresql.UUID)
    assert isinstance(columns["metadata"].type, postgresql.JSONB)
    assert columns["request_id"].type.length == 128
    assert columns["device_id"].type.length == 128
    assert columns["user_agent"].type.length == 512

    foreign_keys = [item for item in table_items if isinstance(item, sa.ForeignKeyConstraint)]
    assert {
        (
            foreign_key.column_keys[0],
            foreign_key.elements[0].target_fullname,
            foreign_key.ondelete,
        )
        for foreign_key in foreign_keys
    } == {
        ("actor_user_id", "users.id", "SET NULL"),
        ("target_user_id", "users.id", "SET NULL"),
        ("character_id", "cloud_characters.id", "SET NULL"),
    }

    execute_sql = [call.args[0] for call in fake_op.execute.call_args_list]
    assert any("CREATE FUNCTION prevent_audit_event_update" in sql for sql in execute_sql)
    assert any("CREATE TRIGGER audit_events_prevent_update" in sql for sql in execute_sql)

    index_names = {call.args[0] for call in fake_op.create_index.call_args_list}
    assert index_names == {
        "idx_audit_events_created",
        "idx_audit_events_action_created",
        "idx_audit_events_actor_created",
        "idx_audit_events_character_created",
        "idx_audit_events_request_id",
    }


def test_downgrade_removes_indexes_before_table() -> None:
    migration = load_migration()
    fake_op = Mock()
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.execute.call_args_list] == [
        "DROP TRIGGER IF EXISTS audit_events_prevent_update ON audit_events",
        "DROP FUNCTION IF EXISTS prevent_audit_event_update()",
    ]
    assert [call.args[0] for call in fake_op.drop_index.call_args_list] == [
        "idx_audit_events_request_id",
        "idx_audit_events_character_created",
        "idx_audit_events_actor_created",
        "idx_audit_events_action_created",
        "idx_audit_events_created",
    ]
    fake_op.drop_table.assert_called_once_with("audit_events")
