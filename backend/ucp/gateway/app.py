"""Conversation gateway: the public runtime API (M4)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.gateway import api, pipeline, public
from ucp.gateway.pipeline import Problem
from ucp.sessions import Keys, Limiter
from ucp.settings import Settings
from ucp.store import Store
from ucp.widgets import Widgets


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = create_async_engine(settings.database_url, pool_size=10, max_overflow=10, pool_pre_ping=True)
        app.state.store = Store(engine)
        app.state.widgets = Widgets(app.state.store)
        try:
            yield
        finally:
            await engine.dispose()

    # The API description is exported to protocol/openapi.json (ucp.gateway.openapi), never served: the gateway is
    # public and describes nothing about itself.
    app = FastAPI(
        title="Conversation Gateway",
        version="1",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan if settings.database_url else None,
    )
    pipeline.install(app)
    app.state.keys = Keys(settings.session_keys) if settings.session_keys else None
    app.state.limiter = Limiter()
    app.include_router(public.router)
    app.include_router(api.router)
    if settings.web_dir:
        app.include_router(public.files(settings.web_dir))

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        """The process is up. The load balancer restarts a task that stops answering."""
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request) -> dict[str, str]:
        """The gateway can serve: its database answers."""
        store: Store | None = getattr(request.app.state, "store", None)
        if not store:
            raise Problem("assistant_unavailable", retryable=True)
        try:
            async with store.engine.connect() as db:
                await db.execute(text("select 1"))
        except Exception as error:
            raise Problem("assistant_unavailable", retryable=True) from error
        return {"status": "ok"}

    return app


app = create_app()
