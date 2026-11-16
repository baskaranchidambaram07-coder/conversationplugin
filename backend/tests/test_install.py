"""The console's installation checker (M9-T5): which pages it may fetch, and what it reads in them."""

import httpx2
import pytest

from ucp.admin import install

pytestmark = pytest.mark.anyio
GATEWAY = "https://chat.example.net"
SITES = ["https://www.example.ac.uk", "https://*.example.ac.uk", "http://127.0.0.1:4174"]
TAGGED = f'<script async src="{GATEWAY}/loader.js" data-widget-id="w_1"></script>'


@pytest.fixture
def anyio_backend():
    return "asyncio"


def client(pages: dict[str, httpx2.Response]) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(transport=httpx2.MockTransport(lambda request: pages[str(request.url)]))


@pytest.fixture
def public(monkeypatch):
    """Every name resolves to a public address, so these tests need no network."""

    async def fine(host, local):
        return None

    monkeypatch.setattr(install, "_public", fine)


def test_only_the_widgets_own_sites_count():
    assert install.allowed_by("https://www.example.ac.uk/residents", SITES)
    assert install.allowed_by("https://portal.example.ac.uk/", SITES)
    assert not install.allowed_by("https://example.ac.uk.evil.example/", SITES)
    assert not install.allowed_by("https://evilexample.ac.uk/", SITES)
    assert not install.allowed_by("http://www.example.ac.uk/", SITES)


@pytest.mark.parametrize(
    ("page", "why"),
    [
        ("http://www.example.ac.uk/", "must be on https"),
        ("https://elsewhere.example/", "not on one of this widget's allowed sites"),
    ],
)
async def test_a_page_off_the_widgets_sites_or_not_on_https_is_never_fetched(page, why):
    with pytest.raises(install.Refused, match=why):
        await install.fetch(client({}), page, SITES)


@pytest.mark.parametrize("address", ["10.0.0.5", "169.254.170.2", "192.168.1.1", "127.0.0.1"])
async def test_a_site_inside_a_private_network_is_never_fetched(address):
    with pytest.raises(install.Refused, match="private network"):
        await install.fetch(client({}), f"https://{address}/", [f"https://{address}"])


async def test_a_redirect_off_the_widgets_sites_is_refused(public):
    pages = {"https://www.example.ac.uk/": httpx2.Response(302, headers={"location": "https://elsewhere.example/"})}

    with pytest.raises(install.Refused, match="allowed sites"):
        await install.fetch(client(pages), "https://www.example.ac.uk/", SITES)


async def test_a_page_with_the_script_tag_and_a_policy_that_lets_the_chat_in_passes(public):
    policy = f"default-src 'self'; script-src 'self' {GATEWAY}; frame-src {GATEWAY}; connect-src 'self' {GATEWAY}"
    page = httpx2.Response(200, html=f"<p>Hello</p>{TAGGED}", headers={"content-security-policy": policy})
    found = await install.fetch(client({"https://www.example.ac.uk/": page}), "https://www.example.ac.uk/", SITES)

    assert [(c["check"], c["ok"]) for c in install.checks(*found, "w_1", GATEWAY)] == [
        ("page", True), ("script", True), ("policy", True)
    ]  # fmt: skip


async def test_a_missing_tag_or_a_policy_that_shuts_the_chat_out_is_named(public):
    policy = f"default-src 'self'; script-src 'self' {GATEWAY}"
    page = httpx2.Response(200, html='<script src="/app.js"></script>', headers={"content-security-policy": policy})
    found = await install.fetch(client({"https://www.example.ac.uk/": page}), "https://www.example.ac.uk/", SITES)

    checks = {c["check"]: c for c in install.checks(*found, "w_1", GATEWAY)}
    assert checks["script"]["detail"] == "add the script tag for this widget"
    assert checks["policy"]["detail"] == f"add {GATEWAY} to frame-src, connect-src"


async def test_a_local_development_page_may_be_checked():
    page = httpx2.Response(200, html=TAGGED)
    found = await install.fetch(
        client({"http://127.0.0.1:4174/hosts/plain.html": page}), "http://127.0.0.1:4174/hosts/plain.html", SITES
    )

    assert all(c["ok"] for c in install.checks(*found, "w_1", GATEWAY))
