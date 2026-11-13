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
import re
import sys
import time
from dataclasses import dataclass
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.identity import Identity
from ucp.protocol import Id, WidgetConfig
from ucp.store import Store

# Domains shared by unrelated owners, so "*." over one of them would let strangers' sites show the chat.
# shortcut: a short list (UK and common platforms), not the full public suffix list; adopt that list when
# customers outside the UK arrive.
SHARED_SUFFIXES = frozenset(
    """ac.uk co.uk gov.uk org.uk ltd.uk plc.uk me.uk net.uk nhs.uk police.uk sch.uk com.au net.au org.au edu.au
    gov.au co.nz org.nz co.in ac.in co.jp ac.jp com.br com.cn edu.cn co.za ac.za com.sg edu.sg com.hk co.kr
    github.io gitlab.io herokuapp.com azurewebsites.net cloudfront.net amazonaws.com web.app firebaseapp.com
    pages.dev workers.dev vercel.app netlify.app""".split()
)
LOCAL = {"localhost", "127.0.0.1"}
_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"  # a DNS label: no leading or trailing hyphen, at most 63
_ORIGIN = re.compile(rf"(https?)://(\*\.)?((?:{_LABEL}\.)*{_LABEL})(?::([0-9]{{1,5}}))?")


def _origin(value: str) -> str:
    """A site allowed to show the chat. It goes into the chat page's frame-ancestors policy as written, so the
    browser does the matching; this keeps out anything that would widen the policy beyond the customer's sites."""
    match = _ORIGIN.fullmatch(value)
    if not match:
        raise ValueError(
            "write a site as scheme, host and optional port, in lower case, such as https://www.example.ac.uk; "
            "internationalised names in their xn-- form"
        )
    scheme, wildcard, host, port = match.groups()
    if scheme == "http" and host not in LOCAL:
        raise ValueError("only https sites may show the chat; http is for localhost and 127.0.0.1")
    if port and not 0 < int(port) < 65536:
        raise ValueError("a port is a number from 1 to 65535")
    if wildcard and ("." not in host or host in SHARED_SUFFIXES or host in LOCAL):
        raise ValueError(f"*.{host} would let other owners' sites show the chat; name the customer's own domain")
    return value


type Origin = Annotated[str, AfterValidator(_origin)]


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


def problems(widgets: dict[str, dict]) -> list[str]:
    """Every reason a file of widgets cannot be published, one line each, naming the widget and the field."""
    found = []
    for widget_id, document in widgets.items():
        public = document.get("public") if isinstance(document, dict) else None
        checks = [(WidgetDocument, document, "")]
        if isinstance(public, dict):  # the public part is checked on its own too, so both sets of faults show at once
            checks.append((WidgetConfig, {"v": 1, "widget_id": widget_id, **public}, "public."))
        for model, value, prefix in checks:
            try:
                model.model_validate(value)
            except ValidationError as error:
                found += [f"{widget_id}: {prefix}{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in error.errors()]
    return found


async def seed(store: Store, widgets: dict[str, dict]) -> dict[str, int]:
    """Checks every widget first, then publishes each as a new version if it changed. Returns the versions."""
    if found := problems(widgets):
        raise ValueError("\n".join(found))
    return {
        widget_id: await store.publish_widget(widget_id, document["tenant_id"], document)
        for widget_id, document in widgets.items()
    }


async def _seed_file(path: str) -> None:
    engine = create_async_engine(os.environ["UCP_DATABASE_URL"])
    try:
        with open(path, encoding="utf-8") as file:
            versions = await seed(Store(engine), json.load(file)["widgets"])
    except ValueError as error:
        sys.exit(f"nothing was published:\n{error}")
    finally:
        await engine.dispose()
    for widget_id, version in versions.items():
        print(f"{widget_id}: version {version}")


if __name__ == "__main__":
    if sys.argv[1:2] != ["seed"] or len(sys.argv) != 3:
        sys.exit("usage: python -m ucp.widgets seed path/to/widgets.json")
    asyncio.run(_seed_file(sys.argv[2]))
