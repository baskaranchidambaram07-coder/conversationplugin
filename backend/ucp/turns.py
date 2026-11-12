"""A turn: one question and its answer (M4-T6, M4-T7, M4-T9).

The answer is produced by a task that outlives the request: a visitor who closes the page, loses the connection
or presses stop still finds the whole answer stored, as PF finishes it anyway (pf-capability-sheet.md section 6).
The request only watches the task through a queue of events, with a heartbeat while nothing new arrives.

What happens when a step fails:
- creating the agent's conversation fails: the answer is stored as failed, with that error;
- the agent fails before it has the question: asked once more after a second, then failed;
- the agent fails after it has the question: failed, keeping any part of the answer already streamed;
- no first word within 60 seconds, or no whole answer within 5 minutes: failed, keeping what arrived;
- anything unexpected: logged under the reference and failed as an internal error.
"""

import asyncio
import itertools
import json
import logging
import time
from collections import Counter
from collections.abc import AsyncIterator
from math import ceil

from ucp.connector import Accepted, AgentConnector, AgentError, Failed, Final, Text
from ucp.gateway.pipeline import Problem, api_error, correlation
from ucp.protocol import ADAPTERS, Message
from ucp.store import Owner, Store, Turn

log = logging.getLogger("ucp.turns")
EVENTS = ADAPTERS["StreamEvent"]
PING = ": ping\n\n"


class Breaker:
    """For one agent connection: after `threshold` failures in a row, new turns are refused for `cooldown` seconds
    rather than each waiting on a connection that is down. The first turn after that tries again."""

    def __init__(self, threshold: int = 5, cooldown: float = 30):
        self.threshold, self.cooldown = threshold, cooldown
        self.failures, self.opened = 0, None

    def retry_after(self) -> int | None:
        if self.opened is None:
            return None
        left = self.cooldown - (time.monotonic() - self.opened)
        return ceil(left) if left > 0 else None

    def record(self, ok: bool) -> None:
        if ok:
            self.failures, self.opened = 0, None
            return
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened = time.monotonic()


class Turns:
    def __init__(
        self,
        store: Store,
        *,
        first_word: float = 60,
        whole: float = 300,
        heartbeat: float = 15,
        retry_wait: float = 1,
        breaker: tuple[int, float] = (5, 30),
    ):
        self.store = store
        self.first_word, self.whole, self.heartbeat, self.retry_wait = first_word, whole, heartbeat, retry_wait
        self.breaker = breaker
        self.tasks: set[asyncio.Task] = set()
        self.active: Counter[str] = Counter()
        self.breakers: dict[str, Breaker] = {}

    def admit(self, tenant_id: str, profile: str, concurrent: int) -> None:
        """Refuses a new turn while the agent connection is known to be down, or the tenant has too many running."""
        wait = self.breakers.setdefault(profile, Breaker(*self.breaker)).retry_after()
        if wait is not None:
            raise Problem("assistant_unavailable", retryable=True, retry_after=wait)
        if self.active[tenant_id] >= concurrent:
            raise Problem("rate_limited", retryable=True, retry_after=5)

    def start(
        self, turn: Turn, tenant_id: str, profile: str, connector: AgentConnector, question: str
    ) -> tuple[asyncio.Queue, asyncio.Task]:
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        self.active[tenant_id] += 1
        task = asyncio.create_task(self._run(turn, tenant_id, profile, connector, question, queue))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return queue, task

    async def watch(self, queue: asyncio.Queue) -> AsyncIterator[str]:
        """The live events of a turn, as server-sent event lines, with a heartbeat in every quiet spell."""
        yield PING
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), self.heartbeat)
            except TimeoutError:
                yield PING
                continue
            if item is None:
                return
            yield f"data: {item}\n\n"

    async def settled(self, owner: Owner, turn: Turn) -> Message:
        """The stored answer once it is no longer in progress (or the turn's time is up)."""
        deadline = time.monotonic() + self.whole + 60
        while True:
            message = await self.store.message(owner, turn.conversation_id, turn.answer_id)
            if message.status != "in_progress" or time.monotonic() > deadline:
                return message
            await asyncio.sleep(1)

    async def replay(self, owner: Owner, turn: Turn) -> AsyncIterator[str]:
        """A question sent again: the stored answer, as events, once it has finished."""
        waiting = asyncio.create_task(self.settled(owner, turn))
        try:
            yield PING
            while not (await asyncio.wait({waiting}, timeout=self.heartbeat))[0]:
                yield PING
            message = waiting.result()
        finally:
            waiting.cancel()
        emit = _emitter(turn)
        lines = [emit("message.started")]
        for index, block in enumerate(message.blocks):
            data = block.model_dump(mode="json")
            lines += [emit("content_block.started", index=index, block=data)]
            lines += [emit("content_block.completed", index=index, block=data)]
        if message.status == "in_progress":
            failure = api_error("assistant_unavailable", retryable=True).model_dump(mode="json")
            lines.append(emit("message.failed", error=failure))
        elif message.status == "failed":
            lines.append(emit("message.failed", error=message.error.model_dump(mode="json")))
        else:
            lines.append(emit("message.completed"))
        for line in lines:
            yield f"data: {line}\n\n"

    async def _run(
        self, turn: Turn, tenant_id: str, profile: str, connector: AgentConnector, question: str, queue: asyncio.Queue
    ) -> None:
        emit = _emitter(turn)
        answer: list[str] = []
        opened = False

        def send(kind: str, **fields) -> None:
            queue.put_nowait(emit(kind, **fields))

        def piece(text: str) -> None:
            nonlocal opened
            if not opened:
                send("content_block.started", index=0, block={"type": "markdown", "text": ""})
                opened = True
            answer.append(text)
            send("content_block.delta", index=0, text=text)

        outcome: Final | Failed
        send("message.started")
        try:
            async with asyncio.timeout(self.whole):
                agent_conversation = turn.agent_conversation_id
                if not agent_conversation:
                    agent_conversation = await connector.create_conversation(turn.conversation_id)
                    await self.store.set_agent_conversation(turn.conversation_id, agent_conversation)
                for attempt in (1, 2):
                    outcome, accepted = await self._ask(connector, agent_conversation, question, turn, piece)
                    if isinstance(outcome, Final) or accepted or not outcome.retryable or attempt == 2:
                        break
                    await asyncio.sleep(self.retry_wait)  # the agent never had the question, so asking again is safe
        except AgentError as error:
            outcome = Failed(error.code, error.retryable, error.detail)
        except TimeoutError:
            outcome = Failed("assistant_unavailable", True, f"no whole answer within {self.whole:.0f} s")
        except Exception:
            log.exception("turn %s failed, reference %s", turn.answer_id, correlation.get())
            outcome = None
        finally:
            self.active[tenant_id] -= 1

        try:
            if isinstance(outcome, Final):
                block = {"type": "markdown", "text": outcome.text}
                if not opened:
                    send("content_block.started", index=0, block={"type": "markdown", "text": ""})
                await self.store.finish(turn.answer_id, "complete", [block], None)
                send("content_block.completed", index=0, block=block)
                send("message.completed")
                log.info("turn %s answered, usage %s", turn.answer_id, json.dumps(outcome.usage))
            else:
                error = api_error(outcome.code, retryable=outcome.retryable) if outcome else api_error("internal_error")
                if outcome:
                    log.warning("turn %s failed: %s", turn.answer_id, outcome.detail)
                blocks = [{"type": "markdown", "text": "".join(answer)}] if answer else []
                await self.store.finish(turn.answer_id, "failed", blocks, error)
                send("message.failed", error=error.model_dump(mode="json"))
            down = isinstance(outcome, Failed) and outcome.code == "assistant_unavailable" and outcome.retryable
            self.breakers.setdefault(profile, Breaker(*self.breaker)).record(not down)
        except Exception:
            log.exception("turn %s could not be stored, reference %s", turn.answer_id, correlation.get())
            send("message.failed", error=api_error("internal_error").model_dump(mode="json"))
        finally:
            queue.put_nowait(None)

    async def _ask(self, connector, agent_conversation: str, question: str, turn: Turn, piece) -> tuple:
        """One attempt: the outcome, and whether the agent got the question."""
        accepted, answering = False, False
        events = connector.send(agent_conversation, question)
        deadline = asyncio.get_running_loop().time() + self.first_word
        try:
            while True:
                limit = asyncio.timeout_at(None if answering else deadline)
                try:
                    async with limit:
                        event = await anext(events)
                except TimeoutError:
                    if not limit.expired():
                        raise  # the whole turn's limit, not the first word's
                    # Counted as received, so a minute's wait is not followed by another.
                    return Failed("assistant_unavailable", True, f"no first word within {self.first_word:.0f} s"), True
                except StopAsyncIteration:
                    return Failed("assistant_unavailable", True, "the agent ended without an answer"), accepted
                if isinstance(event, Accepted):
                    accepted = True
                    await self.store.set_agent_message(turn.answer_id, event.agent_message_id)
                elif isinstance(event, Text):
                    answering = True
                    piece(event.text)
                else:
                    return event, accepted
        finally:
            await events.aclose()


def _emitter(turn: Turn):
    """Builds each event through the message format, so nothing outside it can be sent (D15)."""
    envelope = {"v": 1, "conversation_id": turn.conversation_id, "message_id": turn.answer_id}
    numbers = itertools.count()

    def emit(kind: str, **fields) -> str:
        event = {**envelope, "correlation_id": correlation.get(), "seq": next(numbers), "type": kind, **fields}
        return EVENTS.dump_json(EVENTS.validate_python(event)).decode()

    return emit
