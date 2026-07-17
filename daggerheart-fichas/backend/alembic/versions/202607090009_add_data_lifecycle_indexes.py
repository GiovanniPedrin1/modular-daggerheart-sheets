"""add privacy data lifecycle indexes

Revision ID: 202607090009
Revises: 202607090008
Create Date: 2026-07-16 00:09:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "202607090009"
down_revision: str | None = "202607090008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "idx_cloud_characters_deleted_at",
        "cloud_characters",
        ["deleted_at", "id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NOT NULL"),
    )
    op.create_index(
        "idx_character_shares_pending_created",
        "character_shares",
        ["created_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "idx_character_shares_revoked_at",
        "character_shares",
        ["revoked_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'revoked' AND revoked_at IS NOT NULL"),
    )
    op.create_index(
        "idx_refresh_sessions_revoked_at",
        "refresh_sessions",
        ["revoked_at", "id"],
        unique=False,
        postgresql_where=sa.text("revoked_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_refresh_sessions_revoked_at", table_name="refresh_sessions")
    op.drop_index("idx_character_shares_revoked_at", table_name="character_shares")
    op.drop_index("idx_character_shares_pending_created", table_name="character_shares")
    op.drop_index("idx_cloud_characters_deleted_at", table_name="cloud_characters")
