"""The console's installation checker (M9-T5): fetches one page of the customer's site, as a visitor's browser would,
and says whether the chat can appear there: the page answers, it carries the script tag for this widget, its
content policy lets the chat in, and the site is one the widget allows.

Our server fetches a page an administrator names, so the fetch is fenced: only a page on one of the widget's own
allowed sites, over https (plain http only to this machine, as the widget rules allow for development); never an
address inside a private, link-local or reserved network, checked again for every redirect; at most 1 MB and 10
seconds. The page is read, never run.
"""

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit

import httpx2

LOCAL = {"localhost", "127.0.0.1"}
MOST = 1_000_000
REDIRECTS = 3


class Refused(ValueError):
    """The page may not be fetched: the reason, in the console's words."""


def allowed_by(page: str, sites: list[str]) -> bool:
    """Whether the page's origin is one of the widget's allowed sites (a "*." site covers its subdomains)."""
    parts = urlsplit(page)
    origin = f"{parts.scheme}://{parts.hostname}" + (f":{parts.port}" if parts.port else "")
    for site in sites:
        if site == origin:
            return True
        if "://*." in site:
            scheme, suffix = site.split("://*.", 1)
            host, _, port = suffix.partition(":")
            if parts.scheme == scheme and (parts.hostname or "").endswith(f".{host}") and str(parts.port or "") == port:
                return True
    return False


async def _public(host: str, local: bool) -> None:
    """Refuses a host that resolves to an address no customer's public page has (except this machine, for local)."""
    try:
        found = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as error:
        raise Refused("the site's name does not resolve") from error
    for *_, address in found:
        ip = ipaddress.ip_address(address[0])
        if local and ip.is_loopback:
            continue
        if not ip.is_global:
            raise Refused("the site resolves to an address inside a private network")


def _fenced(page: str, sites: list[str]) -> bool:
    """Whether the page may be fetched at all; returns whether it is a local development page."""
    parts = urlsplit(page)
    local = parts.scheme == "http" and parts.hostname in LOCAL
    if parts.scheme != "https" and not local:
        raise Refused("the page must be on https")
    if not allowed_by(page, sites):
        raise Refused("the page is not on one of this widget's allowed sites")
    return local


async def fetch(client: httpx2.AsyncClient, page: str, sites: list[str]) -> tuple[str, dict[str, str], str]:
    """The page's final address, headers and HTML, following at most three redirects, each fenced again."""
    for _ in range(REDIRECTS + 1):
        local = _fenced(page, sites)
        await _public(urlsplit(page).hostname or "", local)
        # shortcut: the name is resolved again to connect, so a site switching its address between the two (DNS
        # rebinding) could slip past; pin the connection to the checked address if the checker is ever exposed wider.
        async with client.stream("GET", page, follow_redirects=False, timeout=10) as reply:
            if reply.is_redirect and reply.headers.get("location"):
                page = urljoin(page, reply.headers["location"])
                continue
            if reply.status_code != 200:
                raise Refused(f"the page answered with status {reply.status_code}")
            body = b""
            async for chunk in reply.aiter_bytes():
                body += chunk
                if len(body) > MOST:
                    raise Refused("the page is larger than 1 MB")
            return page, dict(reply.headers), body.decode(reply.encoding or "utf-8", errors="replace")
    raise Refused("the page redirects too many times")


def _policy(headers: dict[str, str], html: str) -> str | None:
    meta = re.search(r"""<meta[^>]+http-equiv=["']content-security-policy["'][^>]+content=["']([^"']+)""", html, re.I)
    return headers.get("content-security-policy") or (meta.group(1) if meta else None)


def _lets_in(policy: str, directive: str, origin: str) -> bool:
    rules = {part.split()[0].lower(): part.split()[1:] for part in policy.split(";") if part.split()}
    sources = rules.get(directive, rules.get("default-src"))
    if sources is None:
        return True  # neither the directive nor default-src: the policy does not limit it
    scheme = urlsplit(origin).scheme + ":"
    return any(source in (origin, origin + "/", "*", scheme) for source in sources)


def checks(page: str, headers: dict[str, str], html: str, widget_id: str, gateway: str) -> list[dict]:
    """What the page tells about the chat's installation, one check each, with advice when it fails."""
    loader = re.search(rf"""<script[^>]+src=["']{re.escape(gateway)}/loader\.js["'][^>]*>""", html, re.I)
    tagged = bool(loader and f'data-widget-id="{widget_id}"' in loader.group(0)) or (
        bool(loader) and re.search(rf"""widgetId:\s*["']{re.escape(widget_id)}["']""", html) is not None
    )
    found = [
        {"check": "page", "ok": True, "detail": page},
        {"check": "script", "ok": tagged, "detail": None if tagged else "add the script tag for this widget"},
    ]
    policy = _policy(headers, html)
    if policy:
        missing = [d for d in ("script-src", "frame-src", "connect-src") if not _lets_in(policy, d, gateway)]
        detail = f"add {gateway} to {', '.join(missing)}" if missing else None
        found.append({"check": "policy", "ok": not missing, "detail": detail})
    else:
        found.append({"check": "policy", "ok": True, "detail": "the page sets no content policy"})
    return found
