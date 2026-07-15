from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "202607090006_allow_snapshot_event_changed_paths.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "character_event_changed_paths_migration",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090006"
    assert migration.down_revision == "202607090005"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_replaces_payload_constraint_and_validates_path_array() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    fake_op.drop_constraint.assert_called_once_with(
        "ck_character_events_payload_matches_event_type",
        "character_events",
        type_="check",
    )
    assert [call.args[0] for call in fake_op.create_check_constraint.call_args_list] == [
        "ck_character_events_payload_matches_event_type",
        "ck_character_events_changed_paths_array",
    ]

    payload_sql = fake_op.create_check_constraint.call_args_list[0].args[2]
    assert "patch IS NULL OR changed_paths IS NOT NULL" in payload_sql
    assert "snapshot IS NOT NULL AND patch IS NULL" in payload_sql

    changed_paths_sql = fake_op.create_check_constraint.call_args_list[1].args[2]
    assert "jsonb_typeof(changed_paths) = 'array'" in changed_paths_sql
    assert "BETWEEN 1 AND 128" in changed_paths_sql


def test_downgrade_removes_path_metadata_before_restoring_legacy_constraint() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.drop_constraint.call_args_list] == [
        "ck_character_events_changed_paths_array",
        "ck_character_events_payload_matches_event_type",
    ]
    executed = fake_op.execute.call_args.args[0]
    assert "SET changed_paths = NULL" in str(executed)
    assert fake_op.create_check_constraint.call_args.args[0] == (
        "ck_character_events_payload_matches_event_type"
    )
    legacy_sql = fake_op.create_check_constraint.call_args.args[2]
    assert "patch IS NULL AND changed_paths IS NULL" in legacy_sql
