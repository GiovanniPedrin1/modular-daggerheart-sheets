from fastapi.testclient import TestClient

from app.main import app


def test_auth_routes_are_registered() -> None:
    client = TestClient(app)

    response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/auth/register" in paths
    assert "/auth/login" in paths
    assert "/auth/refresh" in paths
    assert "/auth/me" in paths
    assert "/auth/logout" in paths
    assert "/backups" in paths
    assert "/backups/latest" in paths
    assert "/backups/{backup_id}" in paths
