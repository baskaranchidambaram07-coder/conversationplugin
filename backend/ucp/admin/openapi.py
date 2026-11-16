"""The admin API's description, generated from its routes for the admin console (M9) and API users. Never served.

cd backend && uv run python -m ucp.admin.openapi      writes protocol/admin-openapi.json
"""

import json

from ucp.admin.app import create_app
from ucp.protocol import SCHEMA_FILE
from ucp.settings import Settings

OPENAPI_FILE = SCHEMA_FILE.parents[1] / "admin-openapi.json"


def openapi_text() -> str:
    return json.dumps(create_app(Settings()).openapi(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    OPENAPI_FILE.write_text(openapi_text(), encoding="utf-8", newline="\n")
    print(f"wrote {OPENAPI_FILE}")
