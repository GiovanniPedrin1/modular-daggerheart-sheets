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
    / "202607090002_create_character_shares.py"
)


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("character_share_migration", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_character_share_migration_is_in_expected_revision_chain() -> None:
    migration = load_migration()

    assert migration.revision == "202607090002"
    assert migration.down_revision == "202607090001"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_creates_character_share_table_constraints_and_indexes() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.upgrade()

    table_call = fake_op.create_table.call_args
    assert table_call.args[0] == "character_shares"
    table_items = table_call.args[1:]

    columns = {
        item.name: item
        for item in table_items
        if isinstance(item, sa.Column)
    }
    assert set(columns) == {
        "id",
        "character_id",
        "owner_user_id",
        "target_user_id",
        "target_email",
        "target_public_user_code",
        "role",
        "status",
        "created_at",
        "accepted_at",
        "revoked_at",
    }
    assert columns["role"].server_default.arg == "viewer"
    assert columns["status"].server_default.arg == "pending"
    assert columns["target_user_id"].nullable is True
    assert columns["accepted_at"].nullable is True
    assert columns["revoked_at"].nullable is True

    foreign_keys = [
        item
        for item in table_items
        if isinstance(item, sa.ForeignKeyConstraint)
    ]
    assert {
        (foreign_key.elements[0].target_fullname, foreign_key.ondelete)
        for foreign_key in foreign_keys
    } == {
        ("cloud_characters.id", "CASCADE"),
        ("users.id", "CASCADE"),
    }
    assert len(foreign_keys) == 3

    checks = {
        item.name
        for item in table_items
        if isinstance(item, sa.CheckConstraint)
    }
    assert checks == {
        "ck_character_shares_exactly_one_target_label",
        "ck_character_shares_lifecycle_consistent",
        "ck_character_shares_public_code_requires_user",
        "ck_character_shares_role_supported",
        "ck_character_shares_status_supported",
        "ck_character_shares_target_email_normalized",
        "ck_character_shares_target_public_user_code_normalized",
    }

    index_calls = {
        call.args[0]: call
        for call in fake_op.create_index.call_args_list
    }
    assert set(index_calls) == {
        "idx_character_shares_character_current_created",
        "idx_character_shares_target_active_created",
        "ix_character_shares_owner_user_id",
        "uq_character_shares_character_target_code_current",
        "uq_character_shares_character_target_email_current",
        "uq_character_shares_character_target_user_current",
    }

    target_user_unique = index_calls[
        "uq_character_shares_character_target_user_current"
    ]
    assert target_user_unique.args[2] == ["character_id", "target_user_id"]
    assert target_user_unique.kwargs["unique"] is True
    assert str(target_user_unique.kwargs["postgresql_where"]) == (
        "status IN ('pending', 'active') AND target_user_id IS NOT NULL"
    )


def test_downgrade_removes_indexes_before_table() -> None:
    migration = load_migration()
    fake_op = Mock()
    fake_op.f.side_effect = lambda name: name
    migration.op = fake_op

    migration.downgrade()

    assert [call.args[0] for call in fake_op.drop_index.call_args_list] == [
        "uq_character_shares_character_target_user_current",
        "uq_character_shares_character_target_email_current",
        "uq_character_shares_character_target_code_current",
        "ix_character_shares_owner_user_id",
        "idx_character_shares_target_active_created",
        "idx_character_shares_character_current_created",
    ]
    fake_op.drop_table.assert_called_once_with("character_shares")
