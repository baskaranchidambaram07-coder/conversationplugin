"""Conversation gateway: the public runtime API."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    # The interactive API pages stay off: the gateway is public and should describe nothing about itself.
    app = FastAPI(title="Conversation Gateway", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
