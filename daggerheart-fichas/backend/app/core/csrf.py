from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime
from urllib.parse import urlsplit

from fastapi import Response

from app.core.config import Settings
from app.core.cookie_security import delete_hardened_cookie, set_hardened_cookie
from app.core.security import utc_now

CSRF_TOKEN_VERSION = "v1"
CSRF_TOKEN_DOMAIN = b"daggerheart-csrf-v1\x00"


def normalize_origin(value: str) -> str | None:
    """Return a canonical browser origin or None for malformed input."""
    candidate = value.strip()
    if not candidate or candidate == "null":
        return None

    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None

    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username is not None or parsed.password is not None:
        return None

    try:
        port = parsed.port
    except ValueError:
        return None

    default_port = 80 if parsed.scheme == "http" else 443
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    authority = host if port in {None, default_port} else f"{host}:{port}"
    return f"{parsed.scheme.lower()}://{authority}"


def origin_from_referer(value: str) -> str | None:
    return normalize_origin(value)


def _csrf_signature(*, session_token: str, nonce: str, secret: str) -> str:
    message = CSRF_TOKEN_DOMAIN + session_token.encode("utf-8") + b"\x00" + nonce.encode("ascii")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def generate_csrf_token(*, session_token: str, secret: str, token_bytes: int) -> str:
    nonce = secrets.token_urlsafe(token_bytes)
    signature = _csrf_signature(session_token=session_token, nonce=nonce, secret=secret)
    return f"{CSRF_TOKEN_VERSION}.{nonce}.{signature}"


def validate_csrf_token(*, token: str, session_token: str, secret: str) -> bool:
    try:
        version, nonce, provided_signature = token.split(".", 2)
    except ValueError:
        return False

    if version != CSRF_TOKEN_VERSION or not nonce or not provided_signature:
        return False
    if len(token) > 512:
        return False

    try:
        nonce.encode("ascii")
        provided_signature.encode("ascii")
    except UnicodeEncodeError:
        return False

    expected_signature = _csrf_signature(
        session_token=session_token,
        nonce=nonce,
        secret=secret,
    )
    return hmac.compare_digest(provided_signature, expected_signature)


def set_csrf_cookie(
    response: Response,
    *,
    settings: Settings,
    token: str,
    expires_at: datetime,
) -> None:
    max_age = max(0, int((expires_at - utc_now()).total_seconds()))
    set_hardened_cookie(
        response,
        settings=settings,
        key=settings.effective_csrf_cookie_name,
        value=token,
        max_age=max_age,
        expires=max_age,
    )
    response.headers[settings.csrf_header_name] = token
    response.headers["Cache-Control"] = "no-store"


def issue_csrf_token(
    response: Response,
    *,
    settings: Settings,
    session_token: str,
    expires_at: datetime,
) -> str:
    token = generate_csrf_token(
        session_token=session_token,
        secret=settings.session_secret,
        token_bytes=settings.csrf_token_bytes,
    )
    set_csrf_cookie(
        response,
        settings=settings,
        token=token,
        expires_at=expires_at,
    )
    return token


def clear_csrf_cookie(response: Response, *, settings: Settings) -> None:
    delete_hardened_cookie(
        response,
        settings=settings,
        key=settings.effective_csrf_cookie_name,
    )
    response.headers["Cache-Control"] = "no-store"
