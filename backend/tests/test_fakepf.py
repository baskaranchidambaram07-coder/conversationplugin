import json
import re
import time

import pytest
from fastapi.testclient import TestClient

from fakepf.app import AGENT_VERSION_ID, API, API_KEY, PASSWORD, RECORDINGS, TENANT, USERNAME, WORKSPACE_ID, create_app


def login(client, password=PASSWORD):
    return client.get(f"/accesstoken/{TENANT}", headers={"apikey": API_KEY, "username": USERNAME, "password": password})


def headers(token):
    return {"apikey": API_KEY, "X-Platform-Workspaceid": WORKSPACE_ID, "Authorization": f"Bearer {token}"}


def create(client, token):
    body = {"asset_version_id": AGENT_VERSION_ID, "conversation_name": "ucp-test"}
    return client.post(f"{API}/create", headers=headers(token), json=body)


def chat(query, path="addmessage/stream"):
    """A behaviour: log in, create a conversation, send one message. Returns every response."""

    def run(client):
        logged_in = login(client)
        token = logged_in.json()["access_token"]
        created = create(client, token)
        body = {"conversation_id": created.json()["conversation_details"]["conversation_id"], "query": query}
        return [logged_in, created, client.post(f"{API}/{path}", headers=headers(token), json=body)]

    return run


def failed_login(client):
    return [login(client, password="wrong")]


def expired_token(client):
    logged_in = login(client)
    client.post("/_fake/expire-tokens")
    return [logged_in, create(client, logged_in.json()["access_token"])]


BEHAVIOURS = {
    "short reply": chat("Hello"),
    "long streamed reply": chat("[long] How does HTTPS work?"),
    "slow reply": chat("[slow] Hello"),
    "error inside the stream": chat("[error] Hello"),
    "failed login": failed_login,
    "expired token": expired_token,
}


def events(response):
    return [json.loads(block.removeprefix("data: ")) for block in response.text.split("\n\n") if block]


def outline(stream):
    """Event names and statuses, without the many word events in between."""
    return [
        f"{event.get('event', 'notice')}:{event.get('status', '')}"
        for event in stream
        if event.get("status") != "IN_PROGRESS" or event.get("event") != "LLM_RESPONSE_STREAM"
    ]


def words(stream):
    return [event["content"] for event in stream if event.get("event") == "LLM_RESPONSE_STREAM" and event["content"]]


@pytest.mark.parametrize("name", BEHAVIOURS)
def test_each_behaviour_repeats_byte_for_byte(name):
    def transcript():
        responses = BEHAVIOURS[name](TestClient(create_app(time_scale=0)))
        return [(r.status_code, r.headers.get("x-platform-request-id"), r.content) for r in responses]

    assert transcript() == transcript()


def test_short_reply_arrives_in_pf_order_with_live_ids_and_query():
    client = TestClient(create_app(time_scale=0))
    *_, sent = chat('Hello "there" café')(client)
    stream = events(sent)

    assert sent.status_code == 201 and sent.headers["content-type"] == "text/event-stream"
    assert outline(stream) == [
        "notice:",
        "notice:",
        "MESSAGE_DETAILS:SUCCESS",
        "LLM_RESPONSE_STREAM:START",
        "LLM_RESPONSE_STREAM:END",
        "FINAL_RESPONSE:SUCCESS",
        "STREAM_END:SUCCESS",
    ]
    details = stream[2]
    assert details["content"]["message_content"][0]["query"] == 'Hello "there" café'
    assert details["asset_version_id"] == AGENT_VERSION_ID
    assert {event["conversation_id"] for event in stream[2:]} == {details["conversation_id"]}
    assert stream[-2]["content"]["response"] == "READY"
    assert "00000000000000000000a00" not in sent.text  # no recording stand-in survives


def test_long_reply_streams_words_that_add_up_to_the_final_answer():
    stream = events(chat("[long] How does HTTPS work?")(TestClient(create_app(time_scale=0)))[-1])
    answer = stream[-2]["content"]["response"]

    assert len(words(stream)) == 205
    assert "".join(words(stream)) == answer
    assert "\n|" in answer and "```" in answer and answer.startswith("# ")


def test_slow_reply_is_silent_for_over_a_minute_before_the_first_word():
    client = TestClient(create_app(time_scale=0.001))  # 65 s becomes 65 ms
    started = time.monotonic()
    stream = events(chat("[slow] Hello")(client)[-1])

    assert time.monotonic() - started >= 0.065
    assert stream[-2]["content"]["response"] == "READY"


def test_error_arrives_inside_a_201_stream_after_some_words():
    sent = chat("[error] Hello")(TestClient(create_app(time_scale=0)))[-1]
    stream = events(sent)

    assert sent.status_code == 201
    assert len(words(stream)) == 3
    assert stream[-1] == {
        "event": "ERROR",
        "status": "FAILED",
        "content": {
            "response": "Unable to process the request. Please try again.",
            "error_description": "Unable to process the request. Please try again.",
            "status_code": 500,
        },
    }


def test_login_succeeds_with_text_durations_and_fails_with_http_200():
    client = TestClient(create_app(time_scale=0))
    good, bad = login(client).json(), login(client, password="wrong")

    assert good["result"] == "RESULT_SUCCESS" and good["expires_in"] == "28800"
    assert bad.status_code == 200 and bad.json()["result"] == "RESULT_FAILURE" and bad.json()["active"] is False


def test_expired_token_gets_401_until_the_next_login():
    client = TestClient(create_app(time_scale=0))
    refused = expired_token(client)[-1]

    assert refused.status_code == 401
    assert refused.json() == {"message": "Not Authorized.", "error": "Unauthorized", "statusCode": 401}
    assert create(client, login(client).json()["access_token"]).status_code == 201


@pytest.mark.parametrize(
    ("conversation_known", "query", "reason", "code"),
    [(False, "hi", "Conversation not found", 404), (True, "", "Invalid Input. Query cannot be empty", 400)],
)
def test_bad_send_gets_pf_recorded_error_events(conversation_known, query, reason, code):
    client = TestClient(create_app(time_scale=0))
    token = login(client).json()["access_token"]
    conversation_id = create(client, token).json()["conversation_details"]["conversation_id"]
    body = {"conversation_id": conversation_id if conversation_known else "000000000000000000000000", "query": query}
    sent = client.post(f"{API}/addmessage/stream", headers=headers(token), json=body)

    assert sent.status_code == 201
    assert sent.text == (
        'data: {"content":"Stream connection established successfully"}\n\n'
        'data: {"content":"Agent Execution InProgress"}\n\n'
        f'data: {{"event":"ERROR","status":"FAILED","content":{{"response":"{reason}",'
        f'"error_description":"{reason}","status_code":{code}}}}}\n\n'
    )


def test_fetch_wants_the_message_id_and_rejects_the_content_id():
    client = TestClient(create_app(time_scale=0))
    token = login(client).json()["access_token"]
    details = events(chat("Hello")(client)[-1])[2]
    url = f"{API}/response/{details['conversation_id']}"

    found = client.get(f"{url}/{details['message_id']}", headers=headers(token))
    wrong = client.get(f"{url}/{details['message_content_id']}", headers=headers(token))

    assert found.json()["message_content"][0]["status"] == "COMPLETED"
    assert found.json()["message_content"][0]["response"] == "READY"
    assert wrong.status_code == 500 and wrong.json() == {"message": "Unable to process the request. Please try again."}


@pytest.mark.parametrize(("time_scale", "status"), [(1.0, "IN_PROGRESS"), (0.0, "COMPLETED")])
def test_plain_send_returns_at_once_and_the_answer_completes_on_the_recorded_schedule(time_scale, status):
    client = TestClient(create_app(time_scale=time_scale))
    token = login(client).json()["access_token"]
    accepted = chat("[long] How does HTTPS work?", path="addmessage")(client)[-1]
    record = accepted.json()

    assert accepted.status_code == 201 and record["message_content"][0]["status"] == "IN_PROGRESS"
    fetched = client.get(f"{API}/response/{record['conversation_id']}/{record['message_id']}", headers=headers(token))
    assert fetched.json()["message_content"][0]["status"] == status


def test_recordings_hold_no_real_identifiers():
    pf_ids = re.compile(r"\b[0-9a-f]{24}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
    for path in RECORDINGS.iterdir():
        found = pf_ids.findall(path.read_text(encoding="utf-8"))
        assert found and all(value.startswith("00000000") for value in found), path.name
