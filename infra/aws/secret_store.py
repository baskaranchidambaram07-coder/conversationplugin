"""Puts an environment's secrets that Terraform does not generate into Secrets Manager (dev unless UCP_ENV names
another), never printing a value it was given and never writing one to disk.

    cd backend && uv run --env-file ../.env python ../infra/aws/secret_store.py agent-profiles
        the PF staging connection profile, from the PF_* settings in .env, as the profile "pf-staging"
    cd backend && uv run python ../infra/aws/secret_store.py session-keys
        a new key that signs visitors' sessions from the next release; the current one still verifies until the
        rotation after, so no session in progress breaks
    cd backend && uv run python ../infra/aws/secret_store.py host-secret NAME [--rotate]
        a new shared secret for a signed-in site, printed once to hand to the customer; with --rotate the current
        one stays valid beside it until the next rotation, so the customer can switch without a gap

The gateway reads its secrets when it starts: after a change, release again (python infra/aws/deploy.py).
"""

import argparse
import json
import secrets
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from deploy import NAME, REGION  # noqa: E402


def put(name: str, value: str) -> None:
    # The value goes to the AWS command line as an argument: visible only to this machine's own processes.
    subprocess.run(
        [
            "aws",
            "secretsmanager",
            "put-secret-value",
            "--secret-id",
            name,
            "--secret-string",
            value,
            "--region",
            REGION,
        ],
        check=True,
        capture_output=True,
    )


def current(name: str) -> str:
    return subprocess.run(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            name,
            "--query",
            "SecretString",
            "--output",
            "text",
            "--region",
            REGION,
        ],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def agent_profiles() -> None:
    from devstack import staging_profile  # the same mapping from .env that the local stack and staging tests use

    put(f"{NAME}/agent-profiles", json.dumps({"pf-staging": staging_profile()}))
    print(f"{NAME}/agent-profiles: set (pf-staging)")


def session_keys() -> None:
    previous = current(f"{NAME}/session-keys").split(",")[0]
    put(f"{NAME}/session-keys", f"k{datetime.now(UTC):%Y%m%d%H%M}:{secrets.token_urlsafe(32)},{previous}")
    print(f"{NAME}/session-keys: a new signing key, with the previous one kept for sessions already issued")


def host_secret(name: str, rotate: bool) -> None:
    keys = json.loads(current(f"{NAME}/host-secrets"))
    fresh = f"k{datetime.now(UTC):%Y%m%d%H%M}:{secrets.token_urlsafe(32)}"
    keys[name] = f"{fresh},{keys[name].split(',')[0]}" if rotate and name in keys else fresh
    put(f"{NAME}/host-secrets", json.dumps(keys))
    print(f"{name}: new secret, to hand to the customer once and not to keep anywhere else:\n{fresh}")


if __name__ == "__main__":
    commands = argparse.ArgumentParser(description="An environment's secrets.")
    each = commands.add_subparsers(dest="command", required=True)
    each.add_parser("agent-profiles")
    each.add_parser("session-keys")
    host = each.add_parser("host-secret")
    host.add_argument("name")
    host.add_argument("--rotate", action="store_true")
    args = commands.parse_args()
    if args.command == "agent-profiles":
        agent_profiles()
    elif args.command == "session-keys":
        session_keys()
    else:
        host_secret(args.name, args.rotate)
