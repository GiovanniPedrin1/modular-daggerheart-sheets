from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Daggerheart Fichas API"
    app_env: Literal["development", "staging", "production", "test"] = "development"
    api_version: str = "0.3.0"

    database_url: str = Field(
        default="postgresql+asyncpg://daggerheart:daggerheart@localhost:5432/daggerheart_fichas",
        description="SQLAlchemy async PostgreSQL URL.",
    )
    cors_allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    session_secret: str = "change-me-before-production"
    session_cookie_name: str = "daggerheart_refresh_token"
    session_cookie_secure: bool | None = None
    session_duration_days: int = 30
    max_cloud_backup_payload_bytes: int = 5 * 1024 * 1024
    cloud_backup_retention_limit: int = 10
    supported_cloud_backup_format_version: int = 1
    supported_local_backup_format_version: int = 1
    max_cloud_character_payload_bytes: int = 2 * 1024 * 1024
    supported_cloud_character_schema_version: int = 1

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def require_async_postgres_url(cls, value: str) -> str:
        # Keep this explicit so we do not accidentally deploy with a sync driver.
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use postgresql+asyncpg://")
        return value

    @field_validator("session_duration_days")
    @classmethod
    def require_positive_session_duration(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("SESSION_DURATION_DAYS must be greater than zero")
        return value

    @field_validator("max_cloud_backup_payload_bytes")
    @classmethod
    def require_positive_cloud_backup_size(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("MAX_CLOUD_BACKUP_PAYLOAD_BYTES must be greater than zero")
        return value

    @field_validator("max_cloud_character_payload_bytes")
    @classmethod
    def require_positive_cloud_character_size(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("MAX_CLOUD_CHARACTER_PAYLOAD_BYTES must be greater than zero")
        return value

    @field_validator("supported_cloud_character_schema_version")
    @classmethod
    def require_positive_cloud_character_schema_version(cls, value: int) -> int:
        if value <= 0:
            raise ValueError(
                "SUPPORTED_CLOUD_CHARACTER_SCHEMA_VERSION must be greater than zero"
            )
        return value

    @field_validator("cloud_backup_retention_limit")
    @classmethod
    def require_positive_retention_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("CLOUD_BACKUP_RETENTION_LIMIT must be greater than zero")
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def effective_session_cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.is_production

    @field_validator("session_secret")
    @classmethod
    def require_secure_session_secret_in_production(cls, value: str, info) -> str:
        # Pydantic validates fields in definition order; app_env is available here.
        app_env = info.data.get("app_env")
        if app_env == "production" and value == "change-me-before-production":
            raise ValueError("SESSION_SECRET must be changed in production")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
