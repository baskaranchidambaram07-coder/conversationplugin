"""The whole stack on this machine, in one command, for development and the gateway journeys (e2e/gateway):
the gateway on http://localhost:8200 serving the built loader and chat and answering from the fake PF on port
8100, with the widgets in e2e/widgets.json published to the database; and the admin API on port 8201, whose
administrators sign in through a stand-in identity provider on port 8300 (onboarding-operator is a platform
administrator from the start).

    npm run build
    cd backend && bash ../scripts/with-localdb.sh uv run --env-file ../.env python devstack.py [--pf staging]

With `--pf staging` the widgets answer from PF staging instead, with the PF_* settings in .env; each question then
costs a real answer and leaves a conversation in the staging workspace.

Uses UCP_DATABASE_URL, or else TEST_DATABASE_URL. FAKE_PF_SPEED scales the fake PF's recorded timing
(1 is real time). Never point it at a database whose data matters: it migrates and publishes into it.
"""

import argparse
import asyncio
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from dataclasses import replace
from pathlib import Path

import httpx2
import uvicorn
from sqlalchemy.ext.asyncio import create_async_engine

from tests.fakeidp import FakeProvider
from ucp import migrate
from ucp.admin.app import create_app as admin_api
from ucp.admin.records import Records
from ucp.gateway.app import create_app
from ucp.gateway.pipeline import Problem
from ucp.settings import Settings
from ucp.store import Store
from ucp.vault import new_key
from ucp.widgets import seed

ROOT = Path(__file__).resolve().parents[1]
ISSUER, CONSOLE, OPERATOR = "http://127.0.0.1:8300", "ucp-console", "onboarding-operator"
FAKE_PF = {
    "base_url": "http://127.0.0.1:8100",
    "tenant": "fake-tenant",
    "workspace_id": "fake-workspace",
    "agent_version_id": "fake-agent-version",
    "api_key": "fake-api-key",
    "username": "fake-user",
    "password": "fake-password",
}


def staging_profile() -> dict:
    """PF staging as a connection profile, from the PF_* settings that .env holds (never printed)."""
    env = os.environ
    return {
        "base_url": env["PF_BASE_URL"].rstrip("/"),
        "tenant": env["PF_TENANT"],
        "workspace_id": env["PF_WORKSPACE_ID"],
        "agent_version_id": env["PF_AGENT_ID"],
        "api_key": env["PF_API_KEY"],
        "username": env["PF_USERNAME"],
        "password": env["PF_PASSWORD"],
    }


def _widgets_file() -> dict:
    return json.loads((ROOT / "e2e" / "widgets.json").read_text(encoding="utf-8"))


async def _publish(url: str) -> None:
    engine = create_async_engine(url)
    try:
        await seed(Store(engine), _widgets_file()["widgets"])
    finally:
        await engine.dispose()


def _start_fake_pf() -> subprocess.Popen:
    # The fake PF runs in a process of its own, as PF does, so the two never compete for one interpreter.
    pf = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "fakepf.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8100",
            "--log-level",
            "warning",
        ]
    )
    for _ in range(100):  # the gateway reports ready only once the fake PF answers too
        try:
            httpx2.get(f"{FAKE_PF['base_url']}/accesstoken/{FAKE_PF['tenant']}", timeout=1)
            break
        except httpx2.HTTPError:
            time.sleep(0.2)
    return pf


def _in_background(app, port: int) -> None:
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)


def _start_control_plane(url: str, settings: Settings) -> None:
    """The admin API on port 8201, and a stand-in company identity provider for its administrators on port 8300,
    which hands a token to anyone who asks at /token?sub=NAME: this stack is for this machine only. OPERATOR is a
    platform administrator from the start."""
    provider = FakeProvider()
    provider.base_url = ISSUER
    issuer = provider.app()

    @issuer.get("/token")
    async def token(sub: str) -> dict[str, str]:
        return {"token": provider.token(audience=CONSOLE, sub=sub)}

    _in_background(issuer, 8300)

    async def first_administrator() -> None:
        engine = create_async_engine(url)
        try:
            await Records(engine).add_administrator(ISSUER, OPERATOR, "platform", None, "operator", "devstack")
        except Problem:
            pass  # already one, from an earlier run
        finally:
            await engine.dispose()

    asyncio.run(first_administrator())
    admin = replace(settings, web_dir=None, admin_issuer=ISSUER, admin_audience=CONSOLE)
    _in_background(admin_api(admin), 8201)


def main() -> None:
    parser = argparse.ArgumentParser(description="The whole stack on this machine.")
    parser.add_argument("--pf", choices=["fake", "staging"], default="fake", help="where answers come from")
    staging = parser.parse_args().pf == "staging"
    url = os.environ.get("UCP_DATABASE_URL") or os.environ["TEST_DATABASE_URL"]
    migrate.upgrade(url)
    asyncio.run(_publish(url))
    pf = None if staging else _start_fake_pf()
    settings = Settings(
        database_url=url,
        web_dir=ROOT / "web",
        session_keys=f"dev:{secrets.token_urlsafe(32)}",
        agent_profiles=json.dumps({"fake-pf": staging_profile() if staging else FAKE_PF}),  # the widgets' name
        host_secrets=json.dumps(_widgets_file()["test_host_secrets"]),
        signed_in_seconds=int(os.environ.get("UCP_SIGNED_IN_SECONDS", "900")),
        secrets_key=new_key(),  # the admin API seals tenants' secrets with it, the gateway opens them
    )
    _start_control_plane(url, settings)
    try:
        uvicorn.run(create_app(settings), host="127.0.0.1", port=8200, log_level="warning")
    finally:
        if pf:
            pf.terminate()


if __name__ == "__main__":
    main()
