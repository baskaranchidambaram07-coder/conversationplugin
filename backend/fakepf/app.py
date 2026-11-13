"""Fake PF: answers like the PF conversation API in docs/pf-capability-sheet.md by replaying cleaned recordings.

Run:  cd backend && uv run uvicorn fakepf.app:app --port 8100

The message text picks the behaviour, so a test at any level (connector, gateway, browser) can choose one:
    anything else   short reply: every word arrives at once, as PF does for quick answers
    [long]          long streamed reply: 205 word events over 12.8 s, with headings, a table, code and a diagram
    [slow]          the short reply after a 65 s silence, so the first word takes over a minute
    [error]         three words, then PF's ERROR event inside the HTTP 201 stream
    [seeded]        the short reply with every event carrying what PF might add one day: internal addresses,
                    sources, citations, model and tool details (all marked SEEDED), to prove the allow-list (R13)
Wrong credentials get PF's failed login (HTTP 200, RESULT_FAILURE). POST /_fake/expire-tokens expires every token,
so the next call gets PF's 401. An unknown conversation or an empty message gets PF's recorded ERROR events.
The fetch call answers IN_PROGRESS until the recorded reply would have finished, even if the caller hung up.

Not recorded, so assumed: the failed-login wording, an error in the middle of an answer, what the fetch call says
after a stream error (FAILED here), and errors on the plain send call. Rate limiting is not faked.
"""

import asyncio
import copy
import itertools
import json
import os
import re
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

RECORDINGS = Path(__file__).parent / "recordings"
API = "/magicplatform/v1/genai/conversation"
TENANT, API_KEY, USERNAME, PASSWORD = "fake-tenant", "fake-api-key", "fake-user", "fake-password"
SLOW_MS = 65_000
SEEDED = "http://10.20.30.40/pf-internal/SEEDED"

NOTICES = ['{"content":"Stream connection established successfully"}', '{"content":"Agent Execution InProgress"}']
UNAUTHORIZED = {"message": "Not Authorized.", "error": "Unauthorized", "statusCode": 401}
UNKNOWN_ID = {"message": "Unable to process the request. Please try again."}
LOGIN_FAILED = {"result": "RESULT_FAILURE", "message": "Invalid user credentials", "active": False}
STREAM_HEADERS = {"content-type": "text/event-stream", "ratelimit-limit": "5000", "ratelimit-remaining": "4999"}


def _load(name):
    """A recording: its header (stand-in IDs and the query asked) and its events as (ms after the request, data)."""
    header, events, at_ms = {}, [], 0
    for line in (RECORDINGS / f"{name}.sse").read_text(encoding="utf-8").splitlines():
        if line.startswith("data: "):
            events.append((at_ms, line.removeprefix("data: ")))
        elif line.startswith(": "):
            key, value = line[2:].split("=", 1)
            if key == "at_ms":
                at_ms = int(value)
            else:
                header[key] = json.loads(value)
    return header, events


RECORDED = {name: _load(name) for name in ("short", "long")}
FINAL = {
    name: next(json.loads(data)["content"] for _, data in events if '"FINAL_RESPONSE"' in data)
    for name, (_, events) in RECORDED.items()
}
TEMPLATES = json.loads((RECORDINGS / "records.json").read_text(encoding="utf-8"))
WORKSPACE_ID = RECORDED["short"][0]["workspace_id"]
AGENT_VERSION_ID = RECORDED["short"][0]["asset_version_id"]


def _stream_error(text, status_code):
    content = {"response": text, "error_description": text, "status_code": status_code}
    return json.dumps({"event": "ERROR", "status": "FAILED", "content": content}, separators=(",", ":"))


def _seed(data):
    """An event with internal details added at the top and inside its content; answer text is left alone."""
    event = json.loads(data)
    event["seeded"] = SEEDED
    if isinstance(event.get("content"), dict):
        event["content"].update(
            sources=[{"url": f"{SEEDED}/source", "title": "SEEDED source"}],
            citation=[f"{SEEDED}/citation"],
            model="SEEDED-model",
            selected_tools=["SEEDED-tool"],
            traces=[f"{SEEDED}/trace"],
        )
    return json.dumps(event, separators=(",", ":"))


def _script(query):
    """Which recording a message replays, and its events with any scripted change."""
    if "[error]" in query:
        words = [i for i, (_, data) in enumerate(RECORDED["long"][1]) if '"LLM_RESPONSE_STREAM"' in data]
        cut = words[3]  # the START event, then three words
        events = RECORDED["long"][1][: cut + 1]
        return "long", [*events, (events[-1][0] + 200, _stream_error(UNKNOWN_ID["message"], 500))]
    if "[slow]" in query:
        first = next(i for i, (_, data) in enumerate(RECORDED["short"][1]) if '"LLM_RESPONSE_STREAM"' in data)
        events = RECORDED["short"][1]
        return "short", [*events[:first], *((at + SLOW_MS, data) for at, data in events[first:])]
    if "[seeded]" in query:
        return "short", [(at, _seed(data)) for at, data in RECORDED["short"][1]]
    name = "long" if "[long]" in query else "short"
    return name, RECORDED[name][1]


def create_app(time_scale: float = 1.0) -> FastAPI:
    """time_scale multiplies every recorded delay. Tests use 0 to skip the waiting."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    numbers = itertools.count(1)  # every ID comes from here, so a fresh app always repeats the same bytes
    tokens, conversations, messages = set(), {}, {}

    def object_id():
        return f"6f{next(numbers):022x}"

    def record(message, status):
        body = copy.deepcopy(TEMPLATES["completed" if status == "COMPLETED" else "accepted"])
        body.update(message_id=message["id"], conversation_id=message["conversation_id"], workspace_id=WORKSPACE_ID)
        content = body["message_content"][0]
        content.update(message_content_id=message["content_id"], query=message["query"], status=status)
        if status == "COMPLETED":
            content.update({key: FINAL[message["recording"]][key] for key in ("response", "metrics", "context_usage")})
        return body

    def accept(body):
        """Starts a message the way PF does. Returns the message, or instead the ERROR event PF sends."""
        conversation_id, query = body.get("conversation_id"), body.get("query") or ""
        if conversation_id not in conversations:
            return None, _stream_error("Conversation not found", 404)
        if not query:
            return None, _stream_error("Invalid Input. Query cannot be empty", 400)
        name, events = _script(query)
        message = {"id": object_id(), "content_id": object_id(), "conversation_id": conversation_id, "query": query}
        header = RECORDED[name][0]
        live = {
            header["conversation_id"]: conversation_id,
            header["message_id"]: message["id"],
            header["message_content_id"]: message["content_id"],
            header["asset_version_id"]: conversations[conversation_id],
            json.dumps(header["query"])[1:-1]: json.dumps(query)[1:-1],
        }
        swap = re.compile("|".join(map(re.escape, live)))  # one pass, so a live value is never swapped again
        message.update(
            recording=name,
            failed="[error]" in query,
            events=[(at, swap.sub(lambda found: live[found.group()], data)) for at, data in events],
            done_at=time.monotonic() + events[-1][0] * time_scale / 1000,
        )
        messages[message["id"]] = message
        return message, None

    async def replay(events):
        start = time.monotonic()
        for at_ms, data in events:
            if (wait := start + at_ms * time_scale / 1000 - time.monotonic()) > 0:
                await asyncio.sleep(wait)
            yield f"data: {data}\n\n"

    @app.middleware("http")
    async def pf_gateway(request: Request, call_next):
        # PF checks the token before anything else, and stamps every response with its own request ID.
        if request.url.path.startswith(API) and request.headers.get("authorization") not in {
            f"Bearer {token}" for token in tokens
        }:
            response = JSONResponse(UNAUTHORIZED, status_code=401)
        else:
            response = await call_next(request)
        response.headers["x-platform-request-id"] = f"tran:00000000-0000-4000-8000-{next(numbers):012x}"
        return response

    @app.get("/accesstoken/{tenant}")
    async def login(tenant: str, request: Request):
        given = tuple(request.headers.get(name) for name in ("apikey", "username", "password"))
        if (tenant, *given) != (TENANT, API_KEY, USERNAME, PASSWORD):
            return JSONResponse(LOGIN_FAILED)  # PF reports a failed login with HTTP 200
        number = next(numbers)
        tokens.add(f"fake-access-token-{number}")
        return {
            "result": "RESULT_SUCCESS",
            "active": True,
            "access_token": f"fake-access-token-{number}",
            "expires_in": "28800",
            "refresh_token": f"fake-refresh-token-{number}",
            "refresh_expires_in": "3888000",
        }

    @app.post("/_fake/expire-tokens", status_code=204)
    async def expire_tokens():
        tokens.clear()

    @app.post(f"{API}/create")
    async def create(request: Request):
        body = await request.json()
        conversation_id = object_id()
        conversations[conversation_id] = body.get("asset_version_id")
        details = {
            **TEMPLATES["conversation"],
            "conversation_id": conversation_id,
            "conversation_name": body.get("conversation_name"),
            "asset_version_id": body.get("asset_version_id"),
            "workspace_id": WORKSPACE_ID,
            "_id": object_id(),
        }
        return JSONResponse({"conversation_details": details}, status_code=201)

    @app.post(f"{API}/addmessage/stream")
    async def add_message_stream(request: Request):
        message, error = accept(await request.json())
        events = message["events"] if message else [(0, notice) for notice in NOTICES] + [(0, error)]
        return StreamingResponse(replay(events), status_code=201, headers=STREAM_HEADERS)

    @app.post(f"{API}/addmessage")
    async def add_message(request: Request):
        message, error = accept(await request.json())
        return JSONResponse(json.loads(error) if error else record(message, "IN_PROGRESS"), status_code=201)

    @app.get(f"{API}/response/{{conversation_id}}/{{message_id}}")
    async def fetch(conversation_id: str, message_id: str):
        message = messages.get(message_id)  # the content ID from later events is not a message ID: PF answers 500
        if not message or message["conversation_id"] != conversation_id:
            return JSONResponse(UNKNOWN_ID, status_code=500)
        if time.monotonic() < message["done_at"]:
            return record(message, "IN_PROGRESS")
        return record(message, "FAILED" if message["failed"] else "COMPLETED")

    return app


app = create_app(float(os.environ.get("FAKE_PF_SPEED", "1")))  # devstack.py sets it; 1 is the recorded pace
