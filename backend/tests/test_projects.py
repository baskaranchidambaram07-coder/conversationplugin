"""Projects: a signed-in visitor's folders of chats (built with M10, on M7's storage)."""

from tests import test_turns
from tests.test_feedback import signed_in
from tests.test_turns import Visitor, events

gateway, widgets = test_turns.gateway, test_turns.widgets  # the same fixtures


def call(visitor: Visitor, method: str, path: str, body: dict | None = None):
    return visitor.client.request(method, path, json=body, headers=visitor.headers)


def project(visitor: Visitor, name: str) -> dict:
    response = call(visitor, "POST", "/v1/projects", {"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_resident_keeps_chats_under_projects_and_finds_them_there(gateway, widgets):
    resident = signed_in(gateway, widgets["open"])
    housing = project(resident, "  Housing  ")
    assert housing["name"] == "Housing"

    inside = call(resident, "POST", "/v1/conversations", {"project_id": housing["id"]}).json()
    loose = resident.conversation()
    events(resident.ask(loose, "Where is the gym?"))
    filed = call(resident, "PATCH", f"/v1/conversations/{loose}", {"project_id": housing["id"]}).json()
    other = resident.conversation()

    assert (inside["project_id"], filed["project_id"]) == (housing["id"], housing["id"])
    listed = resident.get(f"/v1/conversations?project={housing['id']}").json()["conversations"]
    assert {chat["id"] for chat in listed} == {inside["id"], loose}
    everything = resident.get("/v1/conversations").json()["conversations"]
    assert {chat["id"] for chat in everything} == {inside["id"], loose, other}

    unfiled = call(resident, "PATCH", f"/v1/conversations/{loose}", {"project_id": None}).json()
    assert unfiled["project_id"] is None
    assert resident.get(f"/v1/conversations?project={housing['id']}").json()["conversations"][0]["id"] == inside["id"]


def test_projects_are_listed_by_their_latest_activity_renamed_and_deleted_without_losing_chats(gateway, widgets):
    resident = signed_in(gateway, widgets["open"])
    first, second = project(resident, "Fees"), project(resident, "Events")
    chat = call(resident, "POST", "/v1/conversations", {"project_id": first["id"]}).json()["id"]
    events(resident.ask(chat, "When are fees due?"))  # activity in Fees makes it the most recent

    assert [p["name"] for p in resident.get("/v1/projects").json()["projects"]] == ["Fees", "Events"]
    renamed = call(resident, "PATCH", f"/v1/projects/{second['id']}", {"name": "Social"}).json()
    assert renamed["name"] == "Social"

    assert call(resident, "DELETE", f"/v1/projects/{first['id']}").status_code == 204
    assert [p["name"] for p in resident.get("/v1/projects").json()["projects"]] == ["Social"]
    kept = resident.get("/v1/conversations").json()["conversations"]
    assert [(c["id"], c["project_id"]) for c in kept] == [(chat, None)]  # the chat stays, unfiled
    assert len(resident.get(f"/v1/conversations/{chat}/messages").json()["messages"]) == 2


def test_projects_are_for_signed_in_visitors_only(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    chat = visitor.conversation()

    assert visitor.get("/v1/projects").json()["code"] == "forbidden"
    assert call(visitor, "POST", "/v1/projects", {"name": "Mine"}).json()["code"] == "forbidden"
    assert call(visitor, "PATCH", f"/v1/conversations/{chat}", {"project_id": None}).json()["code"] == "forbidden"
    assert call(visitor, "POST", "/v1/conversations", {"project_id": "p_x"}).json()["code"] == "forbidden"
    assert call(visitor, "POST", "/v1/conversations", {"project_id": None}).status_code == 201


def test_nobody_reaches_another_residents_projects_or_files_into_them(gateway, widgets):
    owner, stranger = signed_in(gateway, widgets["open"]), signed_in(gateway, widgets["open"])
    theirs = project(owner, "Private")
    their_chat = owner.conversation()
    mine = stranger.conversation()

    assert stranger.get("/v1/projects").json()["projects"] == []
    assert call(stranger, "PATCH", f"/v1/projects/{theirs['id']}", {"name": "Mine now"}).json()["code"] == "not_found"
    assert call(stranger, "DELETE", f"/v1/projects/{theirs['id']}").json()["code"] == "not_found"
    filing = {"project_id": theirs["id"]}
    assert call(stranger, "PATCH", f"/v1/conversations/{mine}", filing).json()["code"] == "not_found"
    assert call(stranger, "POST", "/v1/conversations", filing).json()["code"] == "not_found"
    unfiling = {"project_id": None}
    assert call(stranger, "PATCH", f"/v1/conversations/{their_chat}", unfiling).json()["code"] == "not_found"
    assert stranger.get(f"/v1/conversations?project={theirs['id']}").json()["conversations"] == []
    assert owner.get("/v1/projects").json()["projects"][0]["name"] == "Private"


def test_a_project_name_is_1_to_80_characters_and_not_only_spaces(gateway, widgets):
    resident = signed_in(gateway, widgets["open"])

    for name in ("", "   ", "x" * 81):
        assert call(resident, "POST", "/v1/projects", {"name": name}).status_code == 400
    assert call(resident, "POST", "/v1/projects", {"name": "x" * 80}).status_code == 201
