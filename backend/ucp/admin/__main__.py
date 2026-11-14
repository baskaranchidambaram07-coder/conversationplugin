"""The control plane's one command (M8-T10): the first administrator, before anyone can sign in to make another.

    cd backend && uv run python -m ucp.admin first-administrator SUBJECT [--label NAME] [--by WHO]

SUBJECT is the user's ID at the company identity provider (UCP_ADMIN_ISSUER): the claim the admin API reads,
`sub` unless UCP_ADMIN_USER_CLAIM names another. They become a platform administrator, who then creates tenants
and their administrators through the API. Recorded in the audit log, as every change is. Importing and exporting
widget configuration as JSON is `python -m ucp.widgets seed` and `export`.
"""

import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy.ext.asyncio import create_async_engine

from ucp.admin.records import Records
from ucp.gateway.pipeline import Problem


async def main(argv: list[str]) -> str:
    commands = argparse.ArgumentParser(prog="python -m ucp.admin", description="The control plane.")
    each = commands.add_subparsers(dest="command", required=True)
    first = each.add_parser("first-administrator", help="make a user a platform administrator")
    first.add_argument("subject")
    first.add_argument("--label", help="how other administrators know them")
    first.add_argument("--by", default=getpass.getuser(), help="who is doing it, for the audit log")
    args = commands.parse_args(argv)
    issuer = os.environ.get("UCP_ADMIN_ISSUER")
    if not issuer:
        raise SystemExit("set UCP_ADMIN_ISSUER to the identity provider administrators sign in with")
    engine = create_async_engine(os.environ["UCP_DATABASE_URL"])
    try:
        await Records(engine).add_administrator(issuer, args.subject, "platform", None, args.label, args.by)
    except Problem as error:
        raise SystemExit(f"{args.subject} is already an administrator") from error
    finally:
        await engine.dispose()
    return f"{args.subject} is a platform administrator"


if __name__ == "__main__":
    print(asyncio.run(main(sys.argv[1:])))
