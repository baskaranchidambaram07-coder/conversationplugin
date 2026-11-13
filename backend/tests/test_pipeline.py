"""The request pipeline (M4-T1, M4-T2 middleware tests): one error format, security headers, size limit, access log."""

import logging
import re

from fastapi.testclient import TestClient
from pydantic import BaseModel

from ucp.gateway.app import create_app
from ucp.gateway.openapi import OPENAPI_FILE, openapi_text
from ucp.gateway.pipeline import MAX_BODY, Problem
from ucp.protocol import ApiError


class Echo(BaseModel):
    text: str


def client() -> TestClient:
    app = create_app()

    @app.post("/test/echo")
    async def echo(body: Echo) -> Echo:
        return body

    @app.get("/test/busy")
    async def busy():
        raise Problem("rate_limited", retryable=True, retry_after=7)

    @app.get("/test/bug")
    async def bug():
        raise RuntimeError("secret detail from deep inside")

    return TestClient(app)


def error_of(response) -> ApiError:
    error = ApiError.model_validate_json(response.content)  # strict: exactly our format, nothing more
    assert error.reference == response.headers["x-request-id"]
    return error


def test_unknown_routes_and_methods_answer_not_found_in_our_format():
    for response in (client().get("/nothing/here"), client().delete("/healthz")):
        assert response.status_code == 404
        assert error_of(response).code == "not_found"


def test_the_gateways_own_lines_reach_standard_output_where_the_container_service_collects_them(capsys):
    # Without this, Python dropped every informational line in production: the access log, each turn, each refusal.
    ours = logging.getLogger("ucp")
    ours.handlers.clear()  # so the gateway writes to this test's captured output
    try:
        client().get("/test/echo")
        written = capsys.readouterr().out
    finally:
        ours.handlers.clear()  # the next gateway built writes to the real output again
    assert re.search(r"^INFO ucp\.access GET /test/echo \d{3} \d+ms r_[\w-]+$", written, re.M)


def test_an_invalid_body_is_refused_without_echoing_any_of_it():
    # Values no random reference could contain by chance (a reference once held "42", failing this test).
    response = client().post("/test/echo", json={"text": 987654321, "extra": "<script>"})

    assert response.status_code == 400
    assert error_of(response).code == "invalid_request"
    assert "<script>" not in response.text and "987654321" not in response.text


def test_a_problem_carries_its_retry_hint_in_the_body_and_the_header():
    response = client().get("/test/busy")

    assert response.status_code == 429
    error = error_of(response)
    assert (error.code, error.retryable, error.retry_after) == ("rate_limited", True, 7)
    assert response.headers["retry-after"] == "7"


def test_an_unexpected_failure_says_only_that_and_logs_the_detail_under_the_reference(caplog):
    with caplog.at_level(logging.ERROR, logger="ucp.gateway"):
        response = client().get("/test/bug")

    assert response.status_code == 500
    error = error_of(response)
    assert error.code == "internal_error" and "secret" not in response.text
    assert any(error.reference in record.getMessage() for record in caplog.records)
    assert "secret detail" in caplog.text


def test_a_body_over_the_limit_is_refused_whether_or_not_its_length_is_declared():
    big = "x" * (MAX_BODY + 1)
    declared = client().post("/test/echo", content=f'{{"text": "{big}"}}', headers={"content-type": "application/json"})

    def chunks():
        yield b'{"text": "'
        yield big.encode()
        yield b'"}'

    undeclared = client().post("/test/echo", content=chunks(), headers={"content-type": "application/json"})

    for response in (declared, undeclared):
        assert response.status_code == 400
        assert error_of(response).code == "invalid_request"


def test_every_reply_carries_the_security_headers_and_a_request_id():
    for response in (client().get("/healthz"), client().get("/nothing")):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-request-id"].startswith("r_")
        assert "server" not in response.headers


def test_the_access_log_names_the_route_not_the_request_and_never_the_token(caplog):
    with caplog.at_level(logging.INFO, logger="ucp.access"):
        response = client().post(
            "/test/echo?secret=query", json={"text": "my question"}, headers={"authorization": "Bearer tok_secret"}
        )

    line = next(record.getMessage() for record in caplog.records if record.name == "ucp.access")
    assert line.startswith("POST /test/echo 200 ") and line.endswith(response.headers["x-request-id"])
    assert "tok_secret" not in caplog.text and "my question" not in caplog.text and "secret=query" not in caplog.text


def test_the_api_description_file_matches_the_routes():
    stale = "Run: cd backend && uv run python -m ucp.gateway.openapi"
    assert OPENAPI_FILE.read_text(encoding="utf-8") == openapi_text(), stale
