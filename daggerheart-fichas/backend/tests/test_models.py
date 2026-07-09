from sqlalchemy import CheckConstraint, Index

from app.db.base import Base
from app.models import CloudBackup, CloudCharacter, RefreshSession, User


def test_auth_backup_and_cloud_character_tables_are_registered() -> None:
    assert User.__tablename__ in Base.metadata.tables
    assert RefreshSession.__tablename__ in Base.metadata.tables
    assert CloudBackup.__tablename__ in Base.metadata.tables
    assert CloudCharacter.__tablename__ in Base.metadata.tables


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
