"""Settings, read once from the environment when the gateway or the admin API starts. Secrets are injected there by
the platform (Secrets Manager on AWS) and never written to a file in the image."""

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
    # Behind a content delivery network the gateway's own view of its address is wrong: it hears plain http from the
    # load balancer. The public origin is what browsers see, as https://name, and their Origin header must match it.
    public_origin: str | None = None
    # The request header holding the visitor's address, set by the content delivery network, when the load balancer
    # admits only that network. Never set where visitors can reach the gateway directly: they could write it.
    visitor_address_header: str | None = None
    log_level: str = "INFO"  # the gateway's own log lines; DEBUG, INFO, WARNING or ERROR
    # Seals the secrets set through the admin API (ucp.vault), as "id:key,id:key" with 32-byte keys in base64url;
    # the first seals. The gateway needs it to read them, the admin API to write them.
    secrets_key: str | None = None
    # The admin API (ucp.admin): the company identity provider its administrators sign in with, the API's audience
    # there (its client ID), the claim naming the user, and the console addresses allowed to call it.
    admin_issuer: str | None = None
    admin_audience: str | None = None
    admin_user_claim: str = "sub"
    admin_origins: str | None = None  # comma-separated
    gateway_origin: str | None = None  # the chat's public address, for the console's install snippets and checker

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
            public_origin=os.environ.get("UCP_PUBLIC_ORIGIN"),
            visitor_address_header=os.environ.get("UCP_VISITOR_ADDRESS_HEADER"),
            log_level=os.environ.get("UCP_LOG_LEVEL", "INFO"),
            secrets_key=os.environ.get("UCP_SECRETS_KEY"),
            admin_issuer=os.environ.get("UCP_ADMIN_ISSUER"),
            admin_audience=os.environ.get("UCP_ADMIN_AUDIENCE"),
            admin_user_claim=os.environ.get("UCP_ADMIN_USER_CLAIM", "sub"),
            admin_origins=os.environ.get("UCP_ADMIN_ORIGINS"),
            gateway_origin=os.environ.get("UCP_GATEWAY_ORIGIN"),
        )
