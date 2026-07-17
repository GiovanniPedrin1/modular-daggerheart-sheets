from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.user_codes import PUBLIC_USER_CODE_PATTERN, normalize_public_user_code


class UserPublic(BaseModel):
    id: UUID
    email: EmailStr
    public_user_code: str = Field(alias="publicUserCode", min_length=6, max_length=32)
    display_name: str | None = Field(default=None, alias="displayName")
    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @field_validator("public_user_code", mode="before")
    @classmethod
    def validate_public_user_code(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = normalize_public_user_code(value)
        if not PUBLIC_USER_CODE_PATTERN.fullmatch(normalized):
            raise ValueError("publicUserCode has an invalid format")
        return normalized


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=120, alias="displayName")
    device_id: str | None = Field(default=None, max_length=128, alias="deviceId")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    device_id: str | None = Field(default=None, max_length=128, alias="deviceId")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class LoginResponse(BaseModel):
    user: UserPublic
    access_token: str | None = Field(default=None, alias="accessToken")
    expires_at: datetime | None = Field(default=None, alias="expiresAt")

    model_config = ConfigDict(populate_by_name=True)


class CurrentUserResponse(BaseModel):
    user: UserPublic | None


class CsrfTokenResponse(BaseModel):
    csrf_token: str = Field(alias="csrfToken", min_length=32, max_length=512)

    model_config = ConfigDict(populate_by_name=True)


class LogoutResponse(BaseModel):
    ok: bool = True
