"""create character mutations

Revision ID: 202607090005
Revises: 202607090004
Create Date: 2026-07-09 00:05:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607090005"
down_revision: str | None = "202607090004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "character_mutations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("character_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mutation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("base_revision", sa.Integer(), nullable=False),
        sa.Column("applied_revision", sa.Integer(), nullable=True),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "changed_paths",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "operations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "merged",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "unchanged",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "conflict_paths",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "server_changed_paths",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("conflict_server_revision", sa.Integer(), nullable=True),
        sa.Column(
            "conflict_server_character",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("rejection_code", sa.String(length=64), nullable=True),
        sa.Column("rejection_reason", sa.String(length=240), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('applied', 'conflict', 'rejected')",
            name=op.f("ck_character_mutations_status_supported"),
        ),
        sa.CheckConstraint(
            "base_revision >= 1",
            name=op.f("ck_character_mutations_base_revision_positive"),
        ),
        sa.CheckConstraint(
            "applied_revision IS NULL OR applied_revision >= 1",
            name=op.f("ck_character_mutations_applied_revision_positive"),
        ),
        sa.CheckConstraint(
            "schema_version >= 1",
            name=op.f("ck_character_mutations_schema_version_positive"),
        ),
        sa.CheckConstraint(
            "char_length(request_hash) = 64 "
            "AND request_hash = lower(request_hash) "
            "AND request_hash ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_character_mutations_request_hash_sha256"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(changed_paths) = 'array' "
            "AND jsonb_array_length(changed_paths) BETWEEN 1 AND 128",
            name=op.f("ck_character_mutations_changed_paths_array"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(operations) = 'array' "
            "AND jsonb_array_length(operations) BETWEEN 1 AND 128",
            name=op.f("ck_character_mutations_operations_array"),
        ),
        sa.CheckConstraint(
            "(status = 'applied' "
            "AND applied_revision IS NOT NULL "
            "AND applied_revision >= base_revision "
            "AND conflict_paths IS NULL "
            "AND server_changed_paths IS NULL "
            "AND conflict_server_revision IS NULL "
            "AND conflict_server_character IS NULL "
            "AND rejection_code IS NULL "
            "AND rejection_reason IS NULL "
            "AND NOT (merged AND unchanged)) "
            "OR (status = 'conflict' "
            "AND applied_revision IS NULL "
            "AND merged = false "
            "AND unchanged = false "
            "AND conflict_paths IS NOT NULL "
            "AND jsonb_typeof(conflict_paths) = 'array' "
            "AND jsonb_array_length(conflict_paths) > 0 "
            "AND server_changed_paths IS NOT NULL "
            "AND jsonb_typeof(server_changed_paths) = 'array' "
            "AND jsonb_array_length(server_changed_paths) > 0 "
            "AND conflict_server_revision IS NOT NULL "
            "AND conflict_server_revision > base_revision "
            "AND conflict_server_character IS NOT NULL "
            "AND jsonb_typeof(conflict_server_character) = 'object' "
            "AND rejection_code IS NULL "
            "AND rejection_reason IS NULL) "
            "OR (status = 'rejected' "
            "AND applied_revision IS NULL "
            "AND merged = false "
            "AND unchanged = false "
            "AND conflict_paths IS NULL "
            "AND server_changed_paths IS NULL "
            "AND conflict_server_revision IS NULL "
            "AND conflict_server_character IS NULL "
            "AND rejection_code IS NOT NULL "
            "AND rejection_reason IS NOT NULL)",
            name=op.f("ck_character_mutations_lifecycle_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["cloud_characters.id"],
            name=op.f("fk_character_mutations_character_id_cloud_characters"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name=op.f("fk_character_mutations_owner_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_character_mutations")),
    )
    op.create_index(
        "idx_character_mutations_character_applied_revision",
        "character_mutations",
        ["character_id", "applied_revision"],
        unique=False,
        postgresql_where=sa.text("status = 'applied'"),
    )
    op.create_index(
        "idx_character_mutations_character_created",
        "character_mutations",
        ["character_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_character_mutations_owner_created",
        "character_mutations",
        ["owner_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "uq_character_mutations_character_device_mutation",
        "character_mutations",
        ["character_id", "device_id", "mutation_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_character_mutations_character_device_mutation",
        table_name="character_mutations",
    )
    op.drop_index(
        "idx_character_mutations_owner_created",
        table_name="character_mutations",
    )
    op.drop_index(
        "idx_character_mutations_character_created",
        table_name="character_mutations",
    )
    op.drop_index(
        "idx_character_mutations_character_applied_revision",
        table_name="character_mutations",
        postgresql_where=sa.text("status = 'applied'"),
    )
    op.drop_table("character_mutations")
