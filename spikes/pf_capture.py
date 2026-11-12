"""PF discovery capture (plan task M0-T1): records how the Purple Fabric conversation API behaves.

Reads connection settings from ../.env. Never prints or stores credentials or tokens.

Usage:
    PF_WORKSPACE_ID=... PF_AGENT_ID=... python pf_capture.py "first question" "follow-up"
    PF_WORKSPACE_ID=... PF_AGENT_ID=... python pf_capture.py --probes
"""
import base64
import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "pf_capture_out"
SECRET_KEYS = ("token", "password", "apikey", "api_key", "authorization", "cookie", "secret")
SETTINGS = ("PF_BASE_URL", "PF_TENANT", "PF_API_KEY", "PF_USERNAME", "PF_PASSWORD", "PF_WORKSPACE_ID", "PF_AGENT_ID")
HIDE = {}  # secret value -> placeholder, applied to everything printed or saved
RUN = time.strftime("%Y%m%d-%H%M%S")
API = "/magicplatform/v1/genai/conversation"


def load_env(path):
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def redact(obj):
    """Replace secret-looking values so a capture is safe to keep and to print."""
    if isinstance(obj, dict):
        return {
            k: f"<redacted {len(str(v))} chars>" if any(s in k.lower() for s in SECRET_KEYS) else redact(v)
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


assert redact({"access_token": "abc", "a": [{"Password": "x"}], "expires_in": 1}) == {
    "access_token": "<redacted 3 chars>",
    "a": [{"Password": "<redacted 1 chars>"}],
    "expires_in": 1,
}


def mask(text):
    for secret, placeholder in HIDE.items():
        text = text.replace(secret, placeholder)
    return text


def show(title, value):
    body = value if isinstance(value, str) else json.dumps(value, indent=2, default=str)
    print(f"\n=== {title}\n{mask(body)}")


def describe(response, elapsed_ms, body=None):
    if body is None:
        try:
            body = redact(response.json())
        except ValueError:
            body = response.text[:4000]
    return {
        "status": response.status_code,
        "elapsed_ms": elapsed_ms,
        "headers": {k: v if len(v) <= 200 else v[:200] + "..." for k, v in redact(dict(response.headers)).items()},
        "body": body,
    }


def brief(response):
    """Status, content type and the start of the body: enough to learn an error or record shape."""
    return {
        "status": response.status_code,
        "content_type": response.headers.get("content-type"),
        "body": mask(response.text[:1500]),
    }


def jwt_shape(token):
    """Claim names and lifetime only; the token itself is never shown."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return {"claims": sorted(claims), "lifetime_s": claims.get("exp", 0) - claims.get("iat", 0)}
    except Exception as exc:  # not a JWT, or an unexpected layout
        return {"not_a_jwt": type(exc).__name__}


def parse_events(text):
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            try:
                events.append(json.loads(line[5:].strip()))
            except ValueError:
                events.append({"unparsed": line[:200]})
    return events


assert parse_events('data: {"event": "X", "content": "a"}\n\ndata: oops\n') == [
    {"event": "X", "content": "a"},
    {"unparsed": "data: oops"},
]


def timed(call):
    start = time.perf_counter()
    response = call()
    return response, round((time.perf_counter() - start) * 1000)


def setup():
    load_env(ROOT.parent / ".env")
    missing = [name for name in SETTINGS if not os.environ.get(name)]
    if missing:
        sys.exit(f"missing settings: {', '.join(missing)}")
    cfg = {name: os.environ[name] for name in SETTINGS}
    cfg["PF_BASE_URL"] = cfg["PF_BASE_URL"].rstrip("/")
    HIDE.update({
        cfg["PF_BASE_URL"]: "<PF_BASE_URL>",
        httpx.URL(cfg["PF_BASE_URL"]).host: "<PF_HOST>",
        cfg["PF_API_KEY"]: "<PF_API_KEY>",
        cfg["PF_USERNAME"]: "<PF_USERNAME>",
        cfg["PF_PASSWORD"]: "<PF_PASSWORD>",
        cfg["PF_TENANT"]: "<PF_TENANT>",
    })
    OUT.mkdir(exist_ok=True)
    return cfg


def common(cfg):
    return {"apikey": cfg["PF_API_KEY"], "X-Platform-Workspaceid": cfg["PF_WORKSPACE_ID"]}


def auth(cfg, token):
    return {**common(cfg), "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def login(client, cfg):
    response, ms = timed(lambda: client.get(
        f"{cfg['PF_BASE_URL']}/accesstoken/{cfg['PF_TENANT']}",
        headers={**common(cfg), "username": cfg["PF_USERNAME"], "password": cfg["PF_PASSWORD"],
                 "Accept": "application/json"},
    ))
    step = describe(response, ms)
    body = response.json()
    if body.get("result") != "RESULT_SUCCESS":  # PF answers HTTP 200 even when the login fails
        show("login failed", step)
        sys.exit(1)
    for key in ("access_token", "refresh_token"):
        HIDE[body[key]] = f"<PF_{key.upper()}>"
    step["jwt"] = jwt_shape(body["access_token"])
    return body["access_token"], step


def create(client, cfg, token, name):
    response, ms = timed(lambda: client.post(
        f"{cfg['PF_BASE_URL']}{API}/create",
        headers=auth(cfg, token),
        json={"asset_version_id": cfg["PF_AGENT_ID"], "conversation_name": name},
    ))
    response.raise_for_status()
    return response.json()["conversation_details"]["conversation_id"], describe(response, ms)


def send(client, cfg, token, conversation_id, query, label, hang_up_at_first_token=False):
    """Send one message and record the raw stream with arrival times."""
    start = time.perf_counter()
    arrivals, raw = [], bytearray()
    with client.stream(
        "POST",
        f"{cfg['PF_BASE_URL']}{API}/addmessage/stream",
        headers=auth(cfg, token),
        json={"conversation_id": conversation_id, "query": query},
    ) as response:
        for chunk in response.iter_bytes():
            arrivals.append([round((time.perf_counter() - start) * 1000), len(chunk)])
            raw += chunk
            if hang_up_at_first_token and b'"IN_PROGRESS"' in raw and b"LLM_RESPONSE_STREAM" in raw:
                break  # leaving the block closes the connection, as a browser tab closing would
    text = mask(raw.decode("utf-8", errors="replace"))
    (OUT / f"{RUN}_{label}.txt").write_text(text, encoding="utf-8")
    step = describe(response, round((time.perf_counter() - start) * 1000), body=f"see {RUN}_{label}.txt")
    events = parse_events(text)
    details = next((e for e in events if e.get("event") == "MESSAGE_DETAILS"), {})
    final = next((e for e in events if e.get("event") == "FINAL_RESPONSE"), {})
    step.update({
        "query": query,
        "bytes": len(raw),
        "chunks": len(arrivals),
        "first_chunk_ms": arrivals[0][0] if arrivals else None,
        "arrivals_ms_and_size": arrivals,
        "event_sequence": [f"{e.get('event', '(none)')}:{e.get('status', '')}" for e in events
                           if e.get("event") != "LLM_RESPONSE_STREAM" or e.get("status") != "IN_PROGRESS"],
        "token_events": sum(1 for e in events if e.get("event") == "LLM_RESPONSE_STREAM"),
        "message_id": details.get("message_id"),
        "message_content_id": details.get("message_content_id"),
        "final": final.get("content") if isinstance(final.get("content"), dict) else None,
    })
    return step, text


def capture(cfg, queries):
    record = {"run": RUN, "steps": {}}
    with httpx.Client(timeout=httpx.Timeout(180, connect=20)) as client:
        token, record["steps"]["token"] = login(client, cfg)
        show("token", record["steps"]["token"])
        conversation_id, record["steps"]["create"] = create(client, cfg, token, f"ucp-capture-{RUN}")
        show("create conversation", record["steps"]["create"])
        for index, query in enumerate(queries, 1):
            step, text = send(client, cfg, token, conversation_id, query, f"stream_{index}")
            record["steps"][f"stream_{index}"] = step
            show(f"stream {index}", {k: v for k, v in step.items() if k != "arrivals_ms_and_size"})
            show(f"stream {index} arrivals (first 15 of {len(step['arrivals_ms_and_size'])})",
                 step["arrivals_ms_and_size"][:15])
            show(f"stream {index} start of body", text[:2500])
            if len(text) > 2500:
                show(f"stream {index} end of body", text[-1500:])
    return record


def probes(cfg):
    """Questions a plain capture does not answer: recovery, hang-ups, concurrent logins, errors."""
    base, found = cfg["PF_BASE_URL"], {"run": RUN}

    def final_url(conversation_id, message_id):
        return f"{base}{API}/response/{conversation_id}/{message_id}"

    def trim(step):
        keep = ("status", "elapsed_ms", "chunks", "first_chunk_ms", "event_sequence", "token_events",
                "message_id", "message_content_id", "final")
        return {k: step[k] for k in keep}

    with httpx.Client(timeout=httpx.Timeout(180, connect=20)) as client:
        token, _ = login(client, cfg)
        conversation_id, _ = create(client, cfg, token, f"ucp-probe-{RUN}")

        # 1. Does a fenced diagram block survive PF unchanged?
        step, _ = send(client, cfg, token, conversation_id,
                       "Draw a three-node flowchart as a mermaid diagram in a fenced code block, then add one sentence.",
                       "probe_fence")
        found["fenced_block"] = trim(step)

        # 2. Which ID does the finished-answer call want?
        for name in ("message_id", "message_content_id"):
            found[f"final_by_{name}"] = brief(client.get(final_url(conversation_id, step[name]), headers=auth(cfg, token)))
        good_id = step["message_content_id"] if found["final_by_message_content_id"]["status"] < 300 else step["message_id"]

        # 3. Does a second login cancel the first token? (Decides whether gateway instances can log in separately.)
        login(client, cfg)
        found["first_token_after_second_login"] = brief(
            client.get(final_url(conversation_id, good_id), headers=auth(cfg, token)))["status"]

        # 4. Caller hangs up at the first word. Does PF finish the answer anyway?
        step, _ = send(client, cfg, token, conversation_id,
                       "Write about 300 words on why public libraries matter.", "probe_hangup",
                       hang_up_at_first_token=True)
        found["hangup_sent"] = trim(step)
        time.sleep(25)
        for name in ("message_id", "message_content_id"):
            found[f"hangup_final_by_{name}"] = brief(client.get(final_url(conversation_id, step[name]), headers=auth(cfg, token)))

        # 5. Is the conversation still usable after the hang-up?
        step, _ = send(client, cfg, token, conversation_id, "Reply with the single word OK.", "probe_after_hangup")
        found["after_hangup"] = trim(step)

        # 6. Error shapes.
        stream_url = f"{base}{API}/addmessage/stream"
        found["error_unknown_conversation"] = brief(client.post(
            stream_url, headers=auth(cfg, token), json={"conversation_id": "000000000000000000000000", "query": "hi"}))
        found["error_empty_query"] = brief(client.post(
            stream_url, headers=auth(cfg, token), json={"conversation_id": conversation_id, "query": ""}))
        found["error_bad_token"] = brief(client.get(
            final_url(conversation_id, good_id), headers=auth(cfg, "not-a-real-token")))

        # 7. Is there a non-streaming variant for the JSON fallback?
        found["non_stream_addmessage"] = brief(client.post(
            f"{base}{API}/addmessage", headers=auth(cfg, token),
            json={"conversation_id": conversation_id, "query": "Reply with the single word OK."}))

    show("probes", found)
    return found


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    settings = setup()
    if sys.argv[1:] == ["--probes"]:
        result, name = probes(settings), "probes"
    else:
        result = capture(settings, sys.argv[1:] or ["Hello. In one short sentence, what can you help me with?"])
        name = "capture"
    (OUT / f"{RUN}_{name}.json").write_text(mask(json.dumps(result, indent=2, default=str)), encoding="utf-8")
    print(f"\nsaved to {OUT}")
