"""One environment of the Conversation Plugin on AWS, built and run from the code (M14).

    python infra/aws/stack.py [--env NAME] COMMAND

NAME picks the settings file infra/aws/environments/NAME.tfvars.json (dev when left out; UCP_ENV also sets it).

    policies      the two access policies for this environment, written to infra/aws/iam/out/ for an AWS
                  administrator to publish (infra/aws/SETUP.md)
    bootstrap     once: the bucket for Terraform's state, then Terraform's set-up
    plan          what Terraform would change, awake (add --asleep for the sleeping shape)
    up            build or update everything, awake, and release: database migrations, then the service rolled to
                  the newest release (about 15 minutes the first time). wake is the same
    sleep         gateway and load balancer removed, database stopped (about US$5 a month)
    status        the addresses, whether they answer, and what is running
    admin EMAIL   invite an administrator to the admin console (infra/aws/console_admin.py)
    build         dev: everything from nothing, asleep, adopting GitHub's sign-in a teardown left
    teardown      everything removed but Terraform's state bucket (and, in dev, GitHub's sign-in, which the deploying
                  user may create but not delete; build adopts it again). It stops at the database and the sign-in
                  pool while protect_data is true

Run from the repository's (or the bundle's) root with the AWS command line signed in as the deploying identity.
Terraform comes from .tools/terraform when present, else from the PATH. Nothing here prints a secret. AWS starts a
stopped database again after seven days; status shows it, and sleep stops it again.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
STACK = HERE / "stack"
TOOLS = ROOT / ".tools"
LOCAL = TOOLS / "terraform" / ("terraform.exe" if os.name == "nt" else "terraform")
TERRAFORM = str(LOCAL) if LOCAL.exists() else "terraform"

COMMANDS = ["policies", "bootstrap", "plan", "up", "wake", "sleep", "status", "admin", "build", "teardown"]
arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
arguments.add_argument("--env", default=os.environ.get("UCP_ENV", "dev"), help="the environment's settings file name")
arguments.add_argument("command", choices=COMMANDS)
arguments.add_argument("email", nargs="?", help="admin: their email address, which is also their user name")
arguments.add_argument("--label", help="admin: how other administrators know them (their email when left out)")
arguments.add_argument("--pool-only", action="store_true", help="admin: only add them to the pool, print their ID")
arguments.add_argument("--asleep", action="store_true", help="plan: the sleeping shape")
ARGS = arguments.parse_args()
os.environ["UCP_ENV"] = ARGS.env  # read by deploy.py, and by the scripts run from here

from deploy import ENVIRONMENT, NAME, REGION, SETTINGS  # noqa: E402

ENVIRONMENTS = HERE / "environments"
VARS = f"-var-file={ENVIRONMENTS / f'{ENVIRONMENT}.tfvars.json'}"
BACKEND = ENVIRONMENTS / f"{ENVIRONMENT}.backend.hcl"
DATABASE = f"{NAME}-database"
GITHUB = "aws_iam_openid_connect_provider.github[0]"


def terraform(folder: Path, *args: str, data: str = ENVIRONMENT, capture: bool = False) -> str:
    """Each environment keeps Terraform's working data apart, so several can be run from one copy."""
    env = {**os.environ, "TF_DATA_DIR": str(ENVIRONMENTS / ".terraform" / data), "TF_IN_AUTOMATION": "1"}
    if TOOLS.exists():
        (TOOLS / "terraform-plugins").mkdir(exist_ok=True)
        env["TF_PLUGIN_CACHE_DIR"] = str(TOOLS / "terraform-plugins")
    result = subprocess.run(
        [TERRAFORM, f"-chdir={folder}", *args], env=env, check=True, text=True, capture_output=capture
    )
    return result.stdout if capture else ""


def stack(*args: str, capture: bool = False) -> str:
    if not (ENVIRONMENTS / ".terraform" / ENVIRONMENT / "terraform.tfstate").exists():
        if not BACKEND.exists():
            sys.exit(f"no state bucket for {ENVIRONMENT} yet: python infra/aws/stack.py --env {ENVIRONMENT} bootstrap")
        terraform(STACK, "init", "-input=false", "-reconfigure", f"-backend-config={BACKEND}")
    return terraform(STACK, *args, capture=capture)


def output(name: str) -> str:
    return stack("output", "-raw", name, capture=True).strip()


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


def policies() -> None:
    """The development environment's two policies (iam/), rewritten for this environment's name, region and tag."""
    out = HERE / "iam" / "out"
    out.mkdir(exist_ok=True)
    tag = SETTINGS.get("environment", "prod")
    dropped = {"InspectOwnAccess"} | (set() if SETTINGS.get("github_subject_prefix") else {"GitHubSignIn"})
    for kind in ("boundary", "deployer"):
        text = (HERE / "iam" / f"ucp-dev-{kind}.json").read_text(encoding="utf-8")
        text = text.replace("ucp-dev", NAME).replace("us-east-1", REGION).replace("NetworkInUsEast1", "NetworkInRegion")
        policy = json.loads(text.replace('environment": "dev"', f'environment": "{tag}"'))
        policy["Statement"] = [s for s in policy["Statement"] if s.get("Sid") not in dropped]
        size = len(json.dumps(policy, separators=(",", ":")))  # IAM counts the policy without its spaces
        if size > 6144:
            sys.exit(f"{kind}: {size} characters, over IAM's limit of 6,144: choose a shorter name")
        path = out / f"{NAME}-{kind}.json"
        path.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
        print(f"{path.relative_to(ROOT)}: the policy {NAME}-{kind} ({size} of 6,144 characters)")


def bootstrap() -> None:
    folder = HERE / "bootstrap"
    state = f"-state={ENVIRONMENTS / f'{ENVIRONMENT}.bootstrap.tfstate'}"
    tag = SETTINGS.get("environment", "prod")
    names = [f"-var=name={NAME}", f"-var=region={REGION}", f"-var=environment={tag}"]
    terraform(folder, "init", "-input=false", data="bootstrap")
    terraform(folder, "apply", "-input=false", "-auto-approve", state, *names, data="bootstrap")
    bucket = terraform(folder, "output", state, "-raw", "bucket", data="bootstrap", capture=True).strip()
    BACKEND.write_text(
        f'bucket       = "{bucket}"\nkey          = "{ENVIRONMENT}/terraform.tfstate"\nregion       = "{REGION}"\n'
        "encrypt      = true\nuse_lockfile = true\n",
        encoding="utf-8",
    )
    terraform(STACK, "init", "-input=false", "-reconfigure", f"-backend-config={BACKEND}")
    print(f"state bucket ready; Terraform set up for {ENVIRONMENT}")


def apply(awake: bool) -> None:
    stack("apply", "-input=false", "-auto-approve", VARS, f"-var=awake={str(awake).lower()}")


def build() -> None:
    """The whole environment from the code, in its sleeping shape. Then, in dev: the PF profile (secret_store.py),
    an image from the pipeline, and wake."""
    if SETTINGS.get("github_subject_prefix") and GITHUB not in stack("state", "list", capture=True).split():
        account = aws("sts", "get-caller-identity", "--query", "Account", "--output", "text")
        provider = f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"
        try:
            aws("iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", provider)
            stack("import", "-input=false", VARS, "-var=awake=false", GITHUB, provider)  # left by a teardown
        except subprocess.CalledProcessError:
            pass  # a first build: Terraform creates it
    apply(awake=False)
    print(f"built, asleep, at {output('url')}")


def teardown() -> None:
    if GITHUB in stack("state", "list", capture=True).split():
        stack("state", "rm", GITHUB)  # the deploying user may not delete it; build adopts it again
    stack("destroy", "-input=false", "-auto-approve", VARS, "-var=awake=false")
    print("torn down: only Terraform's state bucket remains")


def wake() -> None:
    state = database_state()
    while state == "stopping":  # put to sleep a moment ago: it must finish stopping before it can start again
        time.sleep(15)
        state = database_state()
    if state == "stopped":
        print("starting the database (about 5 minutes)")
        aws("rds", "start-db-instance", "--db-instance-identifier", DATABASE)
    if state != "absent":
        aws("rds", "wait", "db-instance-available", "--db-instance-identifier", DATABASE)
    apply(awake=True)
    subprocess.run([sys.executable, str(HERE / "deploy.py"), "--by", f"stack.py {ARGS.command}"], check=True)
    print(f"awake at {output('url')}")
    print(f"console at {output('console_url')}")


def sleep() -> None:
    apply(awake=False)
    if database_state() == "available":
        aws("rds", "stop-db-instance", "--db-instance-identifier", DATABASE)
    print("asleep: the address, the data and the secrets stay; nothing else runs")


def answers(url: str) -> str:
    try:
        with urllib.request.urlopen(f"{url}/healthz", timeout=10) as response:  # noqa: S310 Terraform's https address
            return f"answering ({response.status})"
    except urllib.error.HTTPError as error:
        return "asleep" if error.code == 503 else f"not answering ({error.code})"
    except OSError as error:
        return f"not answering ({error})"


def status() -> None:
    outputs = json.loads(stack("output", "-json", capture=True) or "{}")
    services = json.loads(
        aws(
            "ecs",
            "describe-services",
            "--cluster",
            f"{NAME}-cluster",
            "--services",
            f"{NAME}-gateway",
            "--output",
            "json",
        )
    )["services"]
    running = next((s["runningCount"] for s in services if s["status"] == "ACTIVE"), 0)
    for label, key in (("address", "url"), ("console", "console_url")):
        url = outputs.get(key, {}).get("value")
        print(f"{label + ':':9} {url} ({answers(url)})" if url else f"{label + ':':9} not built")
    print(f"awake:    {outputs.get('awake', {}).get('value', False)} (gateway tasks running: {running})")
    print(f"database: {database_state()}")


def admin() -> None:
    if not ARGS.email:
        sys.exit("usage: python infra/aws/stack.py [--env NAME] admin EMAIL [--label NAME] [--pool-only]")
    import console_admin

    console_admin.main(ARGS.email, ARGS.label, ARGS.pool_only)


if __name__ == "__main__":
    if ARGS.command == "plan":
        stack("plan", "-input=false", VARS, f"-var=awake={str(not ARGS.asleep).lower()}")
    else:
        run = {"policies": policies, "bootstrap": bootstrap, "up": wake, "wake": wake, "sleep": sleep}
        run |= {"status": status, "admin": admin, "build": build, "teardown": teardown}
        run[ARGS.command]()
