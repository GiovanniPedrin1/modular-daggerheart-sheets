from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException


def api_error(
    status_code: int,
    code: str,
    message: str,
    detail: Any = None,
    *,
    headers: Mapping[str, str] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
            "detail": detail,
        },
        headers=dict(headers) if headers is not None else None,
    )
