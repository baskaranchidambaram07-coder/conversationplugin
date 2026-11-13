"""Widget configuration (M4-T8, and the seed command standing in for M8 until the control plane exists).

A widget's published document has a public part, the display settings in the message format's `WidgetConfig`,
and a private part the browser never sees: its tenant, the sites allowed to show it, how visitors sign in, the
agent connection profile it answers from, and its limits. The gateway reads the current version from the
database and keeps it for 30 seconds, so a newly published version is in use within half a minute.

    cd backend && uv run python -m ucp.widgets seed path/to/widgets.json      publishes every widget in the file
    cd backend && uv run python -m ucp.widgets versions w_...                 lists a widget's published versions
    cd backend && uv run python -m ucp.widgets rollback w_... 3              publishes version 3 again, as a new one
    cd backend && uv run python -m ucp.widgets audit [--widget w_...]         who published or rolled back what, when

Publishing and rolling back record who did it (--by, the signed-in user by default) in the audit log. Published
versions and the log only grow: the database refuses to change or remove them.
"""

import argparse
import asyncio
import getpass
import json
import os
import re
import secrets
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.identity import Identity
from ucp.protocol import Id, WidgetConfig
from ucp.store import Store, new_id

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


_SETTING = re.compile(r"\$\{(UCP_[A-Z0-9_]+)\}")


def filled(value, environ):
    """A widget file may name the environment's own settings, such as ${UCP_SAMPLES_ORIGIN}, so one file serves an
    environment whose addresses change when it is rebuilt. Only UCP_ names are filled, and only inside strings."""
    if isinstance(value, dict):
        return {key: filled(item, environ) for key, item in value.items()}
    if isinstance(value, list):
        return [filled(item, environ) for item in value]
    if not isinstance(value, str):
        return value
    missing = sorted({name for name in _SETTING.findall(value) if not environ.get(name)})
    if missing:
        raise ValueError(f"the widget file names {', '.join(missing)}, which is not set here")
    return _SETTING.sub(lambda found: environ[found.group(1)], value)


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


async def seed(store: Store, widgets: dict[str, dict], actor: str = "system") -> dict[str, int]:
    """Checks every widget first, then publishes each as a new version if it changed. Returns the versions."""
    if found := problems(widgets):
        raise ValueError("\n".join(found))
    return {
        widget_id: await store.publish_widget(widget_id, document["tenant_id"], document, actor)
        for widget_id, document in widgets.items()
    }


def _commands() -> argparse.ArgumentParser:
    commands = argparse.ArgumentParser(prog="python -m ucp.widgets", description="Widget configuration.")
    each = commands.add_subparsers(dest="command", required=True)
    publish = each.add_parser("seed", help="publish every widget in a file, as a new version where it changed")
    publish.add_argument("file")
    back = each.add_parser("rollback", help="publish an earlier version again, as a new version")
    back.add_argument("widget_id")
    back.add_argument("version", type=int)
    for command in (publish, back):
        command.add_argument("--by", default=getpass.getuser(), help="who is doing it, for the audit log")
    each.add_parser("versions", help="a widget's published versions, newest first").add_argument("widget_id")
    log = each.add_parser("audit", help="the newest entries of the audit log")
    log.add_argument("--widget")
    log.add_argument("--limit", type=int, default=50)
    export = each.add_parser("export", help="every widget's current document, as a file seed can publish again")
    export.add_argument("--out", help="a file to write; the screen when left out")
    each.add_parser("new-id", help="a new public widget ID, for a new widget's entry in the file")
    secret = each.add_parser("new-secret", help="a new shared secret, as id:secret for UCP_HOST_SECRETS")
    secret.add_argument("--id", default=f"k{datetime.now(UTC):%Y%m%d}", help="its name; by default today's date")
    return commands


async def run(store: Store, argv: list[str]) -> list[str]:
    """The operator's commands. Returns the lines to print; raises SystemExit with the reason when refused."""
    args = _commands().parse_args(argv)

    if args.command == "seed":
        with open(args.file, encoding="utf-8") as file:
            widgets = json.load(file)["widgets"]
        try:
            versions = await seed(store, filled(widgets, os.environ), args.by)
        except ValueError as error:
            raise SystemExit(f"nothing was published:\n{error}") from error
        return [f"{widget_id}: version {version}" for widget_id, version in versions.items()]
    if args.command == "rollback":
        earlier = await store.widget(args.widget_id, args.version)
        if not earlier:
            raise SystemExit(f"{args.widget_id} has no version {args.version}")
        # A version published before today's rules may break them: it is refused rather than served broken.
        if found := problems({args.widget_id: earlier.document}):
            raise SystemExit("that version breaks today's rules, so it was not published again:\n" + "\n".join(found))
        version = await store.rollback_widget(args.widget_id, args.version, args.by)
        return [f"{args.widget_id}: version {version} is live, the same as version {args.version}"]
    if args.command == "export":
        exported = json.dumps({"widgets": await store.current_widgets()}, indent=2, ensure_ascii=False)
        if not args.out:
            return [exported]
        with open(args.out, "w", encoding="utf-8", newline="\n") as file:
            file.write(exported + "\n")
        return [f"exported every widget's current document to {args.out}"]
    if args.command == "new-id":
        return [new_id("w")]
    if args.command == "new-secret":
        # 32 random bytes, so the token-signing snippets' HMAC gets its full strength; the gateway refuses less.
        return [f"{args.id}:{secrets.token_urlsafe(32)}"]
    if args.command == "versions":
        rows = await store.widget_versions(args.widget_id)
        if not rows:
            raise SystemExit(f"no widget {args.widget_id}")
        return [f"{r.version}  {r.published_at:%Y-%m-%d %H:%M} UTC  {r.published_by or 'unknown'}" for r in rows]
    entries = await store.audit_entries(args.widget, args.limit)
    return [
        f"{e.at:%Y-%m-%d %H:%M:%S} UTC  {e.actor}  {e.action}  {e.widget_id} version {e.version}"
        + (f"  (as version {e.detail['to_version']})" if e.detail and "to_version" in e.detail else "")
        for e in entries
    ]


async def _main(argv: list[str]) -> None:
    _commands().parse_args(argv)  # help and mistakes in the command answer before any database is needed
    engine = create_async_engine(os.environ["UCP_DATABASE_URL"])
    try:
        lines = await run(Store(engine), argv)
    finally:
        await engine.dispose()
    print("\n".join(lines))


if __name__ == "__main__":
    asyncio.run(_main(sys.argv[1:]))
