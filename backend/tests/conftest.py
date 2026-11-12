import os
import threading
import time

import pytest
import uvicorn
from sqlalchemy.ext.asyncio import create_async_engine

from fakepf.app import create_app as fake_pf_app
from ucp import migrate
from ucp.store import Store

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
def database_url():
    """A test database emptied and migrated from nothing, once per run. Tests needing it skip without it."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    migrate.downgrade(TEST_DATABASE_URL)
    migrate.upgrade(TEST_DATABASE_URL)
    return TEST_DATABASE_URL


@pytest.fixture
async def store(database_url):
    engine = create_async_engine(database_url)
    yield Store(engine)
    await engine.dispose()


@pytest.fixture(scope="session")
def fake_pf():
    """The fake PF on a real port at 1/100 of recorded speed, so streams really stream and can really break."""
    config = uvicorn.Config(fake_pf_app(time_scale=0.01), host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.01)
    yield f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    server.should_exit = True
    thread.join(5)
