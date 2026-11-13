"""Storage against PostgreSQL (M4 integration, M7 core): migrations, widget versions, ownership, turns, paging."""

import asyncio
import secrets

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import create_async_engine

from ucp import migrate
from ucp.gateway.app import create_app
from ucp.protocol import ApiError
from ucp.settings import Settings
from ucp.store import STALE, Owner, Store, TurnInProgress, messages, metadata

pytestmark = pytest.mark.anyio


def owner(**changes) -> Owner:
    base = {"tenant_id": "t_one", "widget_id": "w_one", "user_id": f"u_{secrets.token_hex(4)}"}
    return Owner(**{**base, **changes})


async def test_migrations_go_down_and_up_and_leave_the_database_exactly_as_the_models_describe(database_url):
    await asyncio.to_thread(migrate.downgrade, database_url)
    await asyncio.to_thread(migrate.upgrade, database_url)

    engine = create_async_engine(database_url)
    async with engine.connect() as db:
        differences = await db.run_sync(lambda sync: compare_metadata(MigrationContext.configure(sync), metadata))
    await engine.dispose()
    assert differences == []


async def test_a_widget_gets_a_new_version_only_when_its_document_changes(store: Store):
    widget_id = f"w_{secrets.token_hex(4)}"

    assert await store.widget(widget_id) is None
    assert await store.publish_widget(widget_id, "t_one", {"title": "A"}) == 1
    assert await store.publish_widget(widget_id, "t_one", {"title": "A"}) == 1
    assert await store.publish_widget(widget_id, "t_one", {"title": "B"}) == 2
    assert tuple(await store.widget(widget_id)) == (2, "t_one", {"title": "B"})


async def test_a_conversation_is_found_only_by_its_owner(store: Store):
    mine = owner()
    conversation = await store.create_conversation(mine)

    assert (await store.conversation(mine, conversation.id)).id == conversation.id
    for stranger in (
        owner(),
        owner(user_id=mine.user_id, tenant_id="t_two"),
        owner(user_id=mine.user_id, widget_id="w_x"),
    ):
        assert await store.conversation(stranger, conversation.id) is None
        assert await store.start_turn(stranger, conversation.id, "k1", "Hello", 1) is None
        assert await store.messages(stranger, conversation.id, None, 10) == ([], None)


async def test_a_turn_stores_the_question_and_an_empty_answer_and_a_repeat_returns_the_same_turn(store: Store):
    mine = owner()
    conversation = await store.create_conversation(mine)

    turn = await store.start_turn(mine, conversation.id, "k1", "When does the library open?", 3)
    again = await store.start_turn(mine, conversation.id, "k1", "When does the library open?", 3)

    assert not turn.repeat and again.repeat
    assert (again.question_id, again.answer_id) == (turn.question_id, turn.answer_id)
    page, older = await store.messages(mine, conversation.id, None, 10)
    assert [(m.role, m.status, [b.model_dump() for b in m.blocks]) for m in page] == [
        ("user", "complete", [{"type": "text", "text": "When does the library open?"}]),
        ("assistant", "in_progress", []),
    ]
    assert older is None
    assert (await store.conversation(mine, conversation.id)).title == "When does the library open?"


async def test_one_turn_at_a_time_even_when_questions_arrive_together(store: Store):
    # Many rounds, since the race this guards against only shows when the timing lines up.
    mine = owner()
    for _ in range(25):
        conversation = await store.create_conversation(mine)

        results = await asyncio.gather(
            *(store.start_turn(mine, conversation.id, f"k{n}", "Hi", 1) for n in range(4)), return_exceptions=True
        )

        assert sorted(type(result).__name__ for result in results) == ["Turn"] + ["TurnInProgress"] * 3
        with pytest.raises(TurnInProgress):
            await store.start_turn(mine, conversation.id, "k9", "Hi again", 1)


async def test_the_same_question_sent_several_times_at_once_is_one_turn(store: Store):
    mine = owner()
    for _ in range(25):
        conversation = await store.create_conversation(mine)

        turns = await asyncio.gather(*(store.start_turn(mine, conversation.id, "k1", "Hi", 1) for _ in range(4)))

        assert sorted(turn.repeat for turn in turns) == [False, True, True, True]
        assert len({(turn.question_id, turn.answer_id) for turn in turns}) == 1
        page, _ = await store.messages(mine, conversation.id, None, 10)
        assert [message.role for message in page] == ["user", "assistant"]


async def test_a_finished_answer_frees_the_conversation_and_reads_back_without_any_pf_detail(store: Store):
    mine = owner()
    conversation = await store.create_conversation(mine)
    first = await store.start_turn(mine, conversation.id, "k1", "Hi", 1)
    error = ApiError(code="assistant_unavailable", message="x", retryable=True, retry_after=None, reference="r_1")
    await store.finish(first.answer_id, "failed", [{"type": "markdown", "text": "Partial"}], error, "pf-message-id")

    second = await store.start_turn(mine, conversation.id, "k2", "Again", 1)
    answer = await store.message(mine, conversation.id, first.answer_id)

    assert not second.repeat
    assert answer.model_dump(mode="json").keys() == {"id", "role", "status", "blocks", "error", "created_at"}
    assert (answer.status, answer.error.code, answer.blocks[0].text) == ("failed", "assistant_unavailable", "Partial")
    assert "pf-message-id" not in answer.model_dump_json()


async def test_messages_come_in_pages_oldest_first_with_a_cursor_to_the_page_above(store: Store):
    mine = owner()
    conversation = await store.create_conversation(mine)
    for n in range(3):
        turn = await store.start_turn(mine, conversation.id, f"k{n}", f"Question {n}", 1)
        await store.finish(turn.answer_id, "complete", [{"type": "markdown", "text": f"Answer {n}"}], None)

    newest, older = await store.messages(mine, conversation.id, None, 4)
    oldest, none = await store.messages(mine, conversation.id, older, 4)

    def texts(page):
        return [m.blocks[0].text for m in page]

    assert texts(newest) == ["Question 1", "Answer 1", "Question 2", "Answer 2"]
    assert texts(oldest) == ["Question 0", "Answer 0"] and none is None


async def test_conversations_are_listed_most_recent_first_in_pages(store: Store):
    mine = owner()
    made = [await store.create_conversation(mine) for _ in range(3)]
    await store.start_turn(mine, made[0].id, "k", "Bring the first one to the top", 1)

    first = await store.conversations(mine, None, 2)
    rest = await store.conversations(mine, first[-1].updated_at, 2)

    assert [c.id for c in first + rest] == [made[0].id, made[2].id, made[1].id]


def test_ready_only_when_the_database_answers(database_url):
    with TestClient(create_app(Settings(database_url=database_url))) as client:
        assert client.get("/readyz").json() == {"status": "ok"}
    with TestClient(create_app(Settings())) as client:
        response = client.get("/readyz")
        assert response.status_code == 503 and response.json()["code"] == "assistant_unavailable"


async def test_an_answer_left_in_progress_by_a_stopped_gateway_does_not_block_the_conversation_for_ever(store: Store):
    mine = owner()
    conversation = await store.create_conversation(mine)
    abandoned = await store.start_turn(mine, conversation.id, "k1", "Hi", 1)
    async with store.engine.begin() as db:
        await db.execute(
            update(messages).where(messages.c.id == abandoned.answer_id).values(updated_at=func.now() - STALE)
        )

    assert not (await store.start_turn(mine, conversation.id, "k2", "Hello?", 1)).repeat
    left = await store.message(mine, conversation.id, abandoned.answer_id)
    assert (left.status, left.error.code, left.error.retryable) == ("failed", "assistant_unavailable", True)
