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
    agent_profiles: str | None = None  # JSON: {"profile name": {PF connection, see ucp.pf.PfProfile}}
    host_secrets: str | None = None  # JSON: {"secret name": "id:secret,id:secret"}, for widgets' host tokens
    signed_in_seconds: int = 900  # a signed-in session; the chat renews it through the host's getToken

    @classmethod
    def from_env(cls) -> "Settings":
        web_dir = os.environ.get("UCP_WEB_DIR")
        return cls(
            database_url=os.environ.get("UCP_DATABASE_URL"),
            web_dir=Path(web_dir) if web_dir else None,
            session_keys=os.environ.get("UCP_SESSION_KEYS"),
            agent_profiles=os.environ.get("UCP_AGENT_PROFILES"),
            host_secrets=os.environ.get("UCP_HOST_SECRETS"),
            signed_in_seconds=int(os.environ.get("UCP_SIGNED_IN_SECONDS", "900")),
        )
