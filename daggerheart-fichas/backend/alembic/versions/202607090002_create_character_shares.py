"""create character shares

Revision ID: 202607090002
Revises: 202607090001
Create Date: 2026-07-09 00:02:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607090002"
down_revision: str | None = "202607090001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "character_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("character_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_email", sa.String(length=320), nullable=True),
        sa.Column("target_public_user_code", sa.String(length=32), nullable=True),
        sa.Column(
            "role",
            sa.String(length=32),
            server_default="viewer",
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="pending",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(target_email IS NOT NULL AND target_public_user_code IS NULL) "
            "OR (target_email IS NULL AND target_public_user_code IS NOT NULL)",
            name=op.f("ck_character_shares_exactly_one_target_label"),
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND target_user_id IS NULL "
            "AND target_email IS NOT NULL AND accepted_at IS NULL "
            "AND revoked_at IS NULL) "
            "OR (status = 'active' AND target_user_id IS NOT NULL "
            "AND accepted_at IS NOT NULL AND revoked_at IS NULL) "
            "OR (status = 'revoked' AND revoked_at IS NOT NULL)",
            name=op.f("ck_character_shares_lifecycle_consistent"),
        ),
        sa.CheckConstraint(
            "target_public_user_code IS NULL OR target_user_id IS NOT NULL",
            name=op.f("ck_character_shares_public_code_requires_user"),
        ),
        sa.CheckConstraint(
            "role = 'viewer'",
            name=op.f("ck_character_shares_role_supported"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'revoked')",
            name=op.f("ck_character_shares_status_supported"),
        ),
        sa.CheckConstraint(
            "target_email IS NULL OR target_email = lower(btrim(target_email))",
            name=op.f("ck_character_shares_target_email_normalized"),
        ),
        sa.CheckConstraint(
            "target_public_user_code IS NULL "
            "OR target_public_user_code = upper(btrim(target_public_user_code))",
            name=op.f("ck_character_shares_target_public_user_code_normalized"),
        ),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["cloud_characters.id"],
            name=op.f("fk_character_shares_character_id_cloud_characters"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name=op.f("fk_character_shares_owner_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_user_id"],
            ["users.id"],
            name=op.f("fk_character_shares_target_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_character_shares")),
    )
    op.create_index(
        "idx_character_shares_character_current_created",
        "character_shares",
        ["character_id", "created_at"],
        unique=False,
        postgresql_where=sa.text("status IN ('pending', 'active')"),
    )
    op.create_index(
        "idx_character_shares_target_active_created",
        "character_shares",
        ["target_user_id", "created_at"],
        unique=False,
        postgresql_where=sa.text(
            "status = 'active' AND target_user_id IS NOT NULL"
        ),
    )
    op.create_index(
        op.f("ix_character_shares_owner_user_id"),
        "character_shares",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        "uq_character_shares_character_target_code_current",
        "character_shares",
        ["character_id", "target_public_user_code"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending', 'active') "
            "AND target_public_user_code IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_character_shares_character_target_email_current",
        "character_shares",
        ["character_id", "target_email"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending', 'active') AND target_email IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_character_shares_character_target_user_current",
        "character_shares",
        ["character_id", "target_user_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending', 'active') AND target_user_id IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_character_shares_character_target_user_current",
        table_name="character_shares",
        postgresql_where=sa.text(
            "status IN ('pending', 'active') AND target_user_id IS NOT NULL"
        ),
    )
    op.drop_index(
        "uq_character_shares_character_target_email_current",
        table_name="character_shares",
        postgresql_where=sa.text(
            "status IN ('pending', 'active') AND target_email IS NOT NULL"
        ),
    )
    op.drop_index(
        "uq_character_shares_character_target_code_current",
        table_name="character_shares",
        postgresql_where=sa.text(
            "status IN ('pending', 'active') "
            "AND target_public_user_code IS NOT NULL"
        ),
    )
    op.drop_index(
        op.f("ix_character_shares_owner_user_id"),
        table_name="character_shares",
    )
    op.drop_index(
        "idx_character_shares_target_active_created",
        table_name="character_shares",
        postgresql_where=sa.text(
            "status = 'active' AND target_user_id IS NOT NULL"
        ),
    )
    op.drop_index(
        "idx_character_shares_character_current_created",
        table_name="character_shares",
        postgresql_where=sa.text("status IN ('pending', 'active')"),
    )
    op.drop_table("character_shares")
