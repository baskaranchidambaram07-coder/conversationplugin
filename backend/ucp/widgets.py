"""Widget configuration (M4-T8, and the seed command standing in for M8 until the control plane exists).

A widget's published document has a public part, the display settings in the message format's `WidgetConfig`,
and a private part the browser never sees: its tenant, the sites allowed to show it, how visitors sign in, the
agent connection profile it answers from, and its limits. The gateway reads the current version from the
database and keeps it for 30 seconds, so a newly published version is in use within half a minute.

    cd backend && uv run python -m ucp.widgets seed path/to/widgets.json      publishes every widget in the file
"""

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.identity import Identity
from ucp.protocol import Id, WidgetConfig
from ucp.store import Store

# An origin a customer's pages are served from, as it appears in a content policy. Nothing else can get into the
# policy: no spaces, semicolons or quotes. A leading "*." allows every subdomain.
type Origin = Annotated[str, Field(pattern=r"^https?://(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$")]


class Limits(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    sessions_per_minute_per_address: Annotated[int, Field(gt=0)] = 20
    messages_per_minute_per_session: Annotated[int, Field(gt=0)] = 10
    concurrent_turns: Annotated[int, Field(gt=0)] = 50  # across the tenant, on one gateway instance


class WidgetDocument(BaseModel):
    """What M8 publishes for a widget, and the seed file holds."""

    model_config = ConfigDict(strict=True, extra="forbid")

    tenant_id: Id
    public: dict = Field(description="WidgetConfig without `v` and `widget_id`.")
    allowed_domains: Annotated[list[Origin], Field(min_length=1)]
    sign_in: Literal["anonymous", "signed_in", "both"]
    agent_profile: Id = Field(description="The name of a connection profile held in the secret store.")
    identity: Identity | None = Field(default=None, description="How signed-in visitors prove who they are.")
    limits: Limits = Limits()

    @model_validator(mode="after")
    def _signed_in_needs_identity(self) -> "WidgetDocument":
        if self.sign_in != "anonymous" and not self.identity:
            raise ValueError("a widget for signed-in visitors needs its identity settings")
        return self


@dataclass(frozen=True)
class Widget:
    widget_id: str
    version: int
    document: WidgetDocument
    config: WidgetConfig  # the public part, exactly as the browser receives it

    @property
    def logo_origin(self) -> str | None:
        if not self.config.logo_url:
            return None
        parts = urlsplit(self.config.logo_url)
        return f"{parts.scheme}://{parts.netloc}"


def parse(widget_id: str, version: int, document: dict) -> Widget:
    parsed = WidgetDocument.model_validate(document)
    config = WidgetConfig.model_validate({"v": 1, "widget_id": widget_id, **parsed.public})
    return Widget(widget_id, version, parsed, config)


class Widgets:
    """The current version of each widget, read from the database at most every 30 seconds."""

    TTL = 30.0
    MAX = 10_000  # unknown IDs are remembered too, so a flood of made-up IDs cannot grow this without bound

    def __init__(self, store: Store):
        self.store = store
        self.cache: dict[str, tuple[float, Widget | None]] = {}

    async def get(self, widget_id: str) -> Widget | None:
        cached = self.cache.get(widget_id)
        if cached and time.monotonic() - cached[0] < self.TTL:
            return cached[1]
        row = await self.store.widget(widget_id)
        widget = parse(widget_id, row.version, row.document) if row else None
        if len(self.cache) >= self.MAX:
            self.cache.clear()
        self.cache[widget_id] = (time.monotonic(), widget)
        return widget


async def seed(store: Store, widgets: dict[str, dict]) -> dict[str, int]:
    """Checks every widget first, then publishes each as a new version if it changed. Returns the versions."""
    for widget_id, document in widgets.items():
        parse(widget_id, 0, document)
    return {
        widget_id: await store.publish_widget(widget_id, document["tenant_id"], document)
        for widget_id, document in widgets.items()
    }


async def _seed_file(path: str) -> None:
    engine = create_async_engine(os.environ["UCP_DATABASE_URL"])
    try:
        with open(path, encoding="utf-8") as file:
            versions = await seed(Store(engine), json.load(file)["widgets"])
    finally:
        await engine.dispose()
    for widget_id, version in versions.items():
        print(f"{widget_id}: version {version}")


if __name__ == "__main__":
    if sys.argv[1:2] != ["seed"] or len(sys.argv) != 3:
        sys.exit("usage: python -m ucp.widgets seed path/to/widgets.json")
    asyncio.run(_seed_file(sys.argv[2]))
