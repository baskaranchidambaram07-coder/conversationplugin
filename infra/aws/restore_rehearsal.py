"""Rehearses restoring the database (M14-T8, and M7's done condition): restores the dev database to a moment ten
minutes ago into a new instance, checks it holds every row the live one held at that moment, then removes it.

    python infra/aws/restore_rehearsal.py        (environment awake; about 20 minutes)

The checks run as one-off tasks with the gateway's own image and connection secret, pointed at the restored
instance's address; nothing here sees the database password. Prints counts and timings only.
"""

import json
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy import CLUSTER, SERVICE, aws, once, release  # noqa: E402

LIVE = "ucp-dev-database"
RESTORED = "ucp-dev-restored"
TABLES = {
    "widgets": "published_at",
    "audit": "at",
    "identities": "created_at",
    "conversations": "created_at",
    "messages": "created_at",
}

# Counts the rows written up to a moment, in the database the gateway's connection secret names, or at another
# address (the restored instance) with the same credentials.
COUNT = """
import asyncio, json, os, re, sys
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
url = os.environ["UCP_DATABASE_URL"]
if sys.argv[2] != "live":
    url = re.sub(r"@[^:/]+:", "@" + sys.argv[2] + ":", url, count=1)
tables, moment = json.loads(sys.argv[1]), datetime.fromisoformat(sys.argv[3])
async def main():
    engine = create_async_engine(url)
    async with engine.connect() as db:
        counts = {t: (await db.execute(text(f"select count(*) from {t} where {c} <= :m"), {"m": moment})).scalar()
                  for t, c in tables.items()}
    await engine.dispose()
    print("COUNTS " + json.dumps(counts))
asyncio.run(main())
"""


def counts(definition: str, network: dict, address: str, moment: datetime, what: str) -> dict:
    command = ["python", "-c", COUNT, json.dumps(TABLES), address, moment.isoformat()]
    lines = once(definition, network, command, what)
    return json.loads(next(line for line in lines if line.startswith("COUNTS "))[7:])


def main() -> None:
    services = aws("ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE)["services"]
    service = next((s for s in services if s["status"] == "ACTIVE"), None)
    if not service:
        sys.exit("wake the environment first: python infra/aws/dev.py wake")
    network, definition = service["networkConfiguration"]["awsvpcConfiguration"], release(None)
    live = aws("rds", "describe-db-instances", "--db-instance-identifier", LIVE)["DBInstances"][0]
    moment = (datetime.now(UTC) - timedelta(minutes=10)).replace(microsecond=0)

    before = counts(definition, network, "live", moment, f"counting the live database's rows up to {moment:%H:%M:%S}")
    print(f"restoring {LIVE} as it was at {moment:%Y-%m-%d %H:%M:%S} UTC into {RESTORED} ...", flush=True)
    began = time.monotonic()
    aws(
        "rds",
        "restore-db-instance-to-point-in-time",
        "--source-db-instance-identifier",
        LIVE,
        "--target-db-instance-identifier",
        RESTORED,
        "--restore-time",
        moment.isoformat().replace("+00:00", "Z"),
        "--db-subnet-group-name",
        live["DBSubnetGroup"]["DBSubnetGroupName"],
        "--vpc-security-group-ids",
        *[g["VpcSecurityGroupId"] for g in live["VpcSecurityGroups"]],
        "--db-instance-class",
        live["DBInstanceClass"],
        "--no-multi-az",
        "--no-publicly-accessible",
        "--no-deletion-protection",
    )
    try:
        aws("rds", "wait", "db-instance-available", "--db-instance-identifier", RESTORED)
        took = (time.monotonic() - began) / 60
        restored = aws("rds", "describe-db-instances", "--db-instance-identifier", RESTORED)["DBInstances"][0]
        after = counts(definition, network, restored["Endpoint"]["Address"], moment, "counting the restored rows")
    finally:
        aws("rds", "delete-db-instance", "--db-instance-identifier", RESTORED, "--skip-final-snapshot")
        print(f"{RESTORED} is being removed")
    print(f"restore took {took:.0f} minutes; live {before}; restored {after}")
    if after != before:
        sys.exit("the restored database does not match the live one at that moment")
    print("the restored database holds every row the live one held at that moment")


if __name__ == "__main__":
    main()
