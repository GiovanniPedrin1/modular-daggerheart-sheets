"""allow snapshot events to persist changed paths

Revision ID: 202607090006
Revises: 202607090005
Create Date: 2026-07-09 00:06:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "202607090006"
down_revision: str | None = "202607090005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UPDATED_PAYLOAD_CONSTRAINT = (
    "(event_type = 'updated' "
    "AND ((snapshot IS NOT NULL AND patch IS NULL) "
    "OR (snapshot IS NULL AND patch IS NOT NULL)) "
    "AND (patch IS NULL OR changed_paths IS NOT NULL) "
    "AND deleted_at IS NULL AND revoked_at IS NULL "
    "AND audience_user_id IS NULL) "
    "OR (event_type = 'deleted' "
    "AND snapshot IS NULL AND patch IS NULL AND changed_paths IS NULL "
    "AND deleted_at IS NOT NULL AND revoked_at IS NULL "
    "AND audience_user_id IS NULL) "
    "OR (event_type = 'share_revoked' "
    "AND snapshot IS NULL AND patch IS NULL AND changed_paths IS NULL "
    "AND deleted_at IS NULL AND revoked_at IS NOT NULL "
    "AND audience_user_id IS NOT NULL)"
)

_LEGACY_PAYLOAD_CONSTRAINT = (
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
    "AND audience_user_id IS NOT NULL)"
)

_CHANGED_PATHS_ARRAY_CONSTRAINT = (
    "changed_paths IS NULL "
    "OR (jsonb_typeof(changed_paths) = 'array' "
    "AND jsonb_array_length(changed_paths) BETWEEN 1 AND 128)"
)


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_character_events_payload_matches_event_type"),
        "character_events",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_character_events_payload_matches_event_type"),
        "character_events",
        _UPDATED_PAYLOAD_CONSTRAINT,
    )
    op.create_check_constraint(
        op.f("ck_character_events_changed_paths_array"),
        "character_events",
        _CHANGED_PATHS_ARRAY_CONSTRAINT,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_character_events_changed_paths_array"),
        "character_events",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_character_events_payload_matches_event_type"),
        "character_events",
        type_="check",
    )
    op.execute(
        sa.text(
            "UPDATE character_events SET changed_paths = NULL "
            "WHERE event_type = 'updated' AND snapshot IS NOT NULL"
        )
    )
    op.create_check_constraint(
        op.f("ck_character_events_payload_matches_event_type"),
        "character_events",
        _LEGACY_PAYLOAD_CONSTRAINT,
    )
