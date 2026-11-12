"""Public settings, the chat page and the static files (M4-T3, M4-T8): backend and security tests."""

import json
import secrets

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ucp.gateway.app import create_app
from ucp.protocol import SCHEMA_FILE, WidgetConfig
from ucp.settings import Settings
from ucp.widgets import Widgets, seed

EXAMPLE = json.loads((SCHEMA_FILE.parents[1] / "examples/v1/WidgetConfig/valid/full.json").read_text(encoding="utf-8"))
PUBLIC = {key: value for key, value in EXAMPLE.items() if key not in ("v", "widget_id")}


def document(**changes) -> dict:
    return {
        "tenant_id": "t_college",
        "public": PUBLIC,
        "allowed_domains": ["https://www.example.org", "https://*.example.ac.uk"],
        "sign_in": "anonymous",
        "agent_profile": "pf-staging",
        **changes,
    }


@pytest.fixture
def web(tmp_path):
    (tmp_path / "loader/dist").mkdir(parents=True)
    (tmp_path / "widget/dist/assets").mkdir(parents=True)
    (tmp_path / "loader/dist/loader.js").write_text("/* loader */")
    (tmp_path / "widget/dist/index.html").write_text("<!doctype html><title>Chat</title>")
    (tmp_path / "widget/dist/assets/index-abc123.js").write_text("/* chat */")
    (tmp_path / "widget/dist/secret.txt").write_text("not an asset")
    return tmp_path


@pytest.fixture
def widget_id():
    return f"w_{secrets.token_hex(4)}"


@pytest.fixture
async def client(database_url, store, web, widget_id):
    await seed(store, {widget_id: document()})
    with TestClient(create_app(Settings(database_url=database_url, web_dir=web))) as client:
        yield client


@pytest.mark.anyio
async def test_the_config_is_exactly_the_public_settings_readable_from_any_site(client, widget_id):
    response = client.get(f"/v1/widgets/{widget_id}/config")

    assert response.status_code == 200
    assert WidgetConfig.model_validate_json(response.content).model_dump(mode="json") == {
        **EXAMPLE,
        "widget_id": widget_id,
    }
    for private in ("t_college", "allowed_domains", "pf-staging", "sign_in", "limits"):
        assert private not in response.text
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["cache-control"] == "public, max-age=60"


@pytest.mark.anyio
async def test_an_unknown_widget_reveals_nothing_and_the_loader_can_still_read_that(client):
    response = client.get("/v1/widgets/w_nobody/config")

    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert response.headers["access-control-allow-origin"] == "*"
    assert client.get("/embed/w_nobody").status_code == 404


@pytest.mark.anyio
async def test_the_chat_page_may_be_framed_only_by_the_widgets_sites_and_loads_only_from_us(client, widget_id):
    response = client.get(f"/embed/{widget_id}")

    assert response.status_code == 200 and response.text.startswith("<!doctype html>")
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; "
        "img-src 'self' https://example.org; base-uri 'none'; form-action 'none'; "
        "frame-ancestors https://www.example.org https://*.example.ac.uk"
    )


@pytest.mark.anyio
async def test_the_loader_and_chat_files_are_served_with_caching_that_fits_their_names(client):
    loader = client.get("/loader.js")
    asset = client.get("/assets/index-abc123.js")

    assert loader.text == "/* loader */" and loader.headers["cache-control"] == "public, max-age=300"
    assert asset.text == "/* chat */" and asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert asset.headers["content-type"] == "text/javascript; charset=utf-8"
    for wrong in ("/assets/missing.js", "/assets/..", "/assets/..%2Fsecret.txt", "/assets/%2E%2E%2Fsecret.txt"):
        response = client.get(wrong)
        assert response.status_code == 404 and "not an asset" not in response.text, wrong


@pytest.mark.parametrize(
    "change",
    [
        {"allowed_domains": ["https://www.example.org; script-src *"]},
        {"allowed_domains": ["https://www.example.org 'unsafe-inline'"]},
        {"allowed_domains": []},
        {"public": {**PUBLIC, "brand_color": "red"}},
        {"public": {**PUBLIC, "workspace_id": "leaked"}},
        {"sign_in": "anyone"},
        {"secret": "extra field"},
    ],
    ids=lambda change: next(iter(change)),
)
@pytest.mark.anyio
async def test_seeding_refuses_a_bad_widget_and_publishes_none_of_the_file(store, change):
    good, bad = f"w_{secrets.token_hex(4)}", f"w_{secrets.token_hex(4)}"

    with pytest.raises(ValidationError):
        await seed(store, {good: document(), bad: document(**change)})
    assert await store.widget(good) is None


@pytest.mark.anyio
async def test_a_newly_published_version_is_picked_up_once_the_cache_lapses(store, widget_id):
    await seed(store, {widget_id: document()})
    widgets = Widgets(store)
    assert (await widgets.get(widget_id)).config.title == PUBLIC["title"]

    await seed(store, {widget_id: document(public={**PUBLIC, "title": "Ask Us"})})
    assert (await widgets.get(widget_id)).config.title == PUBLIC["title"]  # still cached
    widgets.TTL = 0
    fresh = await widgets.get(widget_id)
    assert (fresh.version, fresh.config.title) == (2, "Ask Us")
