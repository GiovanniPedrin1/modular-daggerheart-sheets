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
    / "202607090008_validate_compacted_character_events.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "character_event_compaction_migration",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_compaction_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090008"
    assert migration.down_revision == "202607090007"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_adds_compaction_marker_contract_without_rewriting_other_patches() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    add_column = fake_op.add_column.call_args
    assert add_column.args[0] == "character_events"
    column = add_column.args[1]
    assert isinstance(column, sa.Column)
    assert column.name == "compacted_at"
    assert isinstance(column.type, sa.DateTime)
    assert column.nullable is True

    statement = fake_op.execute.call_args.args[0]
    sql = str(statement)
    assert "SET compacted_at = created_at" in sql
    assert "changed_paths_v1" in sql
    assert "patch IS NOT NULL" not in sql

    constraints = {
        call.args[0]: call.args[2]
        for call in fake_op.create_check_constraint.call_args_list
    }
    assert set(constraints) == {
        "ck_character_events_compacted_event_shape",
        "ck_character_events_compacted_patch_format",
    }
    assert "event_type = 'updated'" in constraints[
        "ck_character_events_compacted_event_shape"
    ]
    assert "jsonb_typeof(patch) = 'object'" in constraints[
        "ck_character_events_compacted_patch_format"
    ]

    fake_op.create_index.assert_called_once()
    index_call = fake_op.create_index.call_args
    assert index_call.args[:3] == (
        "idx_character_events_compacted_created",
        "character_events",
        ["created_at", "id"],
    )
    assert str(index_call.kwargs["postgresql_where"]) == "compacted_at IS NOT NULL"


def test_downgrade_removes_index_constraints_and_column() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    fake_op.drop_index.assert_called_once_with(
        "idx_character_events_compacted_created",
        table_name="character_events",
    )
    assert [call.args[0] for call in fake_op.drop_constraint.call_args_list] == [
        "ck_character_events_compacted_patch_format",
        "ck_character_events_compacted_event_shape",
    ]
    fake_op.drop_column.assert_called_once_with("character_events", "compacted_at")
