from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.core.request_context import (
    RequestAuditSource,
    reset_request_audit_source,
    set_request_audit_source,
)
from app.models.audit_event import AuditEvent
from app.services.audit_service import (
    AuditContractError,
    append_audit_event,
    sanitize_audit_metadata,
)


def make_session() -> SimpleNamespace:
    return SimpleNamespace(add=Mock())


@pytest.mark.asyncio
async def test_disabled_audit_is_a_true_noop() -> None:
    session = make_session()

    event = await append_audit_event(
        session,
        action="character.created",
        actor_user_id=uuid4(),
        settings=Settings(app_env="test", audit_enabled=False),
    )

    assert event is None
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_audit_event_captures_minimized_request_context() -> None:
    session = make_session()
    actor_id = uuid4()
    character_id = uuid4()
    token = set_request_audit_source(
        RequestAuditSource(
            request_id="request-audit-123",
            client_host="203.0.113.77",
            user_agent="  Test Browser   1.0  ",
        )
    )
    try:
        event = await append_audit_event(
            session,
            action="character.mutation_applied",
            actor_user_id=actor_id,
            character_id=character_id,
            resource_type="character_mutation",
            resource_id=uuid4(),
            device_id="device-mobile",
            metadata={
                "baseRevision": 7,
                "serverRevision": 8,
                "changedPathCount": 2,
                "merged": True,
            },
            settings=Settings(
                app_env="test",
                audit_enabled=True,
                audit_ip_mode="truncated",
            ),
        )
    finally:
        reset_request_audit_source(token)

    assert isinstance(event, AuditEvent)
    assert event.actor_user_id == actor_id
    assert event.character_id == character_id
    assert event.request_id == "request-audit-123"
    assert event.client_ip == "203.0.113.0/24"
    assert event.user_agent == "Test Browser 1.0"
    assert event.event_metadata == {
        "baseRevision": 7,
        "serverRevision": 8,
        "changedPathCount": 2,
        "merged": True,
    }
    session.add.assert_called_once_with(event)


@pytest.mark.asyncio
async def test_hashed_ip_never_persists_the_raw_address() -> None:
    session = make_session()
    token = set_request_audit_source(
        RequestAuditSource(
            request_id="request-audit-hash",
            client_host="2001:db8::1234",
            user_agent=None,
        )
    )
    try:
        event = await append_audit_event(
            session,
            action="auth.login",
            actor_user_id=uuid4(),
            settings=Settings(
                app_env="test",
                audit_enabled=True,
                audit_ip_mode="hash",
                audit_hash_secret="audit-secret-only",
            ),
        )
    finally:
        reset_request_audit_source(token)

    assert event is not None
    assert event.client_ip is not None
    assert event.client_ip.startswith("sha256:")
    assert "2001:db8" not in event.client_ip


def test_sensitive_or_excessive_metadata_is_rejected() -> None:
    with pytest.raises(AuditContractError, match="sensitive"):
        sanitize_audit_metadata({"refreshToken": "must-not-be-stored"})

    with pytest.raises(AuditContractError, match="too deeply nested"):
        sanitize_audit_metadata({"a": {"b": {"c": {"d": {"e": 1}}}}})


def test_metadata_is_copied_and_uuid_values_are_serialized() -> None:
    resource_id = uuid4()
    source = {"resourceId": resource_id, "counts": [1, 2]}

    sanitized = sanitize_audit_metadata(source)
    assert sanitized == {"resourceId": str(resource_id), "counts": [1, 2]}

    source["counts"].append(3)
    assert sanitized == {"resourceId": str(resource_id), "counts": [1, 2]}
