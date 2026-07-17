from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, status
from fastapi.responses import PlainTextResponse

from app.api.errors import api_error
from app.core.config import Settings, get_settings

router = APIRouter(tags=["observability"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


def _extract_bearer_token(value: str | None) -> str | None:
    if not value:
        return None
    scheme, separator, token = value.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


@router.get(
    "/metrics",
    response_class=PlainTextResponse,
    include_in_schema=False,
)
async def prometheus_metrics(
    request: Request,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> PlainTextResponse:
    if not settings.metrics_enabled:
        raise api_error(status.HTTP_404_NOT_FOUND, "NOT_FOUND", "Resource was not found.")

    expected = settings.metrics_bearer_token
    if expected is not None:
        received = _extract_bearer_token(authorization)
        if received is None or not hmac.compare_digest(received, expected):
            raise api_error(
                status.HTTP_401_UNAUTHORIZED,
                "METRICS_AUTH_REQUIRED",
                "Metrics authentication is required.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    registry = request.app.state.metrics
    return PlainTextResponse(
        registry.render_prometheus(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )
