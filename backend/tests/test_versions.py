"""Versions, rollback and the audit log (M8-T3, T7, T9) against PostgreSQL, through the operator's command too."""

import json
import re
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_public import PUBLIC, document
from ucp.gateway.app import create_app
from ucp.sessions import Keys
from ucp.settings import Settings
from ucp.widgets import Widgets, run, seed

pytestmark = pytest.mark.anyio


@pytest.fixture
def widget_id():
    return f"w_{secrets.token_hex(4)}"


def titled(title: str) -> dict:
    return document(public={**PUBLIC, "title": title})


async def test_each_publish_and_rollback_is_a_new_version_with_who_did_it_in_the_audit_log(store, widget_id):
    await seed(store, {widget_id: titled("One")}, "ana")
    await seed(store, {widget_id: titled("One")}, "ana")  # nothing changed: no version, no entry
    await seed(store, {widget_id: titled("Two")}, "ben")

    assert await store.rollback_widget(widget_id, 1, "cy") == 3
    assert await store.rollback_widget(widget_id, 9, "cy") is None

    assert [(v.version, v.published_by) for v in await store.widget_versions(widget_id)] == [
        (3, "cy"),
        (2, "ben"),
        (1, "ana"),
    ]
    assert (await store.widget(widget_id)).document == titled("One")
    entries = await store.audit_entries(widget_id)
    assert [(e.actor, e.action, e.version, e.detail) for e in entries] == [
        ("cy", "rollback", 3, {"to_version": 1}),
        ("ben", "publish", 2, None),
        ("ana", "publish", 1, None),
    ]
    assert {e.tenant_id for e in entries} == {"t_college"} and all(e.at for e in entries)


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit SET actor = 'someone else'",
        "DELETE FROM audit",
        "TRUNCATE audit",
        "UPDATE widgets SET document = '{}'",
        "DELETE FROM widgets",
        "TRUNCATE widgets CASCADE",
    ],
)
async def test_published_versions_and_the_audit_log_cannot_be_changed_or_removed(store, widget_id, statement):
    await seed(store, {widget_id: titled("One")}, "ana")

    with pytest.raises(Exception, match="only grows"):
        async with store.engine.begin() as db:
            await db.execute(text(statement))

    assert [e.actor for e in await store.audit_entries(widget_id)] == ["ana"]
    assert (await store.widget(widget_id)).document == titled("One")


async def test_the_operators_command_publishes_lists_rolls_back_and_reads_the_log(store, widget_id, tmp_path):
    path = tmp_path / "widgets.json"
    for version, title in enumerate(("One", "Two"), start=1):
        path.write_text(json.dumps({"widgets": {widget_id: titled(title)}}), encoding="utf-8")
        assert await run(store, ["seed", str(path), "--by", "ana"]) == [f"{widget_id}: version {version}"]

    assert await run(store, ["rollback", widget_id, "1", "--by", "ben"]) == [
        f"{widget_id}: version 3 is live, the same as version 1"
    ]
    listed = await run(store, ["versions", widget_id])
    log = await run(store, ["audit", "--widget", widget_id])

    assert [line.split()[0] for line in listed] == ["3", "2", "1"] and listed[0].endswith("ben")
    assert [line.split("  ")[1:4] for line in log] == [
        ["ben", "rollback", f"{widget_id} version 3"],
        ["ana", "publish", f"{widget_id} version 2"],
        ["ana", "publish", f"{widget_id} version 1"],
    ]
    assert log[0].endswith("(as version 1)")


async def test_the_command_refuses_what_it_cannot_do_and_says_why(store, widget_id, tmp_path):
    # A version published before today's rules (here, straight into storage) is not served again.
    await store.publish_widget(widget_id, "t_college", document(allowed_domains=["https://*.com"]), "old")
    await seed(store, {widget_id: titled("Two")}, "ana")
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"widgets": {widget_id: document(allowed_domains=["http://example.org"])}}))

    for argv, reason in (
        (["rollback", widget_id, "1"], "breaks today's rules"),
        (["rollback", widget_id, "7"], "has no version 7"),
        (["versions", "w_nobody"], "no widget w_nobody"),
        (["seed", str(bad)], "nothing was published"),
    ):
        with pytest.raises(SystemExit, match=reason):
            await run(store, argv)
    assert [v.version for v in await store.widget_versions(widget_id)] == [2, 1]


async def test_a_published_change_and_a_rollback_both_reach_visitors(database_url, store, widget_id, monkeypatch):
    monkeypatch.setattr(Widgets, "TTL", 0)  # the gateway's 30-second cache, lapsed at once
    await seed(store, {widget_id: titled("Before")}, "ana")
    with TestClient(create_app(Settings(database_url=database_url))) as gateway:

        def title() -> str:
            return gateway.get(f"/v1/widgets/{widget_id}/config").json()["title"]

        assert title() == "Before"
        await seed(store, {widget_id: titled("After")}, "ana")
        assert title() == "After"
        await store.rollback_widget(widget_id, 1, "ben")
        assert title() == "Before"


async def test_an_export_is_the_live_configuration_and_publishing_it_again_changes_nothing(store, widget_id, tmp_path):
    other = f"w_{secrets.token_hex(4)}"
    await seed(store, {widget_id: titled("One"), other: titled("Other")}, "ana")
    await seed(store, {widget_id: titled("Two")}, "ana")
    path = tmp_path / "export.json"

    assert await run(store, ["export", "--out", str(path)]) == [f"exported every widget's current document to {path}"]
    exported = json.loads(path.read_text(encoding="utf-8"))["widgets"]
    assert (exported[widget_id], exported[other]) == (titled("Two"), titled("Other"))
    ours = {key: exported[key] for key in (widget_id, other)}  # the database also holds other tests' widgets

    assert await seed(store, ours, "ben") == {widget_id: 2, other: 1}  # the same documents: no new versions
    assert json.loads((await run(store, ["export"]))[0])["widgets"][widget_id] == titled("Two")


async def test_new_ids_and_secrets_are_fresh_each_time_and_in_the_form_the_gateway_reads(store):
    ids = [(await run(store, ["new-id"]))[0] for _ in range(2)]
    entries = [(await run(store, ["new-secret", "--id", "k2"]))[0] for _ in range(2)]
    dated = (await run(store, ["new-secret"]))[0]

    assert ids[0] != ids[1] and all(re.fullmatch(r"w_[A-Za-z0-9_-]{22}", widget) for widget in ids)
    assert entries[0] != entries[1] and all(entry.startswith("k2:") for entry in entries)
    assert re.fullmatch(r"k20\d{6}", dated.split(":")[0])
    keys = Keys(",".join(entries))  # the format UCP_HOST_SECRETS and UCP_SESSION_KEYS take, at full length
    assert all(len(secret) >= 32 for secret in keys.keys.values())
