"""Rating answers (M4-T10): like or dislike, with a comment, tied to the question and answer, for every visitor."""

import asyncio
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from tests import test_turns
from tests.conftest import TEST_DATABASE_URL
from tests.test_sessions import KEYS
from tests.test_turns import Visitor, events, wait_for
from ucp.sessions import Keys, Session
from ucp.store import feedback

gateway, widgets = test_turns.gateway, test_turns.widgets  # the same fixtures


def stored(message_id: str):
    async def read():
        engine = create_async_engine(TEST_DATABASE_URL)
        async with engine.connect() as db:
            row = (await db.execute(select(feedback).where(feedback.c.message_id == message_id))).first()
        await engine.dispose()
        return row

    return asyncio.run(read())


def answered(visitor: Visitor) -> tuple[str, str, str]:
    """A finished turn: the conversation, the question's ID and the answer's ID."""
    conversation = visitor.conversation()
    answer = events(visitor.ask(conversation, "When is the library open?"))[0].message_id
    wait_for(visitor, conversation, answer)
    page = visitor.get(f"/v1/conversations/{conversation}/messages").json()["messages"]
    return conversation, page[0]["id"], answer


def rate(visitor: Visitor, conversation: str, message: str, body: dict):
    url = f"/v1/conversations/{conversation}/messages/{message}/feedback"
    return visitor.client.put(url, json=body, headers=visitor.headers)


def signed_in(client, widget_id: str) -> Visitor:
    visitor = Visitor.__new__(Visitor)
    visitor.client = client
    token = Keys(KEYS).issue(Session(f"u_{secrets.token_hex(4)}", "t_college", widget_id, 1, "signed_in"))
    visitor.headers = {"authorization": f"Bearer {token}"}
    return visitor


def test_a_public_visitors_rating_is_stored_as_anonymous_with_its_question_answer_and_comment(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation, question, answer = answered(visitor)

    assert rate(visitor, conversation, answer, {"rating": "dislike", "comment": "  Too vague.  "}).status_code == 204

    row = stored(answer)
    assert (row.question_id, row.conversation_id) == (question, conversation)
    assert (row.rating, row.comment) == ("dislike", "Too vague.")
    assert (row.user_kind, row.widget_id, row.tenant_id) == ("anonymous", widgets["open"], "t_college")
    message = visitor.get(f"/v1/conversations/{conversation}/messages/{answer}").json()
    assert message["feedback"] == "dislike"


def test_a_signed_in_visitors_rating_is_stored_under_them_and_a_second_rating_replaces_the_first(gateway, widgets):
    visitor = signed_in(gateway, widgets["open"])
    conversation, _, answer = answered(visitor)

    rate(visitor, conversation, answer, {"rating": "dislike", "comment": "Wrong hours."})
    assert rate(visitor, conversation, answer, {"rating": "like"}).status_code == 204

    row = stored(answer)
    assert (row.user_kind, row.rating, row.comment) == ("signed_in", "like", None)
    page = visitor.get(f"/v1/conversations/{conversation}/messages").json()["messages"]
    assert [message["feedback"] for message in page] == [None, "like"]


def test_a_rating_can_be_taken_back(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation, _, answer = answered(visitor)
    rate(visitor, conversation, answer, {"rating": "like"})

    url = f"/v1/conversations/{conversation}/messages/{answer}/feedback"
    assert gateway.delete(url, headers=visitor.headers).status_code == 204

    assert stored(answer) is None
    assert visitor.get(f"/v1/conversations/{conversation}/messages/{answer}").json()["feedback"] is None


def test_only_the_visitors_own_finished_answers_can_be_rated(gateway, widgets):
    visitor, stranger = Visitor(gateway, widgets["open"]), Visitor(gateway, widgets["open"])
    conversation, question, answer = answered(visitor)
    like = {"rating": "like"}

    assert rate(stranger, conversation, answer, like).json()["code"] == "not_found"
    assert rate(visitor, conversation, question, like).json()["code"] == "not_found"  # a question is not an answer
    assert rate(visitor, conversation, "m_nothing", like).json()["code"] == "not_found"
    stranger_url = f"/v1/conversations/{conversation}/messages/{answer}/feedback"
    assert stored(answer) is None

    rate(visitor, conversation, answer, like)
    gateway.delete(stranger_url, headers=stranger.headers)  # someone else cannot take it back
    assert stored(answer).rating == "like"


def test_a_rating_must_be_like_or_dislike_and_a_comment_at_most_1000_characters(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation, _, answer = answered(visitor)

    assert rate(visitor, conversation, answer, {"rating": "meh"}).status_code == 400
    assert rate(visitor, conversation, answer, {"rating": "like", "comment": "x" * 1001}).status_code == 400
    assert rate(visitor, conversation, answer, {"rating": "like", "comment": "x" * 1000}).status_code == 204
