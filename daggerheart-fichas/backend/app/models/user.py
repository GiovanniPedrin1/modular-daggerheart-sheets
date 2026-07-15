from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.user_codes import generate_public_user_code
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.character_mutation import CharacterMutation
    from app.models.character_share import CharacterShare
    from app.models.cloud_backup import CloudBackup
    from app.models.cloud_character import CloudCharacter
    from app.models.refresh_session import RefreshSession


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    public_user_code: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        unique=True,
        index=True,
        default=generate_public_user_code,
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
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

    refresh_sessions: Mapped[list[RefreshSession]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    cloud_backups: Mapped[list[CloudBackup]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    character_mutations: Mapped[list[CharacterMutation]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    cloud_characters: Mapped[list[CloudCharacter]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    owned_character_shares: Mapped[list[CharacterShare]] = relationship(
        foreign_keys="CharacterShare.owner_user_id",
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    received_character_shares: Mapped[list[CharacterShare]] = relationship(
        foreign_keys="CharacterShare.target_user_id",
        back_populates="target_user",
        passive_deletes=True,
    )
