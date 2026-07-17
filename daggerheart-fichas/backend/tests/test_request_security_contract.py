from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.api.errors import api_error
from app.core.config import Settings
from app.main import (
    http_exception_handler,
    request_validation_exception_handler,
    unhandled_exception_handler,
)
from app.middleware.request_id import RequestIdMiddleware


def build_test_app() -> FastAPI:
    settings = Settings(app_env="test")
    test_app = FastAPI()
    test_app.state.settings = settings
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[settings.request_id_header_name],
    )
    test_app.add_middleware(
        RequestIdMiddleware,
        header_name=settings.request_id_header_name,
        max_length=settings.request_id_max_length,
        accept_incoming=settings.accept_incoming_request_id,
    )
    test_app.add_exception_handler(HTTPException, http_exception_handler)
    test_app.add_exception_handler(RequestValidationError, request_validation_exception_handler)
    test_app.add_exception_handler(Exception, unhandled_exception_handler)

    @test_app.get("/ok")
    async def ok() -> dict[str, bool]:
        return {"ok": True}

    @test_app.get("/typed-error")
    async def typed_error() -> None:
        raise api_error(
            409,
            "SECURITY_CONTRACT_TEST",
            "The test request was rejected.",
            {"safe": True},
        )

    @test_app.get("/items/{item_id}")
    async def get_item(item_id: UUID) -> dict[str, str]:
        return {"id": str(item_id)}

    @test_app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("database-password-must-never-leak")

    return test_app


def test_request_id_is_generated_and_exposed_to_browser_clients() -> None:
    client = TestClient(build_test_app())

    response = client.get(
        "/ok",
        headers={"Origin": "http://localhost:5173"},
    )

    request_id = response.headers["x-request-id"]
    assert request_id.startswith("req_")
    assert response.headers["access-control-expose-headers"] == "X-Request-ID"


def test_safe_incoming_request_id_is_preserved() -> None:
    client = TestClient(build_test_app())

    response = client.get("/ok", headers={"X-Request-ID": "frontend:sync-123"})

    assert response.headers["x-request-id"] == "frontend:sync-123"


def test_invalid_or_oversized_request_id_is_replaced() -> None:
    client = TestClient(build_test_app())

    invalid = client.get("/ok", headers={"X-Request-ID": "contains spaces"})
    oversized = client.get("/ok", headers={"X-Request-ID": "a" * 500})

    assert invalid.headers["x-request-id"].startswith("req_")
    assert oversized.headers["x-request-id"].startswith("req_")


def test_typed_api_error_keeps_stable_body_and_request_id_header() -> None:
    client = TestClient(build_test_app())

    response = client.get(
        "/typed-error",
        headers={"X-Request-ID": "request-typed-error"},
    )

    assert response.status_code == 409
    assert response.headers["x-request-id"] == "request-typed-error"
    assert response.json() == {
        "code": "SECURITY_CONTRACT_TEST",
        "message": "The test request was rejected.",
        "detail": {"safe": True},
    }


def test_validation_error_uses_sanitized_stable_contract() -> None:
    client = TestClient(build_test_app())

    response = client.get("/items/not-a-uuid")

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "REQUEST_VALIDATION_FAILED"
    assert payload["message"] == "The request payload or parameters are invalid."
    assert payload["detail"]["errorCount"] == 1
    assert payload["detail"]["truncated"] is False
    assert payload["detail"]["errors"][0]["location"] == ["path", "item_id"]
    assert "input" not in payload["detail"]["errors"][0]
    assert "ctx" not in payload["detail"]["errors"][0]
    assert response.headers["x-request-id"].startswith("req_")


def test_unhandled_error_never_exposes_exception_text() -> None:
    client = TestClient(build_test_app(), raise_server_exceptions=False)

    response = client.get("/boom", headers={"X-Request-ID": "request-boom"})

    assert response.status_code == 500
    assert response.headers["x-request-id"] == "request-boom"
    assert response.json() == {
        "code": "INTERNAL_SERVER_ERROR",
        "message": "An unexpected server error occurred.",
        "detail": None,
    }
    assert "database-password" not in response.text
