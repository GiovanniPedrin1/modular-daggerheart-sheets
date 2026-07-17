from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.payload_validation import JsonPayloadValidationError, validate_json_payload
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware


def build_limited_app(*, max_bytes: int) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=max_bytes)
    app.add_middleware(
        RequestIdMiddleware,
        header_name="X-Request-ID",
        max_length=96,
    )

    @app.post("/echo")
    async def echo(request: Request) -> dict[str, int]:
        body = await request.body()
        return {"size": len(body)}

    return app


def test_json_payload_depth_accepts_boundary_and_rejects_next_level() -> None:
    validate_json_payload(
        {"one": {"two": "ok"}},
        max_depth=2,
        max_string_bytes=32,
    )

    with pytest.raises(JsonPayloadValidationError) as exc_info:
        validate_json_payload(
            {"one": {"two": {"three": "too deep"}}},
            max_depth=2,
            max_string_bytes=32,
        )

    assert exc_info.value.reason == "nesting is too deep"
    assert exc_info.value.path == "/one/two"
    assert exc_info.value.actual == 3


def test_json_payload_string_limit_uses_utf8_bytes_for_values_and_keys() -> None:
    validate_json_payload("éé", max_depth=1, max_string_bytes=4)

    with pytest.raises(JsonPayloadValidationError) as value_error:
        validate_json_payload("ééé", max_depth=1, max_string_bytes=4)
    assert value_error.value.reason == "string is too large"
    assert value_error.value.actual == 6

    with pytest.raises(JsonPayloadValidationError) as key_error:
        validate_json_payload({"ééé": True}, max_depth=1, max_string_bytes=4)
    assert key_error.value.reason == "object key is too large"
    assert key_error.value.path == "/ééé"


def test_json_payload_rejects_cycles_without_recursing_forever() -> None:
    payload: list[object] = []
    payload.append(payload)

    with pytest.raises(JsonPayloadValidationError, match="cyclic structure"):
        validate_json_payload(payload, max_depth=10, max_string_bytes=32)


def test_request_body_limit_rejects_content_length_before_endpoint() -> None:
    with TestClient(build_limited_app(max_bytes=8)) as client:
        response = client.post(
            "/echo",
            content=b"123456789",
            headers={"X-Request-ID": "req-body-limit"},
        )

    assert response.status_code == 413
    assert response.headers["X-Request-ID"] == "req-body-limit"
    assert response.json() == {
        "code": "REQUEST_BODY_TOO_LARGE",
        "message": "The request body exceeds the configured size limit.",
        "detail": {"maxBytes": 8, "actualBytes": 9},
    }


def test_request_body_limit_accepts_exact_boundary() -> None:
    with TestClient(build_limited_app(max_bytes=8)) as client:
        response = client.post("/echo", content=b"12345678")

    assert response.status_code == 200
    assert response.json() == {"size": 8}


def test_request_body_limit_counts_streamed_chunks_without_content_length() -> None:
    def content() -> Iterator[bytes]:
        yield b"1234"
        yield b"56789"

    with TestClient(build_limited_app(max_bytes=8)) as client:
        response = client.post("/echo", content=content())

    assert response.status_code == 413
    assert response.json()["code"] == "REQUEST_BODY_TOO_LARGE"
    assert response.json()["detail"] == {"maxBytes": 8, "actualBytes": 9}
