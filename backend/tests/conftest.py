import os

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

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
