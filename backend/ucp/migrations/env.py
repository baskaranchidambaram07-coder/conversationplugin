"""Alembic's entry point: runs the migrations on an async PostgreSQL connection."""

import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.store import metadata


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def _main() -> None:
    engine = create_async_engine(context.config.get_main_option("sqlalchemy.url"))
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
            await connection.commit()
    finally:
        await engine.dispose()


asyncio.run(_main())
