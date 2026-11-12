"""Checks that the database the tests run against is the PostgreSQL version the product targets."""

import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.skipif(not DATABASE_URL, reason="TEST_DATABASE_URL is not set")
async def test_postgres_is_reachable_and_is_version_17():
    engine = create_async_engine(DATABASE_URL)
    try:
        async with engine.connect() as connection:
            version = (await connection.execute(text("show server_version"))).scalar_one()
    finally:
        await engine.dispose()

    assert version.split(".")[0] == "17"
