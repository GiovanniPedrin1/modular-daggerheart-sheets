from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "202607090009_add_data_lifecycle_indexes.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("data_lifecycle_migration", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()
    assert migration.revision == "202607090009"
    assert migration.down_revision == "202607090008"


def test_upgrade_adds_partial_indexes_for_privacy_maintenance() -> None:
    migration = load_migration()
    fake_op = Mock()
    migration.op = fake_op

    migration.upgrade()

    names = [call.args[0] for call in fake_op.create_index.call_args_list]
    assert names == [
        "idx_cloud_characters_deleted_at",
        "idx_character_shares_pending_created",
        "idx_character_shares_revoked_at",
        "idx_refresh_sessions_revoked_at",
    ]
    predicates = [
        str(call.kwargs["postgresql_where"])
        for call in fake_op.create_index.call_args_list
    ]
    assert predicates == [
        "deleted_at IS NOT NULL",
        "status = 'pending'",
        "status = 'revoked' AND revoked_at IS NOT NULL",
        "revoked_at IS NOT NULL",
    ]


def test_downgrade_removes_all_lifecycle_indexes() -> None:
    migration = load_migration()
    fake_op = Mock()
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.drop_index.call_args_list] == [
        "idx_refresh_sessions_revoked_at",
        "idx_character_shares_revoked_at",
        "idx_character_shares_pending_created",
        "idx_cloud_characters_deleted_at",
    ]
