from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.cloud_character import CloudCharacter
    from app.models.user import User


class CharacterShare(Base):
    __tablename__ = "character_shares"
    __table_args__ = (
        CheckConstraint(
            "role = 'viewer'",
            name="role_supported",
        ),
        CheckConstraint(
            "status IN ('pending', 'active', 'revoked')",
            name="status_supported",
        ),
        CheckConstraint(
            "(target_email IS NOT NULL AND target_public_user_code IS NULL) "
            "OR (target_email IS NULL AND target_public_user_code IS NOT NULL)",
            name="exactly_one_target_label",
        ),
        CheckConstraint(
            "target_email IS NULL OR target_email = lower(btrim(target_email))",
            name="target_email_normalized",
        ),
        CheckConstraint(
            "target_public_user_code IS NULL "
            "OR target_public_user_code = upper(btrim(target_public_user_code))",
            name="target_public_user_code_normalized",
        ),
        CheckConstraint(
            "target_public_user_code IS NULL OR target_user_id IS NOT NULL",
            name="public_code_requires_user",
        ),
        CheckConstraint(
            "(status = 'pending' AND target_user_id IS NULL "
            "AND target_email IS NOT NULL AND accepted_at IS NULL "
            "AND revoked_at IS NULL) "
            "OR (status = 'active' AND target_user_id IS NOT NULL "
            "AND accepted_at IS NOT NULL AND revoked_at IS NULL) "
            "OR (status = 'revoked' AND revoked_at IS NOT NULL)",
            name="lifecycle_consistent",
        ),
        Index(
            "uq_character_shares_character_target_user_current",
            "character_id",
            "target_user_id",
            unique=True,
            postgresql_where=text(
                "status IN ('pending', 'active') AND target_user_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_character_shares_character_target_email_current",
            "character_id",
            "target_email",
            unique=True,
            postgresql_where=text(
                "status IN ('pending', 'active') AND target_email IS NOT NULL"
            ),
        ),
        Index(
            "uq_character_shares_character_target_code_current",
            "character_id",
            "target_public_user_code",
            unique=True,
            postgresql_where=text(
                "status IN ('pending', 'active') "
                "AND target_public_user_code IS NOT NULL"
            ),
        ),
        Index(
            "idx_character_shares_character_current_created",
            "character_id",
            "created_at",
            postgresql_where=text("status IN ('pending', 'active')"),
        ),
        Index(
            "idx_character_shares_target_active_created",
            "target_user_id",
            "created_at",
            postgresql_where=text(
                "status = 'active' AND target_user_id IS NOT NULL"
            ),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    character_id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("cloud_characters.id", ondelete="CASCADE"),
        nullable=False,
    )
    owner_user_id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_user_id: Mapped[UUID | None] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    target_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    target_public_user_code: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="viewer",
        server_default="viewer",
    )
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    character: Mapped[CloudCharacter] = relationship(back_populates="shares")
    owner: Mapped[User] = relationship(
        foreign_keys=[owner_user_id],
        back_populates="owned_character_shares",
    )
    target_user: Mapped[User | None] = relationship(
        foreign_keys=[target_user_id],
        back_populates="received_character_shares",
    )
