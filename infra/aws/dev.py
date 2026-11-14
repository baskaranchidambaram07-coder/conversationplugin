"""The dev environment on demand (M14): wake it to use it, put it to sleep to stop paying for it.

    python infra/aws/dev.py bootstrap   once: the bucket for Terraform's state, then Terraform's set-up
    python infra/aws/dev.py plan        what Terraform would change, awake (add --asleep for the sleeping shape)
    python infra/aws/dev.py wake        database on, load balancer and gateway up, newest release out (about 10 min)
    python infra/aws/dev.py sleep       gateway and load balancer removed, database stopped (about US$5 a month)
    python infra/aws/dev.py status      what is running, and the address
    python infra/aws/dev.py build       from nothing (after bootstrap, or after teardown): everything, asleep
    python infra/aws/dev.py teardown    everything removed but Terraform's state bucket and GitHub's sign-in, which
                                        the deploying user may create but not delete; build adopts it again

Run from the repository root with the AWS command line signed in as the deploying user. Terraform comes from
.tools/terraform. Nothing here prints a secret. AWS starts a stopped database again after seven days; status shows
it, and sleep stops it again.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DEV = HERE / "dev"
TERRAFORM = str(ROOT / ".tools" / "terraform" / ("terraform.exe" if os.name == "nt" else "terraform"))
REGION = "us-east-1"
DATABASE = "ucp-dev-database"
ENV = {**os.environ, "TF_PLUGIN_CACHE_DIR": str(ROOT / ".tools" / "terraform-plugins"), "TF_IN_AUTOMATION": "1"}


def terraform(folder: Path, *args: str, capture: bool = False) -> str:
    (ROOT / ".tools" / "terraform-plugins").mkdir(exist_ok=True)
    command = [TERRAFORM, f"-chdir={folder}", *args]
    result = subprocess.run(command, env=ENV, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def aws(*args: str) -> str:
    return subprocess.run(["aws", *args, "--region", REGION], check=True, text=True, capture_output=True).stdout.strip()


def database_state() -> str:
    try:
        return aws(
            "rds",
            "describe-db-instances",
            "--db-instance-identifier",
            DATABASE,
            "--query",
            "DBInstances[0].DBInstanceStatus",
            "--output",
            "text",
        )
    except subprocess.CalledProcessError:
        return "absent"


def bootstrap() -> None:
    folder = HERE / "bootstrap"
    terraform(folder, "init", "-input=false")
    terraform(folder, "apply", "-input=false", "-auto-approve")
    bucket = terraform(folder, "output", "-raw", "bucket", capture=True).strip()
    (DEV / "backend.hcl").write_text(
        f'bucket       = "{bucket}"\nkey          = "dev/terraform.tfstate"\nregion       = "{REGION}"\n'
        "encrypt      = true\nuse_lockfile = true\n",
        encoding="utf-8",
    )
    terraform(DEV, "init", "-input=false", "-reconfigure", "-backend-config=backend.hcl")
    print(f"state bucket ready; Terraform set up in {DEV.relative_to(ROOT)}")


def apply(awake: bool) -> None:
    terraform(DEV, "apply", "-input=false", "-auto-approve", f"-var=awake={str(awake).lower()}")


GITHUB = "aws_iam_openid_connect_provider.github"


def build() -> None:
    """The whole environment from the code, in its sleeping shape. Then: the PF profile (secret_store.py), an image
    from the pipeline, and wake."""
    if GITHUB not in terraform(DEV, "state", "list", capture=True).split():
        account = aws("sts", "get-caller-identity", "--query", "Account", "--output", "text")
        provider = f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"
        try:
            aws("iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", provider)
            terraform(DEV, "import", "-input=false", "-var=awake=false", GITHUB, provider)  # left by a teardown
        except subprocess.CalledProcessError:
            pass  # a first build: Terraform creates it
    apply(awake=False)
    print(f"built, asleep, at {terraform(DEV, 'output', '-raw', 'url', capture=True).strip()}")


def teardown() -> None:
    if GITHUB in terraform(DEV, "state", "list", capture=True).split():
        terraform(DEV, "state", "rm", GITHUB)  # the deploying user may not delete it; build adopts it again
    terraform(DEV, "destroy", "-input=false", "-auto-approve", "-var=awake=false")
    print("torn down: only Terraform's state bucket and GitHub's sign-in remain")


def wake() -> None:
    state = database_state()
    if state == "stopped":
        print("starting the database (about 5 minutes)")
        aws("rds", "start-db-instance", "--db-instance-identifier", DATABASE)
    if state != "absent":
        aws("rds", "wait", "db-instance-available", "--db-instance-identifier", DATABASE)
    apply(awake=True)
    subprocess.run([sys.executable, str(HERE / "deploy.py"), "--by", "dev.py wake"], check=True)
    print(f"awake at {terraform(DEV, 'output', '-raw', 'url', capture=True).strip()}")
    print(f"console at {terraform(DEV, 'output', '-raw', 'console_url', capture=True).strip()}")


def sleep() -> None:
    apply(awake=False)
    if database_state() == "available":
        aws("rds", "stop-db-instance", "--db-instance-identifier", DATABASE)
    print("asleep: the address, the data and the secrets stay; nothing else runs")


def status() -> None:
    outputs = json.loads(terraform(DEV, "output", "-json", capture=True) or "{}")
    services = json.loads(
        aws(
            "ecs",
            "describe-services",
            "--cluster",
            "ucp-dev-cluster",
            "--services",
            "ucp-dev-gateway",
            "--output",
            "json",
        )
    )["services"]
    running = next((s["runningCount"] for s in services if s["status"] == "ACTIVE"), 0)
    print(f"address:  {outputs.get('url', {}).get('value', 'not built')}")
    print(f"console:  {outputs.get('console_url', {}).get('value', 'not built')}")
    print(f"awake:    {outputs.get('awake', {}).get('value', False)} (gateway tasks running: {running})")
    print(f"database: {database_state()}")


if __name__ == "__main__":
    commands = argparse.ArgumentParser(description="The dev environment on demand.")
    commands.add_argument("command", choices=["bootstrap", "build", "plan", "wake", "sleep", "status", "teardown"])
    commands.add_argument("--asleep", action="store_true", help="plan the sleeping shape")
    args = commands.parse_args()
    if args.command == "plan":
        terraform(DEV, "plan", "-input=false", f"-var=awake={str(not args.asleep).lower()}")
    else:
        run = {"bootstrap": bootstrap, "build": build, "wake": wake, "sleep": sleep, "status": status}
        run["teardown"] = teardown
        run[args.command]()
