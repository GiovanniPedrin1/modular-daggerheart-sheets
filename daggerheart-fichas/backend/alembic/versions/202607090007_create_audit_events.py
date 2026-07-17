"""create audit events

Revision ID: 202607090007
Revises: 202607090006
Create Date: 2026-07-15 00:07:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607090007"
down_revision: str | None = "202607090006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("character_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("resource_type", sa.String(length=48), nullable=True),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("client_ip", sa.String(length=80), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "action ~ '^[a-z][a-z0-9_.]{2,79}$'",
            name=op.f("ck_audit_events_action_format"),
        ),
        sa.CheckConstraint(
            "outcome IN ('success', 'denied', 'failed')",
            name=op.f("ck_audit_events_outcome_supported"),
        ),
        sa.CheckConstraint(
            "resource_type IS NULL OR resource_type ~ '^[a-z][a-z0-9_]{1,47}$'",
            name=op.f("ck_audit_events_resource_type_format"),
        ),
        sa.CheckConstraint(
            "metadata IS NULL OR jsonb_typeof(metadata) = 'object'",
            name=op.f("ck_audit_events_metadata_object"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_audit_events_actor_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_user_id"],
            ["users.id"],
            name=op.f("fk_audit_events_target_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["cloud_characters.id"],
            name=op.f("fk_audit_events_character_id_cloud_characters"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_events")),
    )
    op.create_index(
        "idx_audit_events_created",
        "audit_events",
        ["created_at", "id"],
        unique=False,
    )
    op.create_index(
        "idx_audit_events_action_created",
        "audit_events",
        ["action", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_audit_events_actor_created",
        "audit_events",
        ["actor_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_audit_events_character_created",
        "audit_events",
        ["character_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_audit_events_request_id",
        "audit_events",
        ["request_id"],
        unique=False,
    )
    op.execute(
        "CREATE FUNCTION prevent_audit_event_update() RETURNS trigger "
        "LANGUAGE plpgsql AS $$ BEGIN "
        "RAISE EXCEPTION 'audit_events rows are immutable'; "
        "END; $$"
    )
    op.execute(
        "CREATE TRIGGER audit_events_prevent_update "
        "BEFORE UPDATE ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_update()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_events_prevent_update ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS prevent_audit_event_update()")
    op.drop_index("idx_audit_events_request_id", table_name="audit_events")
    op.drop_index("idx_audit_events_character_created", table_name="audit_events")
    op.drop_index("idx_audit_events_actor_created", table_name="audit_events")
    op.drop_index("idx_audit_events_action_created", table_name="audit_events")
    op.drop_index("idx_audit_events_created", table_name="audit_events")
    op.drop_table("audit_events")
