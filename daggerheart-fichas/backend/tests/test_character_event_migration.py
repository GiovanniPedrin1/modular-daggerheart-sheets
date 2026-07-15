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
    / "202607090004_create_character_events.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "character_event_migration",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_character_event_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090004"
    assert migration.down_revision == "202607090003"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_creates_character_event_table_constraints_and_indexes() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    table_call = fake_op.create_table.call_args
    assert table_call.args[0] == "character_events"
    table_items = table_call.args[1:]

    columns = {item.name: item for item in table_items if isinstance(item, sa.Column)}
    assert set(columns) == {
        "id",
        "character_id",
        "server_revision",
        "event_type",
        "snapshot",
        "patch",
        "changed_paths",
        "actor_user_id",
        "audience_user_id",
        "device_id",
        "deleted_at",
        "revoked_at",
        "created_at",
    }
    assert isinstance(columns["id"].type, sa.BigInteger)
    assert columns["id"].identity is not None
    assert columns["id"].identity.start == 1
    assert isinstance(columns["snapshot"].type, postgresql.JSONB)
    assert isinstance(columns["patch"].type, postgresql.JSONB)
    assert isinstance(columns["changed_paths"].type, postgresql.JSONB)
    assert columns["actor_user_id"].nullable is True
    assert columns["audience_user_id"].nullable is True
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
        ("actor_user_id", "users.id", "SET NULL"),
        ("audience_user_id", "users.id", "CASCADE"),
    }

    checks = {item.name for item in table_items if isinstance(item, sa.CheckConstraint)}
    assert checks == {
        "ck_character_events_event_type_supported",
        "ck_character_events_payload_matches_event_type",
        "ck_character_events_server_revision_positive",
    }

    index_calls = {call.args[0]: call for call in fake_op.create_index.call_args_list}
    assert set(index_calls) == {
        "idx_character_events_audience_cursor",
        "idx_character_events_character_created",
        "idx_character_events_character_cursor",
        "idx_character_events_character_revision",
        "uq_character_events_character_content_revision",
    }

    content_revision = index_calls["uq_character_events_character_content_revision"]
    assert content_revision.args[2] == ["character_id", "server_revision"]
    assert content_revision.kwargs["unique"] is True
    assert str(content_revision.kwargs["postgresql_where"]) == (
        "event_type IN ('updated', 'deleted')"
    )

    audience_cursor = index_calls["idx_character_events_audience_cursor"]
    assert audience_cursor.args[2] == ["audience_user_id", "id"]
    assert audience_cursor.kwargs["unique"] is False
    assert str(audience_cursor.kwargs["postgresql_where"]) == ("audience_user_id IS NOT NULL")


def test_downgrade_removes_indexes_before_table() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.drop_index.call_args_list] == [
        "uq_character_events_character_content_revision",
        "idx_character_events_character_revision",
        "idx_character_events_character_cursor",
        "idx_character_events_character_created",
        "idx_character_events_audience_cursor",
    ]
    fake_op.drop_table.assert_called_once_with("character_events")
