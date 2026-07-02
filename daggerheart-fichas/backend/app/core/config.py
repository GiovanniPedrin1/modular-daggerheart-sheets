from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Daggerheart Fichas API"
    app_env: Literal["development", "staging", "production", "test"] = "development"
    api_version: str = "0.1.0"

    database_url: str = Field(
        default="postgresql+asyncpg://daggerheart:daggerheart@localhost:5432/daggerheart_fichas",
        description="SQLAlchemy async PostgreSQL URL.",
    )
    cors_allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    session_secret: str = "change-me-before-production"

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

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
