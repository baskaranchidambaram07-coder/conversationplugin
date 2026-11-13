"""The gateway's API description, generated from its routes and exported for API users (M4-T1). Never served.

cd backend && uv run python -m ucp.gateway.openapi      writes protocol/openapi.json
"""

import json

from ucp.gateway.app import create_app
from ucp.protocol import SCHEMA_FILE

OPENAPI_FILE = SCHEMA_FILE.parents[1] / "openapi.json"


def openapi_text() -> str:
    return json.dumps(create_app().openapi(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    OPENAPI_FILE.write_text(openapi_text(), encoding="utf-8", newline="\n")
    print(f"wrote {OPENAPI_FILE}")
