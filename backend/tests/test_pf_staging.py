"""PF staging against docs/pf-capability-sheet.md and the fake PF (M6 sandbox suite, M6-T8).

Each test checks one claim the sheet makes, against the real PF, and the shapes the fake PF replays are compared with
what PF sends today, so neither the sheet nor the fake can drift from PF unnoticed.

    cd backend && UCP_PF_STAGING=1 uv run --env-file ../.env pytest tests/test_pf_staging.py

Opt-in, because each run asks the staging agent four questions and leaves four conversations named `ucp-test-*`
(PF has no delete call). Failure reports have PF's address, IDs and tokens blanked (conftest.py), so a run's output
can be shared. Not tried here: a wrong password, since repeated refusals can lock the shared service account, and the
rate limit (5,000 calls a minute); the fake PF and test_pf_wire.py cover both.
"""

import io
import json
import os
import secrets
import time
import zipfile

import httpx2
import pytest

from devstack import staging_profile
from fakepf.app import FINAL, RECORDED, REF_REFUSED, TEMPLATES
from ucp.connector import Accepted, AgentFile, Final, Text
from ucp.pf import API, PfConnector, PfProfile

SETTINGS = ("PF_BASE_URL", "PF_TENANT", "PF_API_KEY", "PF_USERNAME", "PF_PASSWORD", "PF_WORKSPACE_ID", "PF_AGENT_ID")
READY = "Reply with the single word READY."
pytestmark = pytest.mark.skipif(
    os.environ.get("UCP_PF_STAGING") != "1" or not all(os.environ.get(name) for name in SETTINGS),
    reason="set UCP_PF_STAGING=1 and the PF_* settings to run against PF staging",
)


@pytest.fixture(scope="module")
def pf() -> PfProfile:
    return PfProfile(**staging_profile())


def login(pf: PfProfile) -> httpx2.Response:
    headers = {"apikey": pf.api_key.get_secret_value(), "username": pf.username}
    headers["password"] = pf.password.get_secret_value()
    return httpx2.get(f"{pf.base_url}/accesstoken/{pf.tenant}", headers=headers, timeout=30)


@pytest.fixture(scope="module")
def client(pf):
    token = login(pf).json()["access_token"]
    headers = {"apikey": pf.api_key.get_secret_value(), "X-Platform-Workspaceid": pf.workspace_id}
    with httpx2.Client(
        base_url=f"{pf.base_url}{API}",
        headers={**headers, "authorization": f"Bearer {token}"},
        timeout=httpx2.Timeout(30, read=120),
    ) as client:
        yield client


def create(client: httpx2.Client, pf: PfProfile) -> httpx2.Response:
    name = f"ucp-test-{secrets.token_hex(4)}"
    return client.post("/create", json={"asset_version_id": pf.agent_version_id, "conversation_name": name})


def stream(client: httpx2.Client, conversation_id: str, query: str, *, until: str | None = None):
    """PF's events for one question, and the reply's headers. With `until`, hangs up at the first event of that kind."""
    events = []
    body = {"conversation_id": conversation_id, "query": query}
    with client.stream("POST", "/addmessage/stream", json=body) as reply:
        assert reply.status_code == 201
        for line in reply.iter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:]))
                if until and events[-1].get("event") == until:
                    break
        return events, reply.headers


def outline(events: list[dict]) -> list[tuple]:
    """The order of kinds of event, with each run of word events counted once."""
    kinds = [(event.get("event"), event.get("status")) for event in events]
    return [kind for n, kind in enumerate(kinds) if n == 0 or kind != kinds[n - 1]]


@pytest.fixture(scope="module")
def answered(client, pf):
    """One conversation with one answered question, shared by the checks that only read it."""
    details = create(client, pf).json()["conversation_details"]
    events, headers = stream(client, details["conversation_id"], READY)
    return details, events, headers


def test_login_gives_an_eight_hour_token_and_a_45_day_refresh_token_with_durations_as_text(pf):
    reply = login(pf)
    body = reply.json()

    assert reply.status_code == 200 and body["result"] == "RESULT_SUCCESS"
    assert body["access_token"] and body["refresh_token"]
    assert (body["expires_in"], body["refresh_expires_in"]) == ("28800", "3888000")


def test_a_second_login_leaves_the_first_token_working(client, pf):
    login(pf)

    assert create(client, pf).status_code == 201


def test_a_new_conversation_has_the_recorded_details_and_our_name(answered):
    details, _, _ = answered

    assert details.keys() == TEMPLATES["conversation"].keys()
    assert details["conversation_name"].startswith("ucp-test-")
    assert details["mode"] == "Live" and not details["deleted_at"]


def test_the_stream_comes_in_the_recorded_order_with_the_recorded_fields(answered):
    _, events, _ = answered
    recorded = [json.loads(data) for _, data in RECORDED["short"][1]]

    assert outline(events) == outline(recorded)
    fields = {(event.get("event"), event.get("status")): event.keys() for event in recorded}
    for event in events:
        assert event.keys() == fields[(event.get("event"), event.get("status"))], event.get("event")
    final = next(event["content"] for event in events if event.get("event") == "FINAL_RESPONSE")
    assert final.keys() == FINAL["short"].keys()
    assert {"prompt_tokens", "completion_tokens", "total_tokens", "total_cost"} <= final["metrics"].keys()


def test_the_word_events_add_up_to_the_final_answer_as_the_fake_assumes(answered):
    _, events, _ = answered
    words = [e["content"] for e in events if e.get("event") == "LLM_RESPONSE_STREAM" and e["status"] == "IN_PROGRESS"]
    final = next(event["content"]["response"] for event in events if event.get("event") == "FINAL_RESPONSE")

    assert words and "".join(words) == final


def test_the_stream_reports_the_rate_limit_in_its_headers(answered):
    _, _, headers = answered

    assert {"ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"} <= headers.keys()


def test_two_ids_share_one_name_and_only_the_one_from_message_details_fetches_the_answer(client, answered):
    details, events, _ = answered
    message_id = next(event["message_id"] for event in events if event.get("event") == "MESSAGE_DETAILS")
    later_id = next(event["message_id"] for event in events if event.get("event") == "FINAL_RESPONSE")
    final = next(event["content"]["response"] for event in events if event.get("event") == "FINAL_RESPONSE")
    conversation = details["conversation_id"]

    assert later_id != message_id
    record = client.get(f"/response/{conversation}/{message_id}").json()
    assert record.keys() == TEMPLATES["completed"].keys()
    assert (record["message_content"][0]["status"], record["message_content"][0]["response"]) == ("COMPLETED", final)
    wrong = client.get(f"/response/{conversation}/{later_id}")
    assert (wrong.status_code, wrong.json()) == (500, {"message": "Unable to process the request. Please try again."})


@pytest.mark.parametrize(("known", "query", "status"), [(False, "Hello", 404), (True, "", 400)])
def test_an_unknown_conversation_or_an_empty_message_fails_inside_a_201_stream(client, answered, known, query, status):
    conversation = answered[0]["conversation_id"] if known else "0" * 24

    events, _ = stream(client, conversation, query)

    error = events[-1]
    assert (error["event"], error["status"], error["content"]["status_code"]) == ("ERROR", "FAILED", status)


def test_a_bad_token_is_refused_with_401(client, pf):
    body = {"asset_version_id": pf.agent_version_id, "conversation_name": "ucp-test-refused"}
    reply = client.post("/create", json=body, headers={"authorization": "Bearer not-a-token"})

    assert reply.status_code == 401
    assert reply.json() == {"message": "Not Authorized.", "error": "Unauthorized", "statusCode": 401}


def test_hanging_up_loses_nothing_pf_finishes_the_answer_and_the_fetch_returns_it(client, pf):
    conversation = create(client, pf).json()["conversation_details"]["conversation_id"]
    events, _ = stream(client, conversation, READY, until="MESSAGE_DETAILS")
    message_id = events[-1]["message_id"]

    deadline, status = time.monotonic() + 90, None
    while time.monotonic() < deadline and status != "COMPLETED":
        time.sleep(2)
        status = client.get(f"/response/{conversation}/{message_id}").json()["message_content"][0]["status"]
    assert status == "COMPLETED"


@pytest.mark.anyio
async def test_our_connector_answers_and_after_a_restart_with_a_dead_token_pf_still_has_the_conversation(pf):
    logins = []

    async def count(request):
        if "/accesstoken/" in request.url.path:
            logins.append(1)

    async with httpx2.AsyncClient(timeout=httpx2.Timeout(30, read=120), event_hooks={"request": [count]}) as http:
        first = PfConnector(pf, http)
        await first.check()  # the control plane's "test connection"
        conversation = await first.create_conversation(f"ucp-test-{secrets.token_hex(4)}")
        one = [event async for event in first.send(conversation, READY)]

        restarted = PfConnector(pf, http)  # a new gateway instance, holding a token PF no longer accepts
        restarted._token, restarted._expires = "expired", time.monotonic() + 3600
        two = [event async for event in restarted.send(conversation, "And again, the same single word.")]

    for events in (one, two):
        assert isinstance(events[0], Accepted) and isinstance(events[-1], Final) and events[-1].text
        assert all(isinstance(event, Text) for event in events[1:-1])
    assert len(logins) == 2  # the check, whose token the first connector reuses, and one quiet login after the 401
    assert two[-1].usage["prompt_tokens"] > one[-1].usage["prompt_tokens"]  # PF kept the first turn in its context


# Files in a conversation (M10-T4; pf-capability-sheet.md section 4a)

MARKER = "MARIGOLD"  # a word only the document holds
WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PACKAGE = "http://schemas.openxmlformats.org/package/2006"
WORD_PARTS = {
    "[Content_Types].xml": f'<Types xmlns="{PACKAGE}/content-types"><Default Extension="rels" '
    'ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" '
    'ContentType="application/xml"/><Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": f'<Relationships xmlns="{PACKAGE}/relationships"><Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/></Relationships>',
}


def word_document(text: str) -> bytes:
    """A one-paragraph Word document, made by hand so the suite needs no library."""
    body = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    body += f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, part in {**WORD_PARTS, "word/document.xml": body}.items():
            archive.writestr(name, part)
    return buffer.getvalue()


def test_pf_reads_a_file_then_summarises_it_and_refuses_a_question_that_names_it_as_the_fake_does(client, pf):
    conversation = create(client, pf).json()["conversation_details"]["conversation_id"]
    document = ("ucp-test.docx", word_document(f"The test passphrase is {MARKER}."), WORD)

    upload = {"params": {"conversation_id": conversation}, "data": {"doc_source": "UPLOAD"}}
    uploaded = client.post("/fileupload", files={"files": document}, **upload)
    assert uploaded.status_code == 201
    first = uploaded.json()[0]
    assert (first["file_status"], first["file_name"]) == ("UPLOAD_SUCCESS", "ucp-test.docx")

    statuses, entry, deadline = [], {}, time.monotonic() + 90
    while time.monotonic() < deadline and not entry.get("summary"):
        time.sleep(2)
        details = client.get(f"/details/{conversation}").json()["file_details"]
        entry = next(item for item in details if item["file_id"] == first["file_id"])
        statuses.append(entry["file_status"])
    assert statuses[-1] == "FILE_PROCESS_SUCCESS" and entry["summary"]
    # The fields the connector and the fake PF rely on.
    assert {"file_id", "file_name", "file_ref_id", "file_status", "mode", "mime_type", "summary"} <= set(entry)

    named = {"conversation_id": conversation, "query": "Read it.", "ref_file_ids": [first["file_id"]]}
    refused = client.post("/addmessage/stream", json=named)
    assert refused.status_code == 400 and refused.json()["message"] == REF_REFUSED["message"]


@pytest.mark.anyio
async def test_a_file_reaches_the_agent_through_our_connector_once_pf_has_read_it(pf):
    files = [AgentFile("ucp-test.docx", WORD, word_document(f"The test passphrase is {MARKER} FORTY-TWO."))]
    async with httpx2.AsyncClient(timeout=httpx2.Timeout(30, read=180)) as http:
        connector = PfConnector(pf, http)
        conversation = await connector.create_conversation(f"ucp-test-{secrets.token_hex(4)}")
        question = "What is the test passphrase in the attached document? Reply with the passphrase alone."
        events = [event async for event in connector.send(conversation, question, files)]

    assert isinstance(events[0], Accepted) and isinstance(events[-1], Final)
    assert MARKER in events[-1].text.upper()
