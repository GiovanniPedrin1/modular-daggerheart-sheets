from sqlalchemy import BigInteger, CheckConstraint, Index

from app.db.base import Base
from app.models import (
    CharacterEvent,
    CharacterMutation,
    CharacterShare,
    CloudBackup,
    CloudCharacter,
    RefreshSession,
    User,
)


def test_auth_backup_cloud_character_share_and_event_tables_are_registered() -> None:
    assert User.__tablename__ in Base.metadata.tables
    assert RefreshSession.__tablename__ in Base.metadata.tables
    assert CloudBackup.__tablename__ in Base.metadata.tables
    assert CloudCharacter.__tablename__ in Base.metadata.tables
    assert CharacterShare.__tablename__ in Base.metadata.tables
    assert CharacterEvent.__tablename__ in Base.metadata.tables
    assert CharacterMutation.__tablename__ in Base.metadata.tables


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
        item.name: item for item in CloudCharacter.__table__.indexes if isinstance(item, Index)
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
        item.name: item for item in CharacterShare.__table__.indexes if isinstance(item, Index)
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


def test_character_event_uses_monotonic_cursor_and_jsonb_payloads() -> None:
    table = CharacterEvent.__table__

    assert isinstance(table.c.id.type, BigInteger)
    assert table.c.id.identity is not None
    assert table.c.id.identity.start == 1
    assert table.c.snapshot.type.__class__.__name__ == "JSONB"
    assert table.c.patch.type.__class__.__name__ == "JSONB"
    assert table.c.changed_paths.type.__class__.__name__ == "JSONB"
    assert table.c.snapshot.nullable is True
    assert table.c.patch.nullable is True
    assert table.c.changed_paths.nullable is True
    assert table.c.actor_user_id.nullable is True
    assert table.c.audience_user_id.nullable is True
    assert table.c.device_id.type.length == 128


def test_character_event_has_domain_check_constraints() -> None:
    constraint_names = {
        constraint.name
        for constraint in CharacterEvent.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert constraint_names == {
        "ck_character_events_changed_paths_array",
        "ck_character_events_event_type_supported",
        "ck_character_events_payload_matches_event_type",
        "ck_character_events_server_revision_positive",
    }


def test_character_event_has_replay_retention_and_uniqueness_indexes() -> None:
    indexes = {
        item.name: item for item in CharacterEvent.__table__.indexes if isinstance(item, Index)
    }

    assert set(indexes) == {
        "idx_character_events_audience_cursor",
        "idx_character_events_character_created",
        "idx_character_events_character_cursor",
        "idx_character_events_character_revision",
        "uq_character_events_character_content_revision",
    }

    content_revision = indexes["uq_character_events_character_content_revision"]
    assert content_revision.unique is True
    assert [column.name for column in content_revision.columns] == [
        "character_id",
        "server_revision",
    ]
    assert str(content_revision.dialect_options["postgresql"]["where"]) == (
        "event_type IN ('updated', 'deleted')"
    )

    audience_cursor = indexes["idx_character_events_audience_cursor"]
    assert [column.name for column in audience_cursor.columns] == [
        "audience_user_id",
        "id",
    ]
    assert str(audience_cursor.dialect_options["postgresql"]["where"]) == (
        "audience_user_id IS NOT NULL"
    )


def test_character_event_foreign_keys_have_expected_delete_behavior() -> None:
    foreign_keys = {
        foreign_key.parent.name: (foreign_key.target_fullname, foreign_key.ondelete)
        for foreign_key in CharacterEvent.__table__.foreign_keys
    }

    assert foreign_keys == {
        "character_id": ("cloud_characters.id", "CASCADE"),
        "actor_user_id": ("users.id", "SET NULL"),
        "audience_user_id": ("users.id", "CASCADE"),
    }


def test_character_mutation_persists_idempotency_patch_and_conflict_data() -> None:
    table = CharacterMutation.__table__

    assert table.c.changed_paths.type.__class__.__name__ == "JSONB"
    assert table.c.operations.type.__class__.__name__ == "JSONB"
    assert table.c.conflict_paths.type.__class__.__name__ == "JSONB"
    assert table.c.server_changed_paths.type.__class__.__name__ == "JSONB"
    assert table.c.conflict_server_character.type.__class__.__name__ == "JSONB"
    assert table.c.device_id.type.length == 128
    assert table.c.request_hash.type.length == 64
    assert table.c.merged.server_default.arg == "false"
    assert table.c.unchanged.server_default.arg == "false"
    assert table.c.applied_revision.nullable is True
    assert table.c.conflict_server_revision.nullable is True
    assert table.c.rejection_code.nullable is True
    assert table.c.created_at.server_default is not None


def test_character_mutation_has_domain_check_constraints() -> None:
    constraint_names = {
        constraint.name
        for constraint in CharacterMutation.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert constraint_names == {
        "ck_character_mutations_applied_revision_positive",
        "ck_character_mutations_base_revision_positive",
        "ck_character_mutations_changed_paths_array",
        "ck_character_mutations_lifecycle_consistent",
        "ck_character_mutations_operations_array",
        "ck_character_mutations_request_hash_sha256",
        "ck_character_mutations_schema_version_positive",
        "ck_character_mutations_status_supported",
    }


def test_character_mutation_has_idempotency_and_query_indexes() -> None:
    indexes = {
        item.name: item for item in CharacterMutation.__table__.indexes if isinstance(item, Index)
    }

    assert set(indexes) == {
        "idx_character_mutations_character_applied_revision",
        "idx_character_mutations_character_created",
        "idx_character_mutations_owner_created",
        "uq_character_mutations_character_device_mutation",
    }

    idempotency = indexes["uq_character_mutations_character_device_mutation"]
    assert idempotency.unique is True
    assert [column.name for column in idempotency.columns] == [
        "character_id",
        "device_id",
        "mutation_id",
    ]

    applied_revision = indexes["idx_character_mutations_character_applied_revision"]
    assert [column.name for column in applied_revision.columns] == [
        "character_id",
        "applied_revision",
    ]
    assert str(applied_revision.dialect_options["postgresql"]["where"]) == (
        "status = 'applied'"
    )


def test_character_mutation_foreign_keys_have_expected_delete_behavior() -> None:
    foreign_keys = {
        foreign_key.parent.name: (foreign_key.target_fullname, foreign_key.ondelete)
        for foreign_key in CharacterMutation.__table__.foreign_keys
    }

    assert foreign_keys == {
        "character_id": ("cloud_characters.id", "CASCADE"),
        "owner_user_id": ("users.id", "CASCADE"),
    }
