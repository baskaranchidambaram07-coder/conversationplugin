"""Pinned answers: a signed-in visitor keeps answers to find them again (built with M10, on M7's storage)."""

from tests import test_turns
from tests.test_feedback import answered, signed_in
from tests.test_turns import Visitor

gateway, widgets = test_turns.gateway, test_turns.widgets  # the same fixtures


def pin(visitor: Visitor, conversation: str, message: str, method: str = "PUT"):
    url = f"/v1/conversations/{conversation}/messages/{message}/pin"
    return visitor.client.request(method, url, headers=visitor.headers)


def test_a_pinned_answer_is_listed_with_its_question_and_chat_and_marked_where_it_stands(gateway, widgets):
    resident = signed_in(gateway, widgets["open"])
    first, _, first_answer = answered(resident)
    second, _, second_answer = answered(resident)

    assert pin(resident, first, first_answer).status_code == 204
    assert pin(resident, second, second_answer).status_code == 204
    assert pin(resident, second, second_answer).status_code == 204  # pinning again changes nothing

    pins = resident.get("/v1/pins").json()["pins"]
    listed = [(p["conversation"]["id"], p["message"]["id"]) for p in pins]
    assert listed == [(second, second_answer), (first, first_answer)]
    newest = pins[0]
    assert newest["question"] == "When is the library open?"
    assert newest["conversation"]["title"] == "When is the library open?"
    assert newest["message"]["pinned"] is True and newest["message"]["role"] == "assistant"
    page = resident.get(f"/v1/conversations/{second}/messages").json()["messages"]
    assert [message["pinned"] for message in page] == [False, True]


def test_an_unpinned_answer_leaves_the_list(gateway, widgets):
    resident = signed_in(gateway, widgets["open"])
    conversation, _, answer = answered(resident)
    pin(resident, conversation, answer)

    assert pin(resident, conversation, answer, "DELETE").status_code == 204

    assert resident.get("/v1/pins").json()["pins"] == []
    assert resident.get(f"/v1/conversations/{conversation}/messages/{answer}").json()["pinned"] is False


def test_only_a_residents_own_finished_answers_can_be_pinned(gateway, widgets):
    resident, stranger = signed_in(gateway, widgets["open"]), signed_in(gateway, widgets["open"])
    conversation, question, answer = answered(resident)

    assert pin(stranger, conversation, answer).json()["code"] == "not_found"
    assert pin(resident, conversation, question).json()["code"] == "not_found"  # a question is not an answer
    pin(resident, conversation, answer)
    pin(stranger, conversation, answer, "DELETE")  # someone else cannot unpin it

    assert stranger.get("/v1/pins").json()["pins"] == []
    assert len(resident.get("/v1/pins").json()["pins"]) == 1


def test_pins_are_for_signed_in_visitors_only(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation, _, answer = answered(visitor)

    assert visitor.get("/v1/pins").json()["code"] == "forbidden"
    assert pin(visitor, conversation, answer).json()["code"] == "forbidden"
    assert pin(visitor, conversation, answer, "DELETE").json()["code"] == "forbidden"
