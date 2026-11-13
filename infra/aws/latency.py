"""M4's latency budget on the deployed stack (decided in M7): with many visitors at once, the gateway adds at most
150 ms to the first word at the 95th percentile.

    cd backend && uv run python ../infra/aws/latency.py [--visitors 25] [--turns 3]      (environment awake)

Drives the load from this machine, a separate machine from the stack, through CloudFront to the gateway, which
answers from PF staging. PF's own time to a first word varies by seconds, so the gateway's share cannot be told from
outside; each answer's gateway logs it instead ("first word: the gateway added ..."), and this reads those lines
back from CloudWatch for the run. Costs visitors x turns answers from PF staging.
"""

import argparse
import asyncio
import json
import re
import secrets
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy import public_url  # noqa: E402

URL = public_url()
WIDGET = "w_load"
BUDGET_MS = 150
LINE = re.compile(r"first word: the gateway added (\d+) ms \((\d+) before asking the agent, (\d+) passing it on\)")


async def visitor(http: httpx2.AsyncClient, turns: int, waits: list[float]) -> None:
    session = await http.post("/v1/sessions", json={"widget_id": WIDGET, "host_token": None})
    session.raise_for_status()
    auth = {"authorization": f"Bearer {session.json()['token']}"}
    conversation = (await http.post("/v1/conversations", headers=auth)).json()["id"]
    for _ in range(turns):
        began = time.perf_counter()
        body = {"text": "Reply with the single word READY.", "client_message_id": f"load_{secrets.token_hex(6)}"}
        headers = {**auth, "accept": "text/event-stream"}
        async with http.stream("POST", f"/v1/conversations/{conversation}/messages", json=body, headers=headers) as r:
            r.raise_for_status()
            first = None
            async for line in r.aiter_lines():
                if first is None and '"content_block.delta"' in line:
                    first = time.perf_counter() - began
                if '"message.completed"' in line or '"message.failed"' in line:
                    break
        waits.append(first if first is not None else float("nan"))


def logged_since(started_ms: int) -> list[tuple[int, int, int]]:
    """The gateway's own shares, from its log lines written since the run began."""
    found, token = [], None
    while True:
        command = [
            "aws",
            "logs",
            "filter-log-events",
            "--log-group-name",
            "/ucp-dev/gateway",
            "--region",
            "us-east-1",
            "--start-time",
            str(started_ms),
            "--filter-pattern",
            '"first word"',
            "--output",
            "json",
        ]
        if token:
            command += ["--next-token", token]
        page = json.loads(subprocess.run(command, check=True, capture_output=True, text=True).stdout)
        found += [tuple(map(int, m.groups())) for e in page["events"] if (m := LINE.search(e["message"]))]
        token = page.get("nextToken")
        if not token:
            return found


async def main(visitors: int, turns: int) -> int:
    started_ms = int(time.time() * 1000)
    waits: list[float] = []
    limits = httpx2.Limits(max_connections=visitors * 2)
    async with httpx2.AsyncClient(base_url=URL, timeout=httpx2.Timeout(15, read=120), limits=limits) as http:
        results = await asyncio.gather(*(visitor(http, turns, waits) for _ in range(visitors)), return_exceptions=True)
    failures = [r for r in results if isinstance(r, BaseException)]
    answered = [w for w in waits if w == w]  # not NaN
    print(f"{visitors} visitors at once, {len(answered)} answers, {len(failures)} visitors failed")
    for failure in failures[:3]:
        print(f"  failure: {failure!r}")
    if answered:
        answered.sort()
        p95 = answered[max(0, int(len(answered) * 0.95) - 1)]
        print(
            f"first word as visitors saw it (PF's time included): median {statistics.median(answered):.1f} s, "
            f"95th percentile {p95:.1f} s"
        )

    await asyncio.sleep(20)  # CloudWatch takes a few seconds to make log lines searchable
    shares = logged_since(started_ms)
    if not shares:
        print("no 'first word' lines found in the gateway's log")
        return 1
    totals = sorted(total for total, _, _ in shares)
    p95 = totals[max(0, int(len(totals) * 0.95) - 1)]
    before = statistics.median(b for _, b, _ in shares)
    passing = statistics.median(p for _, _, p in shares)
    print(
        f"the gateway's own share, from {len(shares)} answers: median {statistics.median(totals):.0f} ms "
        f"(before asking PF {before:.0f}, passing it on {passing:.0f}), 95th percentile {p95} ms, worst {totals[-1]}"
    )
    ok = not failures and p95 <= BUDGET_MS
    print(f"{'within' if ok else 'OVER'} the budget of {BUDGET_MS} ms")
    return 0 if ok else 1


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--visitors", type=int, default=25)
    arguments.add_argument("--turns", type=int, default=3)
    args = arguments.parse_args()
    sys.exit(asyncio.run(main(args.visitors, args.turns)))
