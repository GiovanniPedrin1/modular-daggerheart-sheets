from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.observability import get_current_metrics
from app.core.request_context import get_request_audit_source
from app.models.audit_event import AuditEvent

AuditOutcome = Literal["success", "denied", "failed"]

_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9_.]{2,79}$")
_RESOURCE_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
_FORBIDDEN_METADATA_PARTS = {
    "password",
    "token",
    "secret",
    "cookie",
    "authorization",
    "email",
    "payload",
    "snapshot",
    "operations",
    "patch",
    "content",
    "data",
}
_MAX_METADATA_BYTES = 4096
_MAX_METADATA_DEPTH = 4
_MAX_METADATA_ITEMS = 64
_MAX_METADATA_STRING_LENGTH = 256


class AuditContractError(ValueError):
    """Raised for unsafe internal audit data before it can be persisted."""


def _truncate_text(value: str | None, *, max_length: int) -> str | None:
    if not value:
        return None
    normalized = " ".join(value.split())
    return normalized[:max_length] or None


def _minimize_ip(value: str | None, *, settings: Settings) -> str | None:
    if settings.audit_ip_mode == "none" or not value:
        return None
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None

    canonical = address.compressed
    if settings.audit_ip_mode == "hash":
        secret = settings.audit_hash_secret
        if secret is None:  # guarded by Settings validation when audit is enabled
            raise AuditContractError("audit hash secret is missing")
        digest = hmac.new(
            secret.encode("utf-8"),
            canonical.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return f"sha256:{digest}"

    prefix_length = 24 if address.version == 4 else 48
    network = ipaddress.ip_network(f"{canonical}/{prefix_length}", strict=False)
    return network.with_prefixlen


def _validate_metadata_key(key: str) -> None:
    normalized = key.strip()
    if not normalized or len(normalized) > 64:
        raise AuditContractError("audit metadata key is empty or too long")
    lowered = normalized.lower()
    if any(part in lowered for part in _FORBIDDEN_METADATA_PARTS):
        raise AuditContractError(f"audit metadata key is sensitive: {key}")


def _sanitize_metadata_value(value: Any, *, depth: int) -> Any:
    if depth > _MAX_METADATA_DEPTH:
        raise AuditContractError("audit metadata is too deeply nested")
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise AuditContractError("audit metadata contains a non-finite number")
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        return value[:_MAX_METADATA_STRING_LENGTH]
    if isinstance(value, Mapping):
        if len(value) > _MAX_METADATA_ITEMS:
            raise AuditContractError("audit metadata object has too many entries")
        result: dict[str, Any] = {}
        for raw_key, item in value.items():
            if not isinstance(raw_key, str):
                raise AuditContractError("audit metadata keys must be strings")
            _validate_metadata_key(raw_key)
            result[raw_key] = _sanitize_metadata_value(item, depth=depth + 1)
        return result
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        if len(value) > _MAX_METADATA_ITEMS:
            raise AuditContractError("audit metadata list has too many entries")
        return [_sanitize_metadata_value(item, depth=depth + 1) for item in value]
    raise AuditContractError(f"unsupported audit metadata value: {type(value).__name__}")


def sanitize_audit_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if metadata is None:
        return None
    sanitized = _sanitize_metadata_value(metadata, depth=1)
    encoded = json.dumps(
        sanitized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    if len(encoded) > _MAX_METADATA_BYTES:
        raise AuditContractError("audit metadata exceeds the maximum encoded size")
    return sanitized


async def append_audit_event(
    session: AsyncSession,
    *,
    action: str,
    actor_user_id: UUID | None,
    outcome: AuditOutcome = "success",
    target_user_id: UUID | None = None,
    character_id: UUID | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    device_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    settings: Settings | None = None,
) -> AuditEvent | None:
    """Append one audit row to the caller's transaction.

    The function intentionally does not commit. A successful business action and
    its audit row therefore succeed or roll back together. When auditing is disabled
    it is a no-op, keeping local development and existing tests lightweight.
    """

    current_settings = settings or get_settings()
    if not current_settings.audit_enabled:
        return None

    if not _ACTION_PATTERN.fullmatch(action):
        raise AuditContractError("audit action has an invalid format")
    if outcome not in {"success", "denied", "failed"}:
        raise AuditContractError("audit outcome is unsupported")
    if resource_type is not None and not _RESOURCE_TYPE_PATTERN.fullmatch(resource_type):
        raise AuditContractError("audit resource type has an invalid format")
    if device_id is not None and len(device_id) > current_settings.max_device_id_length:
        raise AuditContractError("audit device id exceeds the configured maximum")

    source = get_request_audit_source()
    event = AuditEvent(
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        character_id=character_id,
        action=action,
        outcome=outcome,
        resource_type=resource_type,
        resource_id=resource_id,
        request_id=source.request_id if source is not None else None,
        device_id=device_id,
        client_ip=_minimize_ip(
            source.client_host if source is not None else None,
            settings=current_settings,
        ),
        user_agent=_truncate_text(
            source.user_agent if source is not None else None,
            max_length=current_settings.audit_user_agent_max_length,
        ),
        event_metadata=sanitize_audit_metadata(metadata),
    )
    session.add(event)
    get_current_metrics().record_audit_event(action=action, outcome=outcome)
    return event
