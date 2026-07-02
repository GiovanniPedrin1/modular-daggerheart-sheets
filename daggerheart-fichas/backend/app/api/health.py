from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings
from app.db.session import ping_database

router = APIRouter(tags=["health"])
settings = get_settings()


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    environment: str
    checked_at: datetime


class DatabaseHealthResponse(BaseModel):
    status: str
    database: str
    checked_at: datetime
    error: str | None = None


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=settings.api_version,
        environment=settings.app_env,
        checked_at=datetime.now(UTC),
    )


@router.get("/health/db", response_model=DatabaseHealthResponse)
async def database_health_check() -> DatabaseHealthResponse:
    try:
        await ping_database()
    except Exception as exc:  # noqa: BLE001 - health endpoint should report unexpected DB errors.
        return DatabaseHealthResponse(
            status="error",
            database="postgresql",
            checked_at=datetime.now(UTC),
            error=str(exc),
        )

    return DatabaseHealthResponse(
        status="ok",
        database="postgresql",
        checked_at=datetime.now(UTC),
    )
