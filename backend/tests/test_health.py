from fastapi.testclient import TestClient

from ucp.gateway.app import create_app


def test_health_reports_ok():
    response = TestClient(create_app()).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_description_pages_are_not_served():
    client = TestClient(create_app())

    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
