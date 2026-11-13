"""Brings the database schema to a revision (M7-T3): python -m ucp.migrate [revision], default "head".

Runs with a role that may change the schema; the gateway itself should connect with one that cannot (M7-T7).
"""

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


def config(url: str) -> Config:
    settings = Config()
    settings.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    settings.set_main_option("sqlalchemy.url", url.replace("%", "%%"))  # the file format treats % as special
    return settings


def upgrade(url: str, revision: str = "head") -> None:
    command.upgrade(config(url), revision)


def downgrade(url: str, revision: str = "base") -> None:
    command.downgrade(config(url), revision)


if __name__ == "__main__":
    upgrade(os.environ["UCP_DATABASE_URL"], *sys.argv[1:])
