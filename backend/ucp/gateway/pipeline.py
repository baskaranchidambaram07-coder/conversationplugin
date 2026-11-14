"""What every request passes through (M4-T1, M4-T2): a correlation ID, a body-size limit, security headers, an
access log without secrets, and one error format. Every error the gateway sends is an ApiError in our own words;
nothing from PF, the framework or a stack trace reaches the browser (R13)."""

import logging
import secrets
import sys
import time
from contextvars import ContextVar
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from ucp.protocol import ApiError

log = logging.getLogger("ucp.gateway")
access = logging.getLogger("ucp.access")

MAX_BODY = 64 * 1024  # a question is at most 4,000 characters and a host token 8 KB
correlation: ContextVar[str] = ContextVar("correlation", default="r_none")

type Code = Literal[
    "invalid_request",
    "sign_in_required",
    "session_expired",
    "forbidden",
    "site_not_allowed",
    "not_found",
    "turn_in_progress",
    "conflict",
    "rate_limited",
    "assistant_unavailable",
    "internal_error",
]

# Our wording and HTTP status for each code. The chat shows its own words; these are for API users and support.
CODES: dict[str, tuple[int, str]] = {
    "invalid_request": (400, "The request is not valid."),
    "sign_in_required": (401, "Sign in to continue."),  # the admin API (M8)
    "session_expired": (401, "The session has ended. Start a new one."),
    "forbidden": (403, "This is not allowed."),
    "site_not_allowed": (403, "This site may not show this assistant."),
    "not_found": (404, "Not found."),
    "turn_in_progress": (409, "An answer is still on its way in this conversation."),
    "conflict": (409, "Someone else changed this first. Reload it, then try again."),  # the admin API (M8)
    "rate_limited": (429, "Too many requests. Wait a moment, then try again."),
    "assistant_unavailable": (503, "The assistant is not available just now. Try again shortly."),
    "internal_error": (500, "Something went wrong on our side."),
}

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    # API replies are never pages: nothing may run in them or frame them. The chat page sets its own policy.
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "cache-control": "no-store",
}


class Problem(Exception):
    """Raised anywhere to answer with that ApiError."""

    def __init__(self, code: Code, *, retryable: bool = False, retry_after: int | None = None):
        super().__init__(code)
        self.code, self.retryable, self.retry_after = code, retryable, retry_after


def api_error(code: Code, *, retryable: bool = False, retry_after: int | None = None) -> ApiError:
    return ApiError(
        code=code,
        message=CODES[code][1],
        retryable=retryable,
        retry_after=retry_after,
        reference=correlation.get(),
    )


def problem_response(problem: Problem) -> JSONResponse:
    body = api_error(problem.code, retryable=problem.retryable, retry_after=problem.retry_after)
    headers = {"retry-after": str(problem.retry_after)} if problem.retry_after is not None else None
    return JSONResponse(body.model_dump(mode="json"), status_code=CODES[problem.code][0], headers=headers)


async def _problem(_: Request, problem: Problem) -> JSONResponse:
    return problem_response(problem)


async def _invalid(_: Request, __: Exception) -> JSONResponse:
    return problem_response(Problem("invalid_request"))  # the validation detail would echo the request back


async def _http(_: Request, error: HTTPException) -> JSONResponse:
    return problem_response(Problem("not_found" if error.status_code in (404, 405) else "invalid_request"))


class Pipeline:
    """Pure ASGI, outermost, so it also covers errors no handler caught and responses that stream."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        token = correlation.set(f"r_{secrets.token_urlsafe(12)}")
        started, status, received = time.perf_counter(), 500, 0
        scope.setdefault("state", {})["received"] = started  # for the gateway's own share of a first word (ucp.turns)
        response_started = False

        async def limited_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY:
                raise _TooLarge
            return message

        async def secured_send(message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status, response_started = message["status"], True
                present = {name.lower() for name, _ in message.get("headers", [])}
                extra = [(k.encode(), v.encode()) for k, v in SECURITY_HEADERS.items() if k.encode() not in present]
                extra.append((b"x-request-id", correlation.get().encode()))
                message = {**message, "headers": [*message.get("headers", []), *extra]}
            await send(message)

        declared = dict(scope["headers"]).get(b"content-length")
        try:
            if declared and declared.isdigit() and int(declared) > MAX_BODY:
                raise _TooLarge
            await self.app(scope, limited_receive, secured_send)
        except _TooLarge:
            if not response_started:
                await problem_response(Problem("invalid_request"))(scope, receive, secured_send)
        except Exception:
            log.exception("unhandled error, reference %s", correlation.get())
            if not response_started:
                await problem_response(Problem("internal_error"))(scope, receive, secured_send)
        finally:
            route = getattr(scope.get("route"), "path", "unmatched")
            took = round((time.perf_counter() - started) * 1000)
            access.info("%s %s %s %dms %s", scope["method"], route, status, took, correlation.get())
            correlation.reset(token)


class _TooLarge(Exception):
    pass


def install_logging(level: str) -> None:
    """The gateway's own lines (the access log, each turn, sign-in refusals) to standard output, where the container
    service collects them. Unless something is configured Python drops informational lines, and the web server
    configures only its own loggers."""
    ours = logging.getLogger("ucp")
    if not ours.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
        ours.addHandler(handler)
    ours.setLevel(level)


def install(app: FastAPI) -> None:
    app.add_exception_handler(Problem, _problem)
    app.add_exception_handler(RequestValidationError, _invalid)
    app.add_exception_handler(HTTPException, _http)
    app.add_middleware(Pipeline)
