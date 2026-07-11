from __future__ import annotations

import re
from uuid import uuid4

PUBLIC_USER_CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9-]{5,31}$")


def normalize_public_user_code(value: str) -> str:
    return value.strip().upper()


def is_valid_public_user_code(value: str) -> bool:
    return PUBLIC_USER_CODE_PATTERN.fullmatch(normalize_public_user_code(value)) is not None


def generate_public_user_code() -> str:
    """Generate a stable-length public code suitable for unique database storage."""
    return uuid4().hex.upper()
