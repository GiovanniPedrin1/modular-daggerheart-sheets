from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LocalBackupPayload(BaseModel):
    app: Literal["rpg-sheets-local-first"]
    format_version: int = Field(alias="formatVersion")
    exported_at: str = Field(alias="exportedAt")
    characters: list[dict[str, Any]]
    settings: list[dict[str, Any]]

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class CloudBackupPayload(BaseModel):
    app: Literal["daggerheart-fichas"]
    cloud_format_version: int = Field(alias="cloudFormatVersion")
    source_app_version: str = Field(min_length=1, max_length=64, alias="sourceAppVersion")
    exported_at: str = Field(min_length=1, max_length=64, alias="exportedAt")
    device_id: str = Field(min_length=1, max_length=128, alias="deviceId")
    checksum: str = Field(min_length=64, max_length=64)
    payload: LocalBackupPayload

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("checksum")
    @classmethod
    def normalize_checksum(cls, value: str) -> str:
        normalized = value.strip().lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("checksum must be a 64-character hexadecimal sha-256 digest")
        return normalized

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("deviceId cannot be empty")
        return normalized


class CloudBackupPublic(BaseModel):
    id: UUID
    device_id: str | None = Field(default=None, alias="deviceId")
    source_app_version: str = Field(alias="sourceAppVersion")
    cloud_format_version: int = Field(alias="cloudFormatVersion")
    checksum: str
    character_count: int = Field(alias="characterCount")
    setting_count: int = Field(alias="settingCount")
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class CloudBackupWithPayload(CloudBackupPublic):
    payload: CloudBackupPayload


class CreateBackupResponse(BaseModel):
    backup: CloudBackupPublic
    skipped: bool = False
    reason: Literal["duplicate_checksum"] | None = None


class ListBackupsResponse(BaseModel):
    backups: list[CloudBackupPublic]


class GetBackupResponse(BaseModel):
    backup: CloudBackupWithPayload


class DeleteBackupResponse(BaseModel):
    ok: bool = True
