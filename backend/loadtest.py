"""The load test (M4 performance): what the gateway adds to the time before the visitor sees the first word.

Many visitors ask questions at once. Each turn is timed twice, back to back: straight to the fake PF, and through
the gateway to the same fake PF. The difference is the gateway's own cost: the session check, storing the question,
the PF call it makes, converting each event and writing the stream. The budget (plan section 8, M0-T7) is 150 ms
at the 95th percentile.

    cd backend && FAKE_PF_SPEED=0.1 bash ../scripts/with-localdb.sh uv run --env-file ../.env python devstack.py
    cd backend && uv run python loadtest.py --visitors 50 --turns 5        (in a second shell)

Uses the widget w_load from e2e/widgets.json, whose limits leave room for the test.
"""

import argparse
import asyncio
import secrets
import statistics
import sys
import time

import httpx2

from devstack import FAKE_PF

GATEWAY, WIDGET, BUDGET_MS = "http://127.0.0.1:8200", "w_load", 150
PF_API = "/magicplatform/v1/genai/conversation"


async def first_line(http: httpx2.AsyncClient, url: str, marker: str, **request) -> float:
    """Seconds from sending the request to the first stream line holding `marker`. Reads to the end, as a visitor
    would."""
    began, waited = time.perf_counter(), None
    async with http.stream("POST", url, **request) as reply:
        reply.raise_for_status()
        async for line in reply.aiter_lines():
            if waited is None and marker in line:
                waited = time.perf_counter() - began
    if waited is None:
        raise RuntimeError(f"no line holding {marker!r} from {url}")
    return waited


async def visitor(http: httpx2.AsyncClient, pf_token: str, turns: int, added: list[float]) -> None:
    reply = await http.post(f"{GATEWAY}/v1/sessions", json={"widget_id": WIDGET, "host_token": None})
    ours = {"authorization": f"Bearer {reply.raise_for_status().json()['token']}"}
    conversation = (await http.post(f"{GATEWAY}/v1/conversations", headers=ours)).raise_for_status().json()["id"]
    theirs = {"apikey": FAKE_PF["api_key"], "x-platform-workspaceid": "w", "authorization": f"Bearer {pf_token}"}
    created = await http.post(f"{FAKE_PF['base_url']}{PF_API}/create", json={"asset_version_id": "a"}, headers=theirs)
    pf_conversation = created.json()["conversation_details"]["conversation_id"]
    for turn in range(turns):
        question = f"Question {turn}"
        direct = await first_line(
            http,
            f"{FAKE_PF['base_url']}{PF_API}/addmessage/stream",
            '"status": "IN_PROGRESS"',  # PF's first word
            json={"conversation_id": pf_conversation, "query": question},
            headers=theirs,
        )
        through = await first_line(
            http,
            f"{GATEWAY}/v1/conversations/{conversation}/messages",
            '"type":"content_block.delta"',  # the same first word, as the gateway sends it
            json={"text": question, "client_message_id": f"k_{secrets.token_hex(4)}"},
            headers=ours,
        )
        added.append((through - direct) * 1000)


async def measure(visitors: int, turns: int) -> tuple[float, int]:
    """One run: every visitor at once. Returns the 95th percentile added, and how many visitors failed."""
    async with httpx2.AsyncClient(
        timeout=httpx2.Timeout(10, read=120), limits=httpx2.Limits(max_connections=1000)
    ) as http:
        login = await http.get(
            f"{FAKE_PF['base_url']}/accesstoken/{FAKE_PF['tenant']}",
            headers={"apikey": FAKE_PF["api_key"], "username": FAKE_PF["username"], "password": FAKE_PF["password"]},
        )
        pf_token = login.json()["access_token"]
        added: list[float] = []
        began = time.perf_counter()
        results = await asyncio.gather(
            *(visitor(http, pf_token, turns, added) for _ in range(visitors)), return_exceptions=True
        )
        took = time.perf_counter() - began
    failures = [result for result in results if isinstance(result, BaseException)]
    if not added:
        print(f"every visitor failed, for example: {failures[0]!r}")
        return float("inf"), len(failures)
    added.sort()
    p50, p95 = statistics.median(added), added[max(0, int(len(added) * 0.95) - 1)]
    print(f"{visitors} visitors, {len(added)} turns in {took:.1f} s, {len(failures)} visitors failed")
    print(f"added to the first word: median {p50:.0f} ms, 95th percentile {p95:.0f} ms, worst {added[-1]:.0f} ms")
    for failure in failures[:3]:
        print(f"  failure: {failure!r}")
    return p95, len(failures)


async def main(visitors: int, turns: int, runs: int) -> int:
    """Judges the median of the runs' 95th percentiles: one stalled run on a shared machine neither fails the
    budget nor, as a retry would, lets a real slowdown pass on a lucky second try."""
    measured = [await measure(visitors, turns) for _ in range(runs)]
    p95 = statistics.median(p95 for p95, _ in measured)
    ok = not any(failed for _, failed in measured) and p95 <= BUDGET_MS
    verdict = "within" if ok else "OVER"
    print(f"median of {runs} runs' 95th percentiles: {p95:.0f} ms, {verdict} the budget of {BUDGET_MS} ms")
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--visitors", type=int, default=50)
    parser.add_argument("--turns", type=int, default=5)
    parser.add_argument("--runs", type=int, default=3)
    arguments = parser.parse_args()
    sys.exit(asyncio.run(main(arguments.visitors, arguments.turns, arguments.runs)))
