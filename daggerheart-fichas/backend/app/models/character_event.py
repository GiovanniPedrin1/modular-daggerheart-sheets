from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.cloud_character import CloudCharacter


class CharacterEvent(Base):
    __tablename__ = "character_events"
    __table_args__ = (
        CheckConstraint(
            "server_revision >= 1",
            name="server_revision_positive",
        ),
        CheckConstraint(
            "event_type IN ('updated', 'deleted', 'share_revoked')",
            name="event_type_supported",
        ),
        CheckConstraint(
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
            "AND audience_user_id IS NOT NULL)",
            name="payload_matches_event_type",
        ),
        CheckConstraint(
            "changed_paths IS NULL "
            "OR (jsonb_typeof(changed_paths) = 'array' "
            "AND jsonb_array_length(changed_paths) BETWEEN 1 AND 128)",
            name="changed_paths_array",
        ),
        CheckConstraint(
            "compacted_at IS NULL "
            "OR (event_type = 'updated' AND snapshot IS NULL "
            "AND patch IS NOT NULL AND changed_paths IS NOT NULL)",
            name="compacted_event_shape",
        ),
        CheckConstraint(
            "compacted_at IS NULL "
            "OR (patch IS NOT NULL "
            "AND patch = '{\"format\":\"changed_paths_v1\"}'::jsonb)",
            name="compacted_patch_format",
        ),
        Index(
            "uq_character_events_character_content_revision",
            "character_id",
            "server_revision",
            unique=True,
            postgresql_where=text("event_type IN ('updated', 'deleted')"),
        ),
        Index(
            "idx_character_events_character_cursor",
            "character_id",
            "id",
        ),
        Index(
            "idx_character_events_character_revision",
            "character_id",
            "server_revision",
        ),
        Index(
            "idx_character_events_character_created",
            "character_id",
            "created_at",
        ),
        Index(
            "idx_character_events_compacted_created",
            "created_at",
            "id",
            postgresql_where=text("compacted_at IS NOT NULL"),
        ),
        Index(
            "idx_character_events_audience_cursor",
            "audience_user_id",
            "id",
            postgresql_where=text("audience_user_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(start=1),
        primary_key=True,
    )
    character_id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("cloud_characters.id", ondelete="CASCADE"),
        nullable=False,
    )
    server_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    patch: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    compacted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    changed_paths: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    actor_user_id: Mapped[UUID | None] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    audience_user_id: Mapped[UUID | None] = mapped_column(
        PostgresUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    character: Mapped[CloudCharacter] = relationship(back_populates="events")
