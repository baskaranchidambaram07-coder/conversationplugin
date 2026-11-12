"""The agent connector (D4, M6-T1): the one interface between the gateway and an agent runtime.

The gateway sees only these events, so nothing an agent runtime adds (its IDs, model details, cost figures, raw
errors) can reach the browser by accident (D15). Usage figures go to metering and logs, never to the visitor.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol


@dataclass(frozen=True)
class Accepted:
    """The agent has the question. `agent_message_id` lets a broken stream be recovered by fetching the answer."""

    agent_message_id: str


@dataclass(frozen=True)
class Text:
    """The next piece of the answer."""

    text: str


@dataclass(frozen=True)
class Final:
    """The whole answer, which replaces the pieces, and what it cost."""

    text: str
    usage: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Failed:
    """The agent could not answer. `detail` is for our logs only."""

    code: Literal["assistant_unavailable", "rate_limited"]
    retryable: bool
    detail: str = ""


type AgentEvent = Accepted | Text | Final | Failed


class AgentError(Exception):
    """A call other than sending failed (logging in, creating a conversation, checking the connection)."""

    def __init__(self, code: Literal["assistant_unavailable", "rate_limited"], retryable: bool, detail: str):
        super().__init__(detail)
        self.code, self.retryable, self.detail = code, retryable, detail


class AgentConnector(Protocol):
    async def create_conversation(self, name: str) -> str:
        """Starts a conversation on the agent's side, named with our opaque ID. Returns the agent's ID for it."""
        ...

    def send(self, conversation_id: str, text: str) -> AsyncIterator[AgentEvent]:
        """Asks a question. Ends with exactly one Final or Failed, recovering a broken stream itself."""
        ...

    async def check(self) -> None:
        """Raises AgentError unless the connection works (the control plane's "test connection", M6-T7)."""
        ...
