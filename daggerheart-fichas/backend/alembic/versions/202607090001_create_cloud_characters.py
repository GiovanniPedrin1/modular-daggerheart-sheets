"""create cloud characters

Revision ID: 202607090001
Revises: 202607020001
Create Date: 2026-07-09 00:01:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607090001"
down_revision: str | None = "202607020001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cloud_characters",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("local_character_id", sa.String(length=128), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("system", sa.String(length=32), nullable=False),
        sa.Column("class_key", sa.String(length=64), nullable=True),
        sa.Column("language", sa.String(length=16), nullable=False),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "server_revision",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "schema_version",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_device_id", sa.String(length=128), nullable=True),
        sa.CheckConstraint(
            "(system = 'daggerheart' AND class_key IS NOT NULL) "
            "OR (system = 'custom' AND class_key IS NULL)",
            name=op.f("ck_cloud_characters_class_key_matches_system"),
        ),
        sa.CheckConstraint(
            "language IN ('pt-BR', 'en-US')",
            name=op.f("ck_cloud_characters_language_supported"),
        ),
        sa.CheckConstraint(
            "schema_version >= 1",
            name=op.f("ck_cloud_characters_schema_version_positive"),
        ),
        sa.CheckConstraint(
            "server_revision >= 1",
            name=op.f("ck_cloud_characters_server_revision_positive"),
        ),
        sa.CheckConstraint(
            "system IN ('daggerheart', 'custom')",
            name=op.f("ck_cloud_characters_system_supported"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name=op.f("fk_cloud_characters_owner_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cloud_characters")),
    )
    op.create_index(
        "idx_cloud_characters_owner_updated_active",
        "cloud_characters",
        ["owner_user_id", "updated_at"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        op.f("ix_cloud_characters_owner_user_id"),
        "cloud_characters",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        "uq_cloud_characters_owner_local_active",
        "cloud_characters",
        ["owner_user_id", "local_character_id"],
        unique=True,
        postgresql_where=sa.text(
            "deleted_at IS NULL AND local_character_id IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_cloud_characters_owner_local_active",
        table_name="cloud_characters",
        postgresql_where=sa.text(
            "deleted_at IS NULL AND local_character_id IS NOT NULL"
        ),
    )
    op.drop_index(
        op.f("ix_cloud_characters_owner_user_id"),
        table_name="cloud_characters",
    )
    op.drop_index(
        "idx_cloud_characters_owner_updated_active",
        table_name="cloud_characters",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("cloud_characters")
