from sqlalchemy import CheckConstraint, Index

from app.db.base import Base
from app.models import CharacterShare, CloudBackup, CloudCharacter, RefreshSession, User


def test_auth_backup_cloud_character_and_share_tables_are_registered() -> None:
    assert User.__tablename__ in Base.metadata.tables
    assert RefreshSession.__tablename__ in Base.metadata.tables
    assert CloudBackup.__tablename__ in Base.metadata.tables
    assert CloudCharacter.__tablename__ in Base.metadata.tables
    assert CharacterShare.__tablename__ in Base.metadata.tables


def test_user_has_unique_public_code_index() -> None:
    table = User.__table__
    column = table.c.public_user_code
    indexes = {item.name: item for item in table.indexes if isinstance(item, Index)}

    assert column.nullable is False
    assert column.type.length == 32
    assert column.default is not None
    assert indexes["ix_users_public_user_code"].unique is True


def test_cloud_backup_payload_uses_jsonb() -> None:
    payload_column = CloudBackup.__table__.c.payload
    assert payload_column.type.__class__.__name__ == "JSONB"


def test_cloud_character_snapshot_uses_jsonb_and_revision_defaults() -> None:
    table = CloudCharacter.__table__

    assert table.c.data.type.__class__.__name__ == "JSONB"
    assert table.c.server_revision.server_default.arg == "1"
    assert table.c.schema_version.server_default.arg == "1"
    assert table.c.deleted_at.nullable is True


def test_cloud_character_has_active_owner_local_unique_index() -> None:
    indexes = {
        item.name: item
        for item in CloudCharacter.__table__.indexes
        if isinstance(item, Index)
    }
    unique_index = indexes["uq_cloud_characters_owner_local_active"]

    assert unique_index.unique is True
    assert [column.name for column in unique_index.columns] == [
        "owner_user_id",
        "local_character_id",
    ]
    assert str(unique_index.dialect_options["postgresql"]["where"]) == (
        "deleted_at IS NULL AND local_character_id IS NOT NULL"
    )


def test_cloud_character_has_domain_check_constraints() -> None:
    constraint_names = {
        constraint.name
        for constraint in CloudCharacter.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert constraint_names == {
        "ck_cloud_characters_class_key_matches_system",
        "ck_cloud_characters_language_supported",
        "ck_cloud_characters_schema_version_positive",
        "ck_cloud_characters_server_revision_positive",
        "ck_cloud_characters_system_supported",
    }


def test_character_share_has_expected_defaults_and_nullable_targets() -> None:
    table = CharacterShare.__table__

    assert table.c.role.server_default.arg == "viewer"
    assert table.c.status.server_default.arg == "pending"
    assert table.c.target_user_id.nullable is True
    assert table.c.target_email.nullable is True
    assert table.c.target_public_user_code.nullable is True
    assert table.c.accepted_at.nullable is True
    assert table.c.revoked_at.nullable is True


def test_character_share_has_current_target_uniqueness_indexes() -> None:
    indexes = {
        item.name: item
        for item in CharacterShare.__table__.indexes
        if isinstance(item, Index)
    }

    expected = {
        "uq_character_shares_character_target_user_current": (
            ["character_id", "target_user_id"],
            "status IN ('pending', 'active') AND target_user_id IS NOT NULL",
        ),
        "uq_character_shares_character_target_email_current": (
            ["character_id", "target_email"],
            "status IN ('pending', 'active') AND target_email IS NOT NULL",
        ),
        "uq_character_shares_character_target_code_current": (
            ["character_id", "target_public_user_code"],
            "status IN ('pending', 'active') AND target_public_user_code IS NOT NULL",
        ),
    }

    for index_name, (columns, where_clause) in expected.items():
        index = indexes[index_name]
        assert index.unique is True
        assert [column.name for column in index.columns] == columns
        assert str(index.dialect_options["postgresql"]["where"]) == where_clause


def test_character_share_has_domain_check_constraints() -> None:
    constraint_names = {
        constraint.name
        for constraint in CharacterShare.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert constraint_names == {
        "ck_character_shares_exactly_one_target_label",
        "ck_character_shares_lifecycle_consistent",
        "ck_character_shares_public_code_requires_user",
        "ck_character_shares_role_supported",
        "ck_character_shares_status_supported",
        "ck_character_shares_target_email_normalized",
        "ck_character_shares_target_public_user_code_normalized",
    }
