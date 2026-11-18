"""What anyone may fetch without a session (M4-T3): a widget's display settings, the chat page, and the loader and
chat files. One origin serves them all, so a customer's content policy needs only that origin."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Request
from fastapi import Path as InPath
from fastapi.responses import FileResponse, JSONResponse, Response

from ucp.gateway.pipeline import Problem, problem_response
from ucp.protocol import ApiError, Id, WidgetConfig
from ucp.widgets import Widget, Widgets

router = APIRouter()

ASSET_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2"}


def chat_policy(widget: Widget) -> str:
    """The chat needs only its own origin, plus the host of the widget's logo. Only the widget's allowed sites may
    frame it; the browser refuses to show it anywhere else (threat model T3)."""
    images = " ".join(filter(None, ["'self'", "blob:", widget.logo_origin]))  # blob: a picture the visitor attached
    return (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; "
        f"img-src {images}; base-uri 'none'; form-action 'none'; "
        f"frame-ancestors {' '.join(widget.document.allowed_domains)}"
    )


def widgets_of(request: Request) -> Widgets:
    widgets: Widgets | None = getattr(request.app.state, "widgets", None)
    if not widgets:
        raise Problem("assistant_unavailable", retryable=True)
    return widgets


@router.get(
    "/v1/widgets/{widget_id}/config",
    response_model=WidgetConfig,
    responses={404: {"model": ApiError}},
    summary="A widget's display settings, read by the loader on the customer's page",
)
async def config(widget_id: Id, request: Request) -> Response:
    # Read from the customer's page, so any origin may read it, without cookies. Only the public part is sent.
    shared = {"access-control-allow-origin": "*"}
    widget = await widgets_of(request).get(widget_id)
    if not widget:
        response = problem_response(Problem("not_found"))
        response.headers.update(shared)
        return response
    return JSONResponse(
        widget.config.model_dump(mode="json"), headers={**shared, "cache-control": "public, max-age=60"}
    )


@router.get(
    "/v1/images/{digest}",
    responses={200: {"content": {"image/png": {}, "image/jpeg": {}, "image/webp": {}}}, 404: {"model": ApiError}},
    summary="An image uploaded through the admin API, such as a widget's avatar, by its SHA-256",
)
async def image(digest: Annotated[str, InPath(pattern=r"^[0-9a-f]{64}$")], request: Request) -> Response:
    store = getattr(request.app.state, "store", None)  # none on a gateway run without a database
    found = store and await store.image(digest)
    if not found:
        raise Problem("not_found")
    # The digest names the bytes, so they never change. Shown on customers' pages too, so any site may embed it.
    headers = {"cache-control": "public, max-age=31536000, immutable", "cross-origin-resource-policy": "cross-origin"}
    return Response(found.data, media_type=found.content_type, headers=headers)


def files(web_dir: Path) -> APIRouter:
    """The built loader and chat (web/loader/dist, web/widget/dist), and the chat page for each widget."""
    pages = APIRouter(include_in_schema=False)
    chat = (web_dir / "widget" / "dist" / "index.html").read_bytes()
    assets = web_dir / "widget" / "dist" / "assets"

    @pages.get("/embed/{widget_id}")
    async def embed(widget_id: Id, request: Request) -> Response:
        widget = await widgets_of(request).get(widget_id)
        if not widget:
            raise Problem("not_found")
        headers = {"content-security-policy": chat_policy(widget), "cache-control": "no-cache"}
        # The colour scheme is on the page itself, so its first paint is already in it (a checked literal, never text).
        page = chat.replace(b"<html", f'<html data-scheme="{widget.config.color_scheme}"'.encode(), 1)
        return Response(page, media_type="text/html; charset=utf-8", headers=headers)

    @pages.get("/loader.js")
    async def loader() -> FileResponse:
        # Not versioned in its name, so caches check back every five minutes for a new release.
        path = web_dir / "loader" / "dist" / "loader.js"
        return FileResponse(path, media_type=ASSET_TYPES[".js"], headers={"cache-control": "public, max-age=300"})

    @pages.get("/assets/{name}")
    async def asset(name: str) -> FileResponse:
        path = assets / name
        # Only a file directly in the folder, by its plain name; the hash in the name makes it safe to keep forever.
        if path.parent != assets or path.suffix not in ASSET_TYPES or not path.is_file():
            raise Problem("not_found")
        headers = {"cache-control": "public, max-age=31536000, immutable"}
        return FileResponse(path, media_type=ASSET_TYPES[path.suffix], headers=headers)

    return pages
