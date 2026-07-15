from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
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
    from app.models.user import User


class CharacterMutation(Base):
    """Persistent idempotency and conflict record for one owner mutation.

    A duplicate retry does not create a second row. The unique idempotency key
    points back to the original ``applied``, ``conflict``, or ``rejected`` row.
    """

    __tablename__ = "character_mutations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('applied', 'conflict', 'rejected')",
            name="status_supported",
        ),
        CheckConstraint(
            "base_revision >= 1",
            name="base_revision_positive",
        ),
        CheckConstraint(
            "applied_revision IS NULL OR applied_revision >= 1",
            name="applied_revision_positive",
        ),
        CheckConstraint(
            "schema_version >= 1",
            name="schema_version_positive",
        ),
        CheckConstraint(
            "char_length(request_hash) = 64 "
            "AND request_hash = lower(request_hash) "
            "AND request_hash ~ '^[0-9a-f]{64}$'",
            name="request_hash_sha256",
        ),
        CheckConstraint(
            "jsonb_typeof(changed_paths) = 'array' "
            "AND jsonb_array_length(changed_paths) BETWEEN 1 AND 128",
            name="changed_paths_array",
        ),
        CheckConstraint(
            "jsonb_typeof(operations) = 'array' "
            "AND jsonb_array_length(operations) BETWEEN 1 AND 128",
            name="operations_array",
        ),
        CheckConstraint(
            "(status = 'applied' "
            "AND applied_revision IS NOT NULL "
            "AND applied_revision >= base_revision "
            "AND conflict_paths IS NULL "
            "AND server_changed_paths IS NULL "
            "AND conflict_server_revision IS NULL "
            "AND conflict_server_character IS NULL "
            "AND rejection_code IS NULL "
            "AND rejection_reason IS NULL "
            "AND NOT (merged AND unchanged)) "
            "OR (status = 'conflict' "
            "AND applied_revision IS NULL "
            "AND merged = false "
            "AND unchanged = false "
            "AND conflict_paths IS NOT NULL "
            "AND jsonb_typeof(conflict_paths) = 'array' "
            "AND jsonb_array_length(conflict_paths) > 0 "
            "AND server_changed_paths IS NOT NULL "
            "AND jsonb_typeof(server_changed_paths) = 'array' "
            "AND jsonb_array_length(server_changed_paths) > 0 "
            "AND conflict_server_revision IS NOT NULL "
            "AND conflict_server_revision > base_revision "
            "AND conflict_server_character IS NOT NULL "
            "AND jsonb_typeof(conflict_server_character) = 'object' "
            "AND rejection_code IS NULL "
            "AND rejection_reason IS NULL) "
            "OR (status = 'rejected' "
            "AND applied_revision IS NULL "
            "AND merged = false "
            "AND unchanged = false "
            "AND conflict_paths IS NULL "
            "AND server_changed_paths IS NULL "
            "AND conflict_server_revision IS NULL "
            "AND conflict_server_character IS NULL "
            "AND rejection_code IS NOT NULL "
            "AND rejection_reason IS NOT NULL)",
            name="lifecycle_consistent",
        ),
        Index(
            "uq_character_mutations_character_device_mutation",
            "character_id",
            "device_id",
            "mutation_id",
            unique=True,
        ),
        Index(
            "idx_character_mutations_character_created",
            "character_id",
            "created_at",
        ),
        Index(
            "idx_character_mutations_owner_created",
            "owner_user_id",
            "created_at",
        ),
        Index(
            "idx_character_mutations_character_applied_revision",
            "character_id",
            "applied_revision",
            postgresql_where=text("status = 'applied'"),
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
    )
    mutation_id: Mapped[UUID] = mapped_column(
        PostgresUUID(as_uuid=True),
        nullable=False,
    )
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    base_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    changed_paths: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    operations: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    merged: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    unchanged: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    conflict_paths: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    server_changed_paths: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    conflict_server_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    conflict_server_character: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rejection_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    character: Mapped[CloudCharacter] = relationship(back_populates="mutations")
    owner: Mapped[User] = relationship(back_populates="character_mutations")
