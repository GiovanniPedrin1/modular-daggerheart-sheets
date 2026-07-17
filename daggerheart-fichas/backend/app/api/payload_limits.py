from __future__ import annotations

from fastapi import Request, status

from app.api.errors import api_error


def enforce_feature_request_body_limit(
    request: Request | None,
    *,
    max_bytes: int,
    code: str,
    message: str,
) -> None:
    """Reject a parsed request whose wire body exceeds a feature-specific cap."""

    if request is None:
        return

    actual_bytes = int(getattr(request.state, "request_body_bytes", 0) or 0)
    if actual_bytes <= max_bytes:
        return

    raise api_error(
        status.HTTP_413_CONTENT_TOO_LARGE,
        code,
        message,
        {"maxBytes": max_bytes, "actualBytes": actual_bytes},
    )
