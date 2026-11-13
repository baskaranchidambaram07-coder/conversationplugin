"""Portability (M14): the gateway imports no cloud provider's library. AWS reaches it only as settings in its
environment, which the container service fills from Secrets Manager, so the whole suite runs without AWS."""

import json
import re
import tomllib
from pathlib import Path

from ucp.widgets import filled, problems

CLOUD_LIBRARY = re.compile(r"^\s*(?:import|from)\s+(boto3|botocore|aioboto3|aiobotocore|azure|google\.cloud)\b", re.M)
BACKEND = Path(__file__).parents[1]


def test_no_module_of_the_gateway_imports_a_cloud_library():
    found = [str(path) for path in (BACKEND / "ucp").rglob("*.py") if CLOUD_LIBRARY.search(path.read_text("utf-8"))]

    assert found == []


def test_no_cloud_library_is_a_dependency():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))["project"]

    assert not [name for name in project["dependencies"] if re.match(r"(boto|aioboto|azure|google-cloud)", name)]


def test_the_dev_widget_file_publishes_once_the_environment_fills_it_in():
    # infra/aws/dev: the task's own settings fill in ${UCP_...}, and samples.tf finds the samples' widgets by secret.
    widgets = json.loads((BACKEND / "deploy/widgets.dev.json").read_text(encoding="utf-8"))["widgets"]
    filled_in = filled(widgets, {"UCP_SAMPLES_ORIGIN": "https://d111111abcdef8.cloudfront.net"})

    assert problems(filled_in) == []
    secrets = [widget["identity"]["secret"] for widget in widgets.values() if "identity" in widget]
    assert {"smoke", "college", "demo"} <= set(secrets) and len(secrets) == len(set(secrets))
