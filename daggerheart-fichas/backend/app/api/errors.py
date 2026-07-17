from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security_contracts import require_valid_api_error_code


class ApiErrorPayload(BaseModel):
    """Stable public error body used by every JSON API response."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=2, max_length=64)
    message: str = Field(min_length=1, max_length=500)
    detail: Any = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return require_valid_api_error_code(value)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("API error message cannot be empty")
        return normalized


class ApiValidationIssue(BaseModel):
    """Privacy-safe subset of one FastAPI/Pydantic validation failure."""

    model_config = ConfigDict(extra="forbid")

    location: list[str | int]
    type: str
    message: str


def build_api_error_payload(
    code: str,
    message: str,
    detail: Any = None,
) -> dict[str, Any]:
    return ApiErrorPayload(code=code, message=message, detail=detail).model_dump(mode="json")


def build_validation_error_detail(
    errors: Sequence[Mapping[str, Any]],
    *,
    max_errors: int,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    for error in errors[:max_errors]:
        location = [part for part in error.get("loc", ()) if isinstance(part, str | int)]
        issue = ApiValidationIssue(
            location=location,
            type=str(error.get("type") or "validation_error"),
            message=str(error.get("msg") or "Invalid value."),
        )
        issues.append(issue.model_dump(mode="json"))

    return {
        "errors": issues,
        "errorCount": len(errors),
        "truncated": len(errors) > len(issues),
    }


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
        detail=build_api_error_payload(code, message, detail),
        headers=dict(headers) if headers is not None else None,
    )
