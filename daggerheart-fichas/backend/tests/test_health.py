from fastapi.testclient import TestClient

from app.main import app


def test_health_check_returns_ok() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["app"] == "Daggerheart Fichas API"


def test_database_health_never_exposes_exception_text(monkeypatch) -> None:
    async def fail_database_ping() -> None:
        raise RuntimeError("postgresql://user:secret@database/internal")

    monkeypatch.setattr("app.api.health.ping_database", fail_database_ping)
    client = TestClient(app)

    response = client.get("/health/db")

    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert response.json()["error"] == "database_unavailable"
    assert "secret" not in response.text
