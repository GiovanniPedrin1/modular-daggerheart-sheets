"""add compacted character event contract

Revision ID: 202607090008
Revises: 202607090007
Create Date: 2026-07-16 00:08:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "202607090008"
down_revision: str | None = "202607090007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COMPACTED_EVENT_SHAPE_CONSTRAINT = (
    "compacted_at IS NULL "
    "OR (event_type = 'updated' AND snapshot IS NULL "
    "AND patch IS NOT NULL AND changed_paths IS NOT NULL)"
)

_COMPACTED_PATCH_CONSTRAINT = (
    "compacted_at IS NULL "
    "OR (patch IS NOT NULL "
    "AND patch = '{\"format\":\"changed_paths_v1\"}'::jsonb)"
)


def upgrade() -> None:
    op.add_column(
        "character_events",
        sa.Column("compacted_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Preserve any pre-release marker rows without rewriting arbitrary patch payloads.
    op.execute(
        sa.text(
            "UPDATE character_events SET compacted_at = created_at "
            "WHERE event_type = 'updated' AND snapshot IS NULL "
            "AND patch = '{\"format\":\"changed_paths_v1\"}'::jsonb "
            "AND changed_paths IS NOT NULL"
        )
    )
    op.create_check_constraint(
        op.f("ck_character_events_compacted_event_shape"),
        "character_events",
        _COMPACTED_EVENT_SHAPE_CONSTRAINT,
    )
    op.create_check_constraint(
        op.f("ck_character_events_compacted_patch_format"),
        "character_events",
        _COMPACTED_PATCH_CONSTRAINT,
    )
    op.create_index(
        "idx_character_events_compacted_created",
        "character_events",
        ["created_at", "id"],
        unique=False,
        postgresql_where=sa.text("compacted_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "idx_character_events_compacted_created",
        table_name="character_events",
    )
    op.drop_constraint(
        op.f("ck_character_events_compacted_patch_format"),
        "character_events",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_character_events_compacted_event_shape"),
        "character_events",
        type_="check",
    )
    op.drop_column("character_events", "compacted_at")
