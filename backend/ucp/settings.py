"""Settings, read once from the environment when the gateway starts. Secrets are injected there by the platform
(Secrets Manager on AWS) and never written to a file in the image."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(database_url=os.environ.get("UCP_DATABASE_URL"))
