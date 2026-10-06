"""
Redis client — single async connection pool for the entire application.

Injected into FastAPI via dependency; never re-instantiated per request.
All Redis access across the codebase goes through the pool exported here.
"""

from __future__ import annotations

import redis.asyncio as aioredis

from app.config import settings

# Module-level pool — created once at import time, shared across the app.
_pool: aioredis.ConnectionPool | None = None
_client: aioredis.Redis | None = None


async def init_redis() -> aioredis.Redis:
    """Create the connection pool and return an ``aioredis.Redis`` handle.

    Called once during FastAPI ``lifespan`` startup.
    """
    global _pool, _client
    _pool = aioredis.ConnectionPool.from_url(
        settings.REDIS_URL,
        decode_responses=False,  # embeddings stored as bytes
    )
    _client = aioredis.Redis(connection_pool=_pool)
    # Verify connectivity
    await _client.ping()
    return _client


async def close_redis() -> None:
    """Drain the pool on shutdown."""
    global _pool, _client
    if _client is not None:
        await _client.aclose()
        _client = None
    if _pool is not None:
        await _pool.aclose()
        _pool = None


def get_redis() -> aioredis.Redis:
    """FastAPI dependency — returns the shared Redis client.

    Raises ``RuntimeError`` if called before ``init_redis()``.
    """
    if _client is None:
        raise RuntimeError(
            "Redis client not initialised. Call init_redis() during app startup."
        )
    return _client
