"""Conversation gateway: the public runtime API (M4)."""

import asyncio
import json
from contextlib import AsyncExitStack, asynccontextmanager

import httpx2
from fastapi import FastAPI, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.gateway import api, pipeline, public
from ucp.gateway.pipeline import Problem
from ucp.pf import PfConnector, PfProfile
from ucp.sessions import Keys, Limiter
from ucp.settings import Settings
from ucp.store import Store
from ucp.turns import Turns
from ucp.widgets import Widgets


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with AsyncExitStack() as stack:
            if settings.database_url:
                # A steady pool: a connection opened under a burst and closed after costs PostgreSQL a new process.
                engine = create_async_engine(
                    settings.database_url, pool_size=30, max_overflow=20, pool_pre_ping=True, pool_recycle=1800
                )
                stack.push_async_callback(engine.dispose)
                app.state.store = Store(engine)
                app.state.widgets = Widgets(app.state.store)
                app.state.turns = Turns(app.state.store)
            # One client for every PF call. PF stays quiet for seconds before the first word, so reads wait 60 s.
            client = await stack.enter_async_context(
                httpx2.AsyncClient(timeout=httpx2.Timeout(10, read=60), limits=httpx2.Limits(max_connections=500))
            )
            profiles = json.loads(settings.agent_profiles or "{}")
            app.state.connectors = {name: PfConnector(PfProfile(**value), client) for name, value in profiles.items()}
            yield
            # Answers still being written finish and are stored before the connections they need close.
            running = getattr(app.state, "turns", None) and app.state.turns.tasks
            if running:
                await asyncio.wait(running, timeout=100)

    # The API description is exported to protocol/openapi.json (ucp.gateway.openapi), never served: the gateway is
    # public and describes nothing about itself.
    app = FastAPI(
        title="Conversation Gateway",
        version="1",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    pipeline.install(app)
    app.state.keys = Keys(settings.session_keys) if settings.session_keys else None
    app.state.limiter = Limiter()
    app.state.host_secrets = {
        name: Keys(value).keys for name, value in json.loads(settings.host_secrets or "{}").items()
    }
    app.state.signed_in_seconds = settings.signed_in_seconds
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
