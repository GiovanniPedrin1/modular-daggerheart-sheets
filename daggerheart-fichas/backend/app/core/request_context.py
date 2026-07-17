from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from uuid import uuid4

from app.core.security_contracts import is_valid_request_id

_request_id_context: ContextVar[str | None] = ContextVar(
    "daggerheart_request_id",
    default=None,
)


@dataclass(frozen=True, slots=True)
class RequestAuditSource:
    """Minimal request data available to audit records without passing Request around.

    ``client_host`` is the direct ASGI peer. Forwarded headers are deliberately not
    trusted here; deployments that terminate traffic at a proxy should make the ASGI
    server expose the verified peer address.
    """

    request_id: str
    client_host: str | None
    user_agent: str | None


_request_audit_source_context: ContextVar[RequestAuditSource | None] = ContextVar(
    "daggerheart_request_audit_source",
    default=None,
)


def generate_request_id() -> str:
    return f"req_{uuid4().hex}"


def choose_request_id(candidate: str | None, *, max_length: int) -> str:
    if candidate is not None:
        normalized = candidate.strip()
        if is_valid_request_id(normalized, max_length=max_length):
            return normalized
    return generate_request_id()


def set_request_id(request_id: str) -> Token[str | None]:
    return _request_id_context.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id_context.reset(token)


def get_request_id() -> str | None:
    return _request_id_context.get()


def set_request_audit_source(source: RequestAuditSource) -> Token[RequestAuditSource | None]:
    return _request_audit_source_context.set(source)


def reset_request_audit_source(token: Token[RequestAuditSource | None]) -> None:
    _request_audit_source_context.reset(token)


def get_request_audit_source() -> RequestAuditSource | None:
    return _request_audit_source_context.get()
