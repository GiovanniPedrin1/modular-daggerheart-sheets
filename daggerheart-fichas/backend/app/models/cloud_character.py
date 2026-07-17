from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.character_event import CharacterEvent
    from app.models.character_mutation import CharacterMutation
    from app.models.character_share import CharacterShare
    from app.models.user import User


class CloudCharacter(Base):
    __tablename__ = "cloud_characters"
    __table_args__ = (
        CheckConstraint(
            "server_revision >= 1",
            name="server_revision_positive",
        ),
        CheckConstraint(
            "schema_version >= 1",
            name="schema_version_positive",
        ),
        CheckConstraint(
            "system IN ('daggerheart', 'custom')",
            name="system_supported",
        ),
        CheckConstraint(
            "language IN ('pt-BR', 'en-US')",
            name="language_supported",
        ),
        CheckConstraint(
            "(system = 'daggerheart' AND class_key IS NOT NULL) "
            "OR (system = 'custom' AND class_key IS NULL)",
            name="class_key_matches_system",
        ),
        Index(
            "uq_cloud_characters_owner_local_active",
            "owner_user_id",
            "local_character_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND local_character_id IS NOT NULL"),
        ),
        Index(
            "idx_cloud_characters_owner_updated_active",
            "owner_user_id",
            "updated_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_cloud_characters_deleted_at",
            "deleted_at",
            "id",
            postgresql_where=text("deleted_at IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    owner_user_id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    local_character_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    system: Mapped[str] = mapped_column(String(32), nullable=False)
    class_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    language: Mapped[str] = mapped_column(String(16), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    server_revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_device_id: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )

    owner: Mapped[User] = relationship(back_populates="cloud_characters")
    mutations: Mapped[list[CharacterMutation]] = relationship(
        back_populates="character",
        cascade="all, delete-orphan",
        order_by="CharacterMutation.created_at",
    )
    events: Mapped[list[CharacterEvent]] = relationship(
        back_populates="character",
        cascade="all, delete-orphan",
        order_by="CharacterEvent.id",
    )
    shares: Mapped[list[CharacterShare]] = relationship(
        back_populates="character",
        cascade="all, delete-orphan",
    )
