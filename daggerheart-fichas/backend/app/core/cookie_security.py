from __future__ import annotations

from fastapi import Response

from app.core.config import Settings


def set_hardened_cookie(
    response: Response,
    *,
    settings: Settings,
    key: str,
    value: str,
    max_age: int,
    expires: int,
) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        expires=expires,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite=settings.cookie_samesite,
        path=settings.cookie_path,
        domain=settings.cookie_domain,
    )


def delete_hardened_cookie(
    response: Response,
    *,
    settings: Settings,
    key: str,
) -> None:
    response.delete_cookie(
        key=key,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite=settings.cookie_samesite,
        path=settings.cookie_path,
        domain=settings.cookie_domain,
    )
