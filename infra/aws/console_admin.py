"""Invites an administrator to the admin console in the dev environment (M9).

    python infra/aws/console_admin.py EMAIL [--label NAME] [--pool-only]

Adds them to the console's Cognito user pool, which emails them a temporary password, and makes them a platform
administrator (python -m ucp.admin first-administrator) in a task of its own with the newest release. At their first
sign-in, at the console's address, they choose a password and set up an authenticator app. With --pool-only they are
only added to the pool, and their user ID is printed: a customer's administrator or viewer, whose role a platform
administrator then gives through the admin API (POST /admin/v1/administrators). Run it while the environment is
awake. Prints no secret or account number.
"""

import argparse
import subprocess
import sys

from deploy import CLUSTER, FAMILY, SERVICE, aws, once

POOL = "ucp-dev-admins"


def pool_id() -> str:
    pools = aws("cognito-idp", "list-user-pools", "--max-results", "60")["UserPools"]
    found = [pool["Id"] for pool in pools if pool["Name"] == POOL]
    if not found:
        sys.exit(f"no user pool named {POOL}: build the environment from develop first (python infra/aws/dev.py wake)")
    return found[0]


def subject(pool: str, email: str) -> str:
    """Their ID in the pool, the `sub` claim the admin API reads; invites them if they are new."""
    try:
        made = aws(
            "cognito-idp",
            "admin-create-user",
            "--user-pool-id",
            pool,
            "--username",
            email,
            "--user-attributes",
            f"Name=email,Value={email}",
            "Name=email_verified,Value=true",
            "--desired-delivery-mediums",
            "EMAIL",
        )["User"]["Attributes"]
        print(f"invited {email}: Cognito has emailed them a temporary password")
    except subprocess.CalledProcessError as error:
        if "UsernameExistsException" not in (error.stderr or ""):
            raise
        made = aws("cognito-idp", "admin-get-user", "--user-pool-id", pool, "--username", email)["UserAttributes"]
        print(f"{email} is already in the pool")
    return next(attribute["Value"] for attribute in made if attribute["Name"] == "sub")


def main(email: str, label: str | None, pool_only: bool) -> None:
    services = aws("ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE)["services"]
    service = next((s for s in services if s["status"] == "ACTIVE"), None)
    if not service:
        sys.exit("the environment is asleep: wake it first (python infra/aws/dev.py wake)")
    definition = aws("ecs", "describe-task-definition", "--task-definition", FAMILY)["taskDefinition"]
    admin = next((c for c in definition["containerDefinitions"] if c["name"] == "admin"), None)
    if not admin:
        sys.exit("the newest release has no admin container: wake the environment from develop first")
    settings = {item["name"]: item["value"] for item in admin["environment"]}
    user = subject(pool_id(), email)
    print(f"their user ID (sub): {user}")
    if pool_only:
        return
    once(
        definition["taskDefinitionArn"],
        service["networkConfiguration"]["awsvpcConfiguration"],
        ["python", "-m", "ucp.admin", "first-administrator", user, "--label", label or email],
        "making them a platform administrator",
        {"UCP_ADMIN_ISSUER": settings["UCP_ADMIN_ISSUER"]},
    )
    print(f"they sign in at {settings['UCP_ADMIN_ORIGINS']}")


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("email", help="their email address, which is also their user name")
    arguments.add_argument("--label", help="how other administrators know them (their email when left out)")
    arguments.add_argument("--pool-only", action="store_true", help="only add them to the pool, and print their ID")
    args = arguments.parse_args()
    main(args.email, args.label, args.pool_only)
