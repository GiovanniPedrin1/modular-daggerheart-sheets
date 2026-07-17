from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.middleware.private_response_headers import PrivateResponseHeadersMiddleware


def build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(PrivateResponseHeadersMiddleware)

    @app.get("/shared/characters")
    async def shared() -> dict[str, list]:
        return {"characters": []}

    @app.get("/characters/cloud/one/events")
    async def stream() -> StreamingResponse:
        return StreamingResponse(
            iter([b": heartbeat\n\n"]),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-store, private, no-transform"},
        )

    @app.get("/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    return app


def test_sensitive_api_responses_are_never_cacheable() -> None:
    response = TestClient(build_app()).get("/shared/characters")

    assert response.headers["cache-control"] == "no-store, private"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"
    assert response.headers["x-robots-tag"] == "noindex, noarchive"


def test_existing_stronger_sse_cache_contract_is_preserved() -> None:
    response = TestClient(build_app()).get("/characters/cloud/one/events")

    assert response.headers["cache-control"] == "no-cache, no-store, private, no-transform"
    assert response.headers["x-robots-tag"] == "noindex, noarchive"


def test_public_health_response_is_not_modified() -> None:
    response = TestClient(build_app()).get("/health")

    assert "cache-control" not in response.headers
    assert "x-robots-tag" not in response.headers
