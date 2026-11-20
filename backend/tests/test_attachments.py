"""Attachments through the gateway (M10): uploaded, checked, sent with a question to the fake PF, downloaded only by
their owner and only as a download, and never a PF identifier on the way back."""

import asyncio
import secrets

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from fakescan import infected_word_document
from tests import test_turns
from tests.test_files import DOCX, JPEG, PDF, PNG
from tests.test_public import PUBLIC, document
from tests.test_turns import PF_ID, Visitor, events, settings_for, wait_for
from ucp.gateway.app import create_app
from ucp.store import Store
from ucp.widgets import seed

gateway = test_turns.gateway  # the same fixture
BASE = "https://chat.example.net"


@pytest.fixture
def attaching(database_url):
    """A widget that takes attachments, and one that does not."""
    ids = {"on": f"w_{secrets.token_hex(4)}", "off": f"w_{secrets.token_hex(4)}"}
    documents = {
        ids["on"]: document(agent_profile="fake", public={**PUBLIC, "attachments_enabled": True}),
        ids["off"]: document(agent_profile="fake"),
    }

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), documents)
        await engine.dispose()

    asyncio.run(publish())
    return ids


def upload(visitor: Visitor, conversation: str, name: str, data: bytes, kind: str = "application/octet-stream"):
    url = f"/v1/conversations/{conversation}/files"
    headers = {**visitor.headers, "content-type": kind}
    return visitor.client.post(url, params={"name": name}, content=data, headers=headers)


def ask(visitor: Visitor, conversation: str, text: str, attachments: list[str]):
    body = {"text": text, "client_message_id": f"k_{secrets.token_hex(4)}", "attachments": attachments}
    return visitor.client.post(f"/v1/conversations/{conversation}/messages", json=body, headers=visitor.headers)


def test_files_go_with_the_question_to_the_agent_and_come_back_named_on_it(gateway, attaching, fake_pf):
    visitor = Visitor(gateway, attaching["on"])
    conversation = visitor.conversation()
    pdf = upload(visitor, conversation, "Tenancy agreement.pdf", PDF)
    png = upload(visitor, conversation, "../meter reading.png", PNG)
    assert (pdf.status_code, png.status_code) == (201, 201)
    assert png.json() == {
        "type": "file",
        "id": png.json()["id"],
        "name": "meter reading.png",
        "size": len(PNG),
        "content_type": "image/png",
    }

    streamed = events(ask(visitor, conversation, "What do these say?", [pdf.json()["id"], png.json()["id"]]))
    answer = wait_for(visitor, conversation, streamed[0].message_id)

    assert answer.blocks[0].text.endswith("I read Tenancy agreement.pdf, meter reading.png.")  # the agent had them
    received = {item["name"]: item for item in httpx2.get(f"{fake_pf}/_fake/uploads").json().values()}
    assert received["meter reading.png"]["size"] == len(PNG)
    assert received["Tenancy agreement.pdf"]["content_type"] == "application/pdf"
    question = visitor.get(f"/v1/conversations/{conversation}/messages").json()["messages"][0]
    assert [block["type"] for block in question["blocks"]] == ["text", "file", "file"]
    assert [block["name"] for block in question["blocks"][1:]] == ["Tenancy agreement.pdf", "meter reading.png"]
    everything = str(streamed) + str(question) + pdf.text + png.text
    assert not PF_ID.search(everything), "a PF identifier reached the visitor"


def test_a_file_downloads_for_its_owner_only_and_never_opens_in_the_page(gateway, attaching):
    owner, stranger = Visitor(gateway, attaching["on"]), Visitor(gateway, attaching["on"])
    conversation = owner.conversation()
    file = upload(owner, conversation, "Résumé – Zoë.docx", DOCX).json()

    got = owner.get(f"/v1/conversations/{conversation}/files/{file['id']}")
    assert got.status_code == 200 and got.content == DOCX
    assert got.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    saved = "attachment; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20Zo%C3%AB.docx"
    assert got.headers["content-disposition"] == saved
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["content-security-policy"].startswith("default-src 'none'")
    assert got.headers["cache-control"] == "no-store"

    assert stranger.get(f"/v1/conversations/{conversation}/files/{file['id']}").json()["code"] == "not_found"
    assert upload(stranger, conversation, "a.pdf", PDF).json()["code"] == "not_found"


def test_wrong_disguised_oversized_and_unknown_files_are_refused(gateway, attaching):
    visitor = Visitor(gateway, attaching["on"])
    conversation = visitor.conversation()

    assert upload(visitor, conversation, "setup.pdf", b"MZ" + b"\x00" * 64).json()["code"] == "invalid_request"
    assert upload(visitor, conversation, "photo.jpg", PNG).json()["code"] == "invalid_request"
    assert upload(visitor, conversation, "page.html", b"<script>alert(1)</script>").json()["code"] == "invalid_request"
    too_big = PDF + b"\x00" * (10 * 1024 * 1024)
    assert upload(visitor, conversation, "big.pdf", too_big).json()["code"] == "invalid_request"

    other = visitor.conversation()
    elsewhere = upload(visitor, other, "a.jpeg", JPEG).json()["id"]
    assert ask(visitor, conversation, "Read it", [elsewhere]).json()["code"] == "invalid_request"  # not in this chat
    assert ask(visitor, conversation, "Read it", ["f_unknown"]).json()["code"] == "invalid_request"
    six = [upload(visitor, conversation, f"{n}.pdf", PDF).json()["id"] for n in range(6)]
    assert ask(visitor, conversation, "Read them", six).status_code == 400  # at most five with one question


def test_a_widget_without_attachments_takes_none(gateway, attaching):
    visitor = Visitor(gateway, attaching["off"])
    conversation = visitor.conversation()

    assert upload(visitor, conversation, "a.pdf", PDF).json()["code"] == "forbidden"
    assert ask(visitor, conversation, "Read it", ["f_any"]).json()["code"] == "forbidden"


def test_only_the_upload_route_takes_a_large_body(gateway, attaching):
    visitor = Visitor(gateway, attaching["on"])
    conversation = visitor.conversation()

    assert upload(visitor, conversation, "fine.pdf", PDF + b"\x00" * (5 * 1024 * 1024)).status_code == 201
    big_question = {"text": "x", "client_message_id": "k_1", "padding": "x" * (100 * 1024)}
    url = f"/v1/conversations/{conversation}/messages"
    assert gateway.post(url, json=big_question, headers=visitor.headers).json()["code"] == "invalid_request"


def test_a_file_carrying_a_virus_is_refused_and_never_kept(gateway, attaching, fake_pf):
    visitor = Visitor(gateway, attaching["on"])
    conversation = visitor.conversation()

    refused = upload(visitor, conversation, "essay.docx", infected_word_document())

    assert (refused.status_code, refused.json()["code"]) == (422, "unsafe_file")
    assert ask(visitor, conversation, "Read it", ["f_any"]).json()["code"] == "invalid_request"  # nothing to send
    assert "essay.docx" not in str(httpx2.get(f"{fake_pf}/_fake/uploads").json())  # PF never had it


def test_with_no_scanner_answering_every_file_is_refused_unscanned(database_url, fake_pf, attaching):
    with TestClient(create_app(settings_for(database_url, fake_pf, "127.0.0.1:9")), base_url=BASE) as client:
        visitor = Visitor(client, attaching["on"])
        refused = upload(visitor, visitor.conversation(), "lease.pdf", PDF)

    assert (refused.status_code, refused.json()["code"], refused.json()["retryable"]) == (
        503,
        "assistant_unavailable",
        True,
    )
