"""Settings, read once from the environment when the gateway starts. Secrets are injected there by the platform
(Secrets Manager on AWS) and never written to a file in the image."""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_url: str | None = None
    web_dir: Path | None = None  # the built loader and chat: web/loader/dist and web/widget/dist below it
    session_keys: str | None = None  # "id:secret,id:secret", the first signs (ucp.sessions.Keys)

    @classmethod
    def from_env(cls) -> "Settings":
        web_dir = os.environ.get("UCP_WEB_DIR")
        return cls(
            database_url=os.environ.get("UCP_DATABASE_URL"),
            web_dir=Path(web_dir) if web_dir else None,
            session_keys=os.environ.get("UCP_SESSION_KEYS"),
        )
