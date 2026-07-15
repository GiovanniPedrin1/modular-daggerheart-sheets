"""create character events

Revision ID: 202607090004
Revises: 202607090003
Create Date: 2026-07-09 00:04:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607090004"
down_revision: str | None = "202607090003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "character_events",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(start=1),
            nullable=False,
        ),
        sa.Column("character_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_revision", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("patch", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "changed_paths",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("audience_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('updated', 'deleted', 'share_revoked')",
            name=op.f("ck_character_events_event_type_supported"),
        ),
        sa.CheckConstraint(
            "(event_type = 'updated' "
            "AND ((snapshot IS NOT NULL AND patch IS NULL) "
            "OR (snapshot IS NULL AND patch IS NOT NULL)) "
            "AND ((patch IS NULL AND changed_paths IS NULL) "
            "OR (patch IS NOT NULL AND changed_paths IS NOT NULL)) "
            "AND deleted_at IS NULL AND revoked_at IS NULL "
            "AND audience_user_id IS NULL) "
            "OR (event_type = 'deleted' "
            "AND snapshot IS NULL AND patch IS NULL AND changed_paths IS NULL "
            "AND deleted_at IS NOT NULL AND revoked_at IS NULL "
            "AND audience_user_id IS NULL) "
            "OR (event_type = 'share_revoked' "
            "AND snapshot IS NULL AND patch IS NULL AND changed_paths IS NULL "
            "AND deleted_at IS NULL AND revoked_at IS NOT NULL "
            "AND audience_user_id IS NOT NULL)",
            name=op.f("ck_character_events_payload_matches_event_type"),
        ),
        sa.CheckConstraint(
            "server_revision >= 1",
            name=op.f("ck_character_events_server_revision_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_character_events_actor_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["audience_user_id"],
            ["users.id"],
            name=op.f("fk_character_events_audience_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["cloud_characters.id"],
            name=op.f("fk_character_events_character_id_cloud_characters"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_character_events")),
    )
    op.create_index(
        "idx_character_events_audience_cursor",
        "character_events",
        ["audience_user_id", "id"],
        unique=False,
        postgresql_where=sa.text("audience_user_id IS NOT NULL"),
    )
    op.create_index(
        "idx_character_events_character_created",
        "character_events",
        ["character_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_character_events_character_cursor",
        "character_events",
        ["character_id", "id"],
        unique=False,
    )
    op.create_index(
        "idx_character_events_character_revision",
        "character_events",
        ["character_id", "server_revision"],
        unique=False,
    )
    op.create_index(
        "uq_character_events_character_content_revision",
        "character_events",
        ["character_id", "server_revision"],
        unique=True,
        postgresql_where=sa.text("event_type IN ('updated', 'deleted')"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_character_events_character_content_revision",
        table_name="character_events",
        postgresql_where=sa.text("event_type IN ('updated', 'deleted')"),
    )
    op.drop_index(
        "idx_character_events_character_revision",
        table_name="character_events",
    )
    op.drop_index(
        "idx_character_events_character_cursor",
        table_name="character_events",
    )
    op.drop_index(
        "idx_character_events_character_created",
        table_name="character_events",
    )
    op.drop_index(
        "idx_character_events_audience_cursor",
        table_name="character_events",
        postgresql_where=sa.text("audience_user_id IS NOT NULL"),
    )
    op.drop_table("character_events")
