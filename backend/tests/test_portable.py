"""Portability (M14): the gateway imports no cloud provider's library. AWS reaches it only as settings in its
environment, which the container service fills from Secrets Manager, so the whole suite runs without AWS."""

import re
import tomllib
from pathlib import Path

CLOUD_LIBRARY = re.compile(r"^\s*(?:import|from)\s+(boto3|botocore|aioboto3|aiobotocore|azure|google\.cloud)\b", re.M)
BACKEND = Path(__file__).parents[1]


def test_no_module_of_the_gateway_imports_a_cloud_library():
    found = [str(path) for path in (BACKEND / "ucp").rglob("*.py") if CLOUD_LIBRARY.search(path.read_text("utf-8"))]

    assert found == []


def test_no_cloud_library_is_a_dependency():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))["project"]

    assert not [name for name in project["dependencies"] if re.match(r"(boto|aioboto|azure|google-cloud)", name)]
