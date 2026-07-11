"""add public user codes

Revision ID: 202607090003
Revises: 202607090002
Create Date: 2026-07-09 00:03:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "202607090003"
down_revision: str | None = "202607090002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("public_user_code", sa.String(length=32), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE users "
            "SET public_user_code = upper(replace(id::text, '-', '')) "
            "WHERE public_user_code IS NULL"
        )
    )
    op.alter_column(
        "users",
        "public_user_code",
        existing_type=sa.String(length=32),
        nullable=False,
    )
    op.create_index(
        op.f("ix_users_public_user_code"),
        "users",
        ["public_user_code"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_users_public_user_code"), table_name="users")
    op.drop_column("users", "public_user_code")
