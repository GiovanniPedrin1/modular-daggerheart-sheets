from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.metrics import router as metrics_router
from app.core.config import Settings, get_settings
from app.core.observability import (
    JsonLogFormatter,
    ObservabilityMetrics,
    Stopwatch,
    reset_current_metrics,
    set_current_metrics,
)
from app.core.request_context import reset_request_id, set_request_id
from app.main import http_exception_handler
from app.middleware.csrf import CsrfProtectionMiddleware
from app.middleware.observability import RequestObservabilityMiddleware
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.services import character_mutation_service as mutation_service
from app.services import character_mutation_transaction_service as transaction_service


def make_registry() -> ObservabilityMetrics:
    return ObservabilityMetrics(version="test", environment="test", enabled=True)


def add_observability_middleware(
    app: FastAPI,
    *,
    settings: Settings,
    metrics: ObservabilityMetrics,
) -> None:
    app.add_middleware(
        RequestObservabilityMiddleware,
        metrics=metrics,
        log_successful_requests=False,
        metrics_path="/metrics",
    )
    app.add_middleware(
        RequestIdMiddleware,
        header_name=settings.request_id_header_name,
        max_length=settings.request_id_max_length,
        accept_incoming=True,
    )


def test_json_log_formatter_adds_request_id_and_redacts_sensitive_fields() -> None:
    formatter = JsonLogFormatter(max_field_length=64, include_tracebacks=False)
    record = logging.LogRecord(
        name="test.logger",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="ignored",
        args=(),
        exc_info=None,
    )
    record.event = "security.test.completed"
    record.structured_fields = {
        "policy": "mutation_user",
        "password": "must-not-appear",
        "nested": {"accessToken": "must-not-appear", "count": 2},
    }
    token = set_request_id("request-observability-test")
    try:
        payload = json.loads(formatter.format(record))
    finally:
        reset_request_id(token)

    assert payload["event"] == "security.test.completed"
    assert payload["requestId"] == "request-observability-test"
    assert payload["policy"] == "mutation_user"
    assert payload["password"] == "[redacted]"
    assert payload["nested"]["accessToken"] == "[redacted]"
    assert "must-not-appear" not in json.dumps(payload)



def test_json_log_formatter_hides_exception_message_when_tracebacks_are_disabled() -> None:
    formatter = JsonLogFormatter(max_field_length=64, include_tracebacks=False)
    try:
        raise RuntimeError("database-password-must-not-appear")
    except RuntimeError:
        import sys

        exc_info = sys.exc_info()

    record = logging.LogRecord(
        name="test.logger",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="safe-event",
        args=(),
        exc_info=exc_info,
    )
    record.event = "http.request.unhandled_error"
    payload = json.loads(formatter.format(record))

    assert payload["exceptionType"] == "RuntimeError"
    assert "traceback" not in payload
    assert "database-password" not in json.dumps(payload)

def test_prometheus_registry_renders_counters_histograms_and_active_gauges() -> None:
    metrics = make_registry()
    metrics.record_http_request(
        method="GET",
        route="/characters/cloud/{character_id}",
        status_code=200,
        duration_seconds=0.02,
    )
    metrics.record_api_error(code="SYNC_CONFLICT", status_code=409)
    metrics.record_character_mutation(
        outcome="conflict",
        duplicate=False,
        merged=False,
        duration_seconds=0.03,
    )
    metrics.record_sse_open(role="owner")
    metrics.record_sse_event(role="owner", event_type="updated")
    metrics.record_sse_close(role="owner", reason="client_disconnected", duration_seconds=1.2)
    metrics.record_character_event_maintenance(
        compacted_count=12,
        deleted_count=4,
        duration_seconds=0.5,
    )
    metrics.record_data_lifecycle_maintenance(
        counts={
            "cloud_character_tombstones": 2,
            "audit_events": 5,
        },
        dry_run=False,
        duration_seconds=0.25,
    )

    text = metrics.render_prometheus()

    assert 'daggerheart_build_info{version="test",environment="test"} 1' in text
    assert (
        'daggerheart_http_requests_total{method="GET",route="/characters/cloud/'
        '{character_id}",status_class="2xx"} 1'
    ) in text
    assert 'daggerheart_api_errors_total{code="SYNC_CONFLICT",status="409"} 1' in text
    assert (
        'daggerheart_character_mutations_total{outcome="conflict",duplicate="false",'
        'merged="false"} 1'
    ) in text
    assert 'daggerheart_sse_connections_active{role="owner"} 0' in text
    assert 'daggerheart_sse_events_sent_total{role="owner",event_type="updated"} 1' in text
    assert (
        'daggerheart_character_event_maintenance_rows_total{action="compacted"} 12'
        in text
    )
    assert (
        'daggerheart_character_event_maintenance_rows_total{action="deleted"} 4'
        in text
    )
    assert "daggerheart_character_event_maintenance_duration_seconds_count 1" in text
    assert (
        'daggerheart_data_lifecycle_rows_total{resource="cloud_character_tombstones",'
        'action="deleted"} 2'
    ) in text
    assert (
        'daggerheart_data_lifecycle_rows_total{resource="audit_events",action="deleted"} 5'
        in text
    )
    assert (
        'daggerheart_data_lifecycle_duration_seconds_count{mode="delete"} 1'
        in text
    )
    assert "_bucket" in text


def build_metrics_app(settings: Settings) -> tuple[FastAPI, ObservabilityMetrics]:
    app = FastAPI()
    metrics = ObservabilityMetrics(
        version=settings.api_version,
        environment=settings.app_env,
        enabled=settings.metrics_enabled,
    )
    app.state.settings = settings
    app.state.metrics = metrics
    app.dependency_overrides[get_settings] = lambda: settings
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.include_router(metrics_router)

    @app.get("/items/{item_id}")
    async def item(item_id: str) -> dict[str, str]:
        return {"id": item_id}

    add_observability_middleware(app, settings=settings, metrics=metrics)
    return app, metrics


def test_metrics_endpoint_requires_bearer_and_uses_route_templates() -> None:
    settings = Settings(
        app_env="test",
        metrics_enabled=True,
        metrics_bearer_token="m" * 32,
    )
    app, _metrics = build_metrics_app(settings)

    with TestClient(app) as client:
        response = client.get("/items/abc")
        unauthorized = client.get("/metrics")
        scrape = client.get("/metrics", headers={"Authorization": f"Bearer {'m' * 32}"})

    assert response.status_code == 200
    assert unauthorized.status_code == 401
    assert scrape.status_code == 200
    assert scrape.headers["cache-control"] == "no-store"
    assert (
        'daggerheart_http_requests_total{method="GET",route="/items/{item_id}",'
        'status_class="2xx"} 1'
    ) in scrape.text
    assert 'route="/items/abc"' not in scrape.text
    assert 'route="/metrics"' not in scrape.text


def test_csrf_and_body_limit_rejections_are_counted_without_request_content() -> None:
    settings = Settings(
        app_env="test",
        csrf_enabled=True,
        cors_allowed_origins=["http://localhost:5173"],
        metrics_enabled=True,
    )
    metrics = make_registry()
    app = FastAPI()
    app.state.settings = settings
    app.state.metrics = metrics

    @app.post("/unsafe")
    async def unsafe() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=8)
    app.add_middleware(
        CsrfProtectionMiddleware,
        enabled=True,
        session_cookie_name=settings.effective_session_cookie_name,
        csrf_cookie_name=settings.effective_csrf_cookie_name,
        csrf_header_name=settings.csrf_header_name,
        secret=settings.session_secret,
        trusted_origins=settings.effective_csrf_trusted_origins,
        request_id_header_name=settings.request_id_header_name,
    )
    add_observability_middleware(app, settings=settings, metrics=metrics)

    with TestClient(app) as client:
        csrf_rejected = client.post("/unsafe", content="sensitive-body")
        body_rejected = client.post(
            "/unsafe",
            headers={"Origin": "http://localhost:5173"},
            content="0123456789",
        )

    assert csrf_rejected.status_code == 403
    assert body_rejected.status_code == 413
    rendered = metrics.render_prometheus()
    assert 'daggerheart_csrf_failures_total{reason="origin_missing"} 1' in rendered
    assert (
        'daggerheart_payload_rejections_total{code="REQUEST_BODY_TOO_LARGE"} 1'
        in rendered
    )
    assert "sensitive-body" not in rendered


@pytest.mark.asyncio
async def test_mutation_transaction_records_result_metric(monkeypatch) -> None:
    metrics = make_registry()
    mutation = SimpleNamespace(
        merged=True,
        unchanged=False,
        base_revision=3,
        applied_revision=5,
        conflict_server_revision=None,
        changed_paths=["/data/hp_current"],
        conflict_paths=None,
        rejection_code=None,
    )
    result = mutation_service.CharacterMutationAppliedResult(
        character=SimpleNamespace(server_revision=5),
        mutation=mutation,
    )
    monkeypatch.setattr(transaction_service, "_run_once", AsyncMock(return_value=result))
    session = AsyncMock()
    token = set_current_metrics(metrics)
    try:
        actual = await transaction_service.execute_owner_character_mutation(
            session,
            owner_user_id=SimpleNamespace(),
            character_id=SimpleNamespace(),
            input_data=SimpleNamespace(),
            settings=Settings(app_env="test"),
        )
    finally:
        reset_current_metrics(token)

    assert actual is result
    assert (
        'daggerheart_character_mutations_total{outcome="applied",duplicate="false",'
        'merged="true"} 1'
    ) in metrics.render_prometheus()


def test_production_metrics_require_a_private_bearer_token() -> None:
    base = {
        "app_env": "production",
        "session_secret": "production-secret-with-sufficient-entropy",
        "cors_allowed_origins": ["https://app.example.com"],
        "trusted_hosts": ["api.example.com"],
        "csrf_enabled": True,
        "audit_enabled": True,
    }
    with pytest.raises(ValidationError, match="METRICS_BEARER_TOKEN"):
        Settings(**base, metrics_enabled=True)

    settings = Settings(**base, metrics_enabled=True, metrics_bearer_token="x" * 32)
    assert settings.metrics_enabled is True


def test_stopwatch_never_returns_negative_duration() -> None:
    stopwatch = Stopwatch.start()
    assert stopwatch.elapsed() >= 0
