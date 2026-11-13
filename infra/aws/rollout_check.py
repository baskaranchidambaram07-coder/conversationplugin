"""A release while answers are streaming (M14 deployment test): no visitor's answer is cut off.

    cd backend && uv run python ../infra/aws/rollout_check.py        (environment awake)

Forces a fresh rollout of the running release. Throughout it (the new task starting, the old one draining, then
stopping) a visitor asks a long question every 8 seconds, and every answer must stream to its end. Costs one PF
staging answer for each question asked, about 30 over the rollout.
"""

import asyncio
import json
import secrets
import subprocess
import sys
from pathlib import Path

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy import public_url  # noqa: E402

URL = public_url()
WIDGET = "w_load"
QUESTION = "Explain in about 300 words how a web browser checks a website's HTTPS certificate."


def aws(*args: str) -> dict:
    command = ["aws", *args, "--region", "us-east-1", "--output", "json"]
    return json.loads(subprocess.run(command, check=True, capture_output=True, text=True).stdout or "{}")


async def ask(http: httpx2.AsyncClient, auth: dict, conversation: str) -> str:
    body = {"text": QUESTION, "client_message_id": f"roll_{secrets.token_hex(6)}"}
    headers = {**auth, "accept": "text/event-stream"}
    try:
        async with http.stream("POST", f"/v1/conversations/{conversation}/messages", json=body, headers=headers) as r:
            if r.status_code != 200:
                return f"refused {r.status_code}"
            async for line in r.aiter_lines():
                if '"message.completed"' in line:
                    return "completed"
                if '"message.failed"' in line:
                    return "failed"
        return "cut off"
    except httpx2.HTTPError as error:
        return f"cut off ({type(error).__name__})"


async def main() -> int:
    rollout = await asyncio.to_thread(
        aws,
        "ecs",
        "update-service",
        "--cluster",
        "ucp-dev-cluster",
        "--service",
        "ucp-dev-gateway",
        "--force-new-deployment",
    )
    print(f"rollout started ({len(rollout['service']['deployments'])} deployments)", flush=True)
    stable = asyncio.create_task(
        asyncio.to_thread(
            subprocess.run,
            [
                "aws",
                "ecs",
                "wait",
                "services-stable",
                "--cluster",
                "ucp-dev-cluster",
                "--services",
                "ucp-dev-gateway",
                "--region",
                "us-east-1",
            ],
            check=True,
        )
    )
    outcomes: list[asyncio.Task] = []
    async with httpx2.AsyncClient(base_url=URL, timeout=httpx2.Timeout(15, read=150)) as http:
        session = (await http.post("/v1/sessions", json={"widget_id": WIDGET, "host_token": None})).json()
        auth = {"authorization": f"Bearer {session['token']}"}
        while not stable.done():
            # One conversation per question: each is its own turn, so they may overlap.
            conversation = (await http.post("/v1/conversations", headers=auth)).json()["id"]
            outcomes.append(asyncio.create_task(ask(http, auth, conversation)))
            await asyncio.sleep(8)
        await stable
        results = await asyncio.gather(*outcomes)
    counts = {outcome: results.count(outcome) for outcome in sorted(set(results))}
    print(f"rollout finished; {len(results)} answers asked during it: {counts}")
    return 0 if results and set(results) == {"completed"} else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
