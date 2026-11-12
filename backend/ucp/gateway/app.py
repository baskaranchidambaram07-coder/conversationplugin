"""Conversation gateway: the public runtime API (M4)."""

from fastapi import FastAPI

from ucp.gateway import pipeline


def create_app() -> FastAPI:
    # The API description is exported to protocol/openapi.json (ucp.gateway.openapi), never served: the gateway is
    # public and describes nothing about itself.
    app = FastAPI(title="Conversation Gateway", version="1", docs_url=None, redoc_url=None, openapi_url=None)
    pipeline.install(app)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
