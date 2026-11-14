"""Releases the gateway in the dev environment (M14-T5). The pipeline runs it after pushing an image; dev.py wake
runs it to bring the newest release out.

    python infra/aws/deploy.py [--image TAG] [--by NAME]

With --image, a new release (task definition revision) runs that image; without, the newest release is used. Then,
with the release's own image: the database migrations, publishing the widget file (backend/deploy/widgets.dev.json)
with --by recorded in the audit log, rolling the service (the container service rolls back on its own if the
release never becomes healthy), and the PF connection check. While the environment sleeps it only says so: the
image waits in the registry for the next wake. Uses the AWS command line; prints no secret or account number.
"""

import argparse
import json
import os
import subprocess
import sys

REGION = "us-east-1"
CLUSTER = "ucp-dev-cluster"
SERVICE = "ucp-dev-gateway"
FAMILY = "ucp-dev-gateway"
REPOSITORY = "ucp-dev-gateway"
LOGS = "/ucp-dev/gateway"
KEEP = (
    "family",
    "taskRoleArn",
    "executionRoleArn",
    "networkMode",
    "containerDefinitions",
    "volumes",
    "requiresCompatibilities",
    "cpu",
    "memory",
    "runtimePlatform",
)


def aws(*args: str) -> dict:
    out = subprocess.run(
        ["aws", *args, "--region", REGION, "--output", "json"], check=True, text=True, capture_output=True
    ).stdout
    return json.loads(out) if out.strip() else {}


def wait(*args: str) -> None:
    subprocess.run(["aws", "ecs", "wait", *args, "--cluster", CLUSTER, "--region", REGION], check=True)


def public_url(setting: str = "UCP_PUBLIC_ORIGIN") -> str:
    """An address browsers use, as the newest release tells the gateway: the gateway's own (UCP_PUBLIC_ORIGIN) or the
    hosted samples' (UCP_SAMPLES_ORIGIN). Both are CloudFront's, and change only when the environment is rebuilt."""
    containers = aws("ecs", "describe-task-definition", "--task-definition", FAMILY)["taskDefinition"]
    environment = containers["containerDefinitions"][0]["environment"]
    return next(item["value"] for item in environment if item["name"] == setting)


def release(image_tag: str | None) -> str:
    current = aws("ecs", "describe-task-definition", "--task-definition", FAMILY)["taskDefinition"]
    if not image_tag:
        return current["taskDefinitionArn"]
    repository = aws("ecr", "describe-repositories", "--repository-names", REPOSITORY)["repositories"][0]
    spec = {key: current[key] for key in KEEP if key in current}
    for container in spec["containerDefinitions"]:
        container["image"] = f"{repository['repositoryUri']}:{image_tag}"
    return aws("ecs", "register-task-definition", "--cli-input-json", json.dumps(spec))["taskDefinition"][
        "taskDefinitionArn"
    ]


def once(definition: str, network: dict, command: list[str], what: str) -> list[str]:
    """Runs one command in a task of its own with the release's image, shows its output, and stops on failure.
    Returns the lines it wrote."""
    print(f"{what} ...", flush=True)
    overrides = {"containerOverrides": [{"name": "gateway", "command": command}]}
    task = aws(
        "ecs",
        "run-task",
        "--cluster",
        CLUSTER,
        "--task-definition",
        definition,
        "--launch-type",
        "FARGATE",
        "--network-configuration",
        json.dumps({"awsvpcConfiguration": network}),
        "--overrides",
        json.dumps(overrides),
    )["tasks"][0]
    wait("tasks-stopped", "--tasks", task["taskArn"])
    stopped = aws("ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", task["taskArn"])["tasks"][0]
    stream = f"gateway/gateway/{task['taskArn'].rsplit('/', 1)[1]}"
    lines = []
    try:
        events = aws("logs", "get-log-events", "--log-group-name", LOGS, "--log-stream-name", stream, "--limit", "40")
        lines = [event["message"] for event in events.get("events", [])]
    except subprocess.CalledProcessError:
        pass
    print("\n".join(f"  {line}" for line in lines) or "  (no output)")
    code = stopped["containers"][0].get("exitCode")
    if code != 0:
        sys.exit(f"{what} failed (exit {code}): {stopped.get('stoppedReason', '')}")
    return lines


def main(image_tag: str | None, by: str) -> None:
    services = aws("ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE)["services"]
    service = next((s for s in services if s["status"] == "ACTIVE"), None)
    if output := os.environ.get("GITHUB_OUTPUT"):  # tells the pipeline whether there is anything to smoke-test
        with open(output, "a", encoding="utf-8") as file:
            file.write(f"awake={'true' if service else 'false'}\nurl={public_url()}\n")
    if image_tag and not service:
        release(image_tag)  # recorded, so the next wake brings it out
    if not service:
        print("the environment is asleep: the release goes out on the next wake (python infra/aws/dev.py wake)")
        return
    definition = release(image_tag)
    network = service["networkConfiguration"]["awsvpcConfiguration"]
    once(definition, network, ["python", "-m", "ucp.migrate"], "migrating the database")
    once(
        definition,
        network,
        ["python", "-m", "ucp.widgets", "seed", "deploy/widgets.dev.json", "--by", by],
        "publishing the widget file",
    )
    print("rolling the service ...", flush=True)
    # Forced, so the same release starts afresh too: the gateway reads its secrets only when it starts.
    aws(
        "ecs",
        "update-service",
        "--cluster",
        CLUSTER,
        "--service",
        SERVICE,
        "--task-definition",
        definition,
        "--force-new-deployment",
    )
    wait("services-stable", "--services", SERVICE)
    live = aws("ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE)["services"][0]
    if live["taskDefinition"] != definition:
        sys.exit("the release never became healthy, and the service went back to the one before")
    once(definition, network, ["python", "-m", "ucp.pf", "check"], "checking the connection to PF")
    print(f"released revision {definition.rsplit(':', 1)[1]}")


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--image", help="the image tag to release; the newest release when left out")
    arguments.add_argument("--by", default="deploy.py", help="who releases it, for the widget file's audit entry")
    arguments.add_argument("--url", action="store_true", help="only print the address browsers use, and stop")
    arguments.add_argument("--samples-url", action="store_true", help="only print the hosted samples' address")
    args = arguments.parse_args()
    if args.url or args.samples_url:
        print(public_url("UCP_SAMPLES_ORIGIN" if args.samples_url else "UCP_PUBLIC_ORIGIN"))
    else:
        main(args.image, args.by)
