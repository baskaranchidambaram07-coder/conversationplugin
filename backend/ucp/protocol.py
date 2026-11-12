"""Message format, version 1: the one definition of everything the gateway and the browser exchange (D8).

Generated from these models, never edited by hand:
    cd backend && uv run python -m ucp.protocol           writes protocol/schema/v1.json
    npm run generate --workspace @ucp/protocol            writes protocol/src/v1.ts from that schema
"""

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Discriminator, Field, Tag, TypeAdapter
from pydantic.json_schema import GenerateJsonSchema

SCHEMA_FILE = Path(__file__).resolve().parents[2] / "protocol" / "schema" / "v1.json"

type Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="Our opaque ID. Never a PF ID.")]
type Index = Annotated[int, Field(ge=0)]


class _Model(BaseModel):
    # Strict and closed: nothing is coerced, and a field not listed here cannot reach the browser (D15).
    model_config = ConfigDict(strict=True, extra="forbid")


# Content blocks


class TextBlock(_Model):
    """Plain text, shown exactly as written and never interpreted. Used for what the user typed."""

    type: Literal["text"]
    text: str


class MarkdownBlock(_Model):
    """Markdown. Tables, code and fenced diagram blocks travel inside it (D9)."""

    type: Literal["markdown"]
    text: str


KNOWN_BLOCK_TYPES = ("text", "markdown")


class UnknownBlock(BaseModel):
    """A block type this version does not know, sent by a newer gateway. Shown as its `text`, if it has one."""

    model_config = ConfigDict(strict=True, extra="allow")

    type: Annotated[str, Field(json_schema_extra={"not": {"enum": list(KNOWN_BLOCK_TYPES)}})]
    text: str | None = None


def _block_tag(block: object) -> str:
    kind = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
    return kind if kind in KNOWN_BLOCK_TYPES else "unknown"


type Block = Annotated[
    Annotated[TextBlock, Tag("text")]
    | Annotated[MarkdownBlock, Tag("markdown")]
    | Annotated[UnknownBlock, Tag("unknown")],
    Discriminator(_block_tag),
]


# Errors


class ApiError(_Model):
    """The body of every error response, and the payload of `message.failed`."""

    code: Literal[
        "invalid_request",
        "session_expired",
        "forbidden",
        "site_not_allowed",
        "not_found",
        "turn_in_progress",
        "rate_limited",
        "assistant_unavailable",
        "internal_error",
    ]
    message: str = Field(description="Our own wording. Never text from PF.")
    retryable: bool
    retry_after: Annotated[int, Field(ge=0)] | None = Field(description="Seconds to wait before retrying.")
    reference: Id = Field(description="The correlation ID, shown to the user so support can find the request.")


# Stream events: one server-sent `data:` line each. Heartbeats are comment lines, not events.


class _Event(_Model):
    v: Literal[1]
    seq: Index = Field(description="Starts at 0 for each message and rises by one per event.")
    type: str
    conversation_id: Id
    message_id: Id
    correlation_id: Id


class MessageStarted(_Event):
    """The assistant message exists. The widget shows its working state."""

    type: Literal["message.started"]


class ContentBlockStarted(_Event):
    """A block opens, with whatever it holds so far (for Markdown, empty text)."""

    type: Literal["content_block.started"]
    index: Index
    block: Block


class ContentBlockDelta(_Event):
    """Text to append to the open block."""

    type: Literal["content_block.delta"]
    index: Index
    text: Annotated[str, Field(min_length=1)]


class ContentBlockCompleted(_Event):
    """The whole block. It replaces what the deltas built, so a missed delta is repaired."""

    type: Literal["content_block.completed"]
    index: Index
    block: Block


class MessageCompleted(_Event):
    type: Literal["message.completed"]


class MessageFailed(_Event):
    """The turn failed. Blocks already streamed stay on screen."""

    type: Literal["message.failed"]
    error: ApiError


type StreamEvent = Annotated[
    MessageStarted | ContentBlockStarted | ContentBlockDelta | ContentBlockCompleted | MessageCompleted | MessageFailed,
    Field(discriminator="type"),
]


# Records returned by the API. PF IDs and the agent version are stored by the history module, never sent.


class Conversation(_Model):
    id: Id
    title: str | None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class Message(_Model):
    id: Id
    role: Literal["user", "assistant"]
    status: Literal["in_progress", "complete", "failed", "stopped"]
    blocks: list[Block]
    error: ApiError | None
    created_at: AwareDatetime


# Public widget configuration: display settings only. Domains, identity, limits and PF details stay private (R13).


class WidgetConfig(_Model):
    v: Literal[1]
    widget_id: Id
    title: Annotated[str, Field(min_length=1, max_length=80)]
    welcome_message: Annotated[str, Field(min_length=1, max_length=1000)] | None
    suggested_prompts: Annotated[list[Annotated[str, Field(min_length=1, max_length=200)]], Field(max_length=4)]
    ai_notice: Annotated[str, Field(min_length=1, max_length=500)] | None = Field(
        description="Null means the widget's own wording."
    )
    brand_color: Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
    logo_url: Annotated[str, Field(pattern=r"^https://[!-~]+$", max_length=2048)] | None
    color_scheme: Literal["light", "dark", "auto"]
    launcher_position: Literal["bottom-right", "bottom-left"]
    history_enabled: bool


# API requests and replies. The gateway (M4) implements them; the chat (M2) calls them.


class SessionRequest(_Model):
    """Body of POST /v1/sessions. A signed-in visitor brings the token the host signed for them; anyone else, null."""

    widget_id: Id
    host_token: Annotated[str, Field(min_length=1, max_length=8192)] | None


class Session(_Model):
    """Reply to POST /v1/sessions. The token is opaque to the browser and goes back as `Authorization: Bearer`."""

    token: Annotated[str, Field(min_length=1, max_length=4096)]
    expires_in: Annotated[int, Field(gt=0)] = Field(description="Seconds until the token expires.")


class SendMessage(_Model):
    """Body of POST /v1/conversations/{id}/messages. The reply streams StreamEvent lines, with `: ping` heartbeats."""

    text: Annotated[str, Field(min_length=1, max_length=4000, pattern=r"\S")] = Field(
        description="What the visitor typed: 1 to 4,000 characters, not only spaces."
    )
    client_message_id: Id = Field(
        description="Chosen by the chat. Sending again with the same ID returns the same reply."
    )


PUBLIC_TYPES = {
    "Block": Block,
    "StreamEvent": StreamEvent,
    "ApiError": ApiError,
    "Conversation": Conversation,
    "Message": Message,
    "WidgetConfig": WidgetConfig,
    "SessionRequest": SessionRequest,
    "Session": Session,
    "SendMessage": SendMessage,
}
ADAPTERS = {name: TypeAdapter(kind) for name, kind in PUBLIC_TYPES.items()}


class _SchemaGenerator(GenerateJsonSchema):
    # Property titles would become stray type aliases in the generated TypeScript.
    def field_title_should_be_set(self, schema) -> bool:
        return False


def json_schema() -> dict:
    refs, top = TypeAdapter.json_schemas(
        [(name, "validation", adapter) for name, adapter in ADAPTERS.items()],
        title="Protocol",
        schema_generator=_SchemaGenerator,
    )
    # The root accepts any public type, so the TypeScript generator emits a named type for each.
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        **top,
        "anyOf": [refs[(name, "validation")] for name in PUBLIC_TYPES],
    }


def schema_text() -> str:
    return json.dumps(json_schema(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    SCHEMA_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_FILE.write_text(schema_text(), encoding="utf-8", newline="\n")
    print(f"wrote {SCHEMA_FILE}")
