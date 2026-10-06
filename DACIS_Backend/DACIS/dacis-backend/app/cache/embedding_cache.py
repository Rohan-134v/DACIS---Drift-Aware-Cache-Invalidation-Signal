"""
Two-tier embedding cache — L1 in-process LRU + L2 Redis.

L1: ``OrderedDict``-based LRU, capped at ``EMBEDDING_CACHE_L1_MAX_SIZE``
    (config, default 10 000 entries).  Provides a fast path with zero
    network hops.

L2: Redis with TTL (config, default 3 600 s).  ``volatile-lru``
    eviction policy is configured in ``docker-compose.yml``'s Redis
    command args.

Lookup path: L1 → L2 → miss.  An L2 hit populates L1.

``invalidate(account_id)`` MUST clear BOTH tiers — a bug here
(invalidating only one tier) would silently defeat the entire
"targeted invalidation" claim the DACIS architecture is built on.
This is explicitly tested in ``test_pipeline_integration.py``.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Optional

import numpy as np
import redis.asyncio as aioredis

from app.config import settings


class EmbeddingCache:
    """Two-tier embedding cache.

    Parameters
    ----------
    redis_client : aioredis.Redis or None
        Redis handle for L2.  May be ``None`` for in-memory-only mode.
    l1_max_size : int
        Maximum entries in the L1 in-process LRU.
    l2_ttl : int
        TTL in seconds for L2 Redis entries.
    redis_prefix : str
        Key prefix for L2 entries.
    """

    def __init__(
        self,
        redis_client: Optional[aioredis.Redis] = None,
        l1_max_size: int = settings.EMBEDDING_CACHE_L1_MAX_SIZE,
        l2_ttl: int = settings.EMBEDDING_CACHE_L2_TTL,
        redis_prefix: str = "emb_cache:",
    ) -> None:
        self._redis = redis_client
        self._l1: OrderedDict[str, np.ndarray] = OrderedDict()
        self._l1_max = l1_max_size
        self._l2_ttl = l2_ttl
        self._prefix = redis_prefix

    # ── L1 helpers ───────────────────────────────────────────────────────

    def _l1_get(self, key: str) -> Optional[np.ndarray]:
        """Get from L1 and move to end (most-recently-used)."""
        if key in self._l1:
            self._l1.move_to_end(key)
            return self._l1[key]
        return None

    def _l1_put(self, key: str, value: np.ndarray) -> None:
        """Insert into L1, evicting the LRU entry if at capacity."""
        if key in self._l1:
            self._l1.move_to_end(key)
            self._l1[key] = value
            return
        if len(self._l1) >= self._l1_max:
            self._l1.popitem(last=False)  # evict oldest
        self._l1[key] = value

    # ── public interface ─────────────────────────────────────────────────

    async def get(self, account_id: str) -> Optional[np.ndarray]:
        """Look up a cached embedding.

        Checks L1 first, falls through to L2 on miss, and populates L1
        on an L2 hit.
        """
        cache_key = f"{self._prefix}{account_id}"

        # L1
        l1_val = self._l1_get(cache_key)
        if l1_val is not None:
            return l1_val

        # L2
        if self._redis is not None:
            raw = await self._redis.get(cache_key)
            if raw is not None:
                arr = np.frombuffer(raw, dtype=np.float32).copy()
                self._l1_put(cache_key, arr)
                return arr

        return None

    async def put(self, account_id: str, embedding: np.ndarray) -> None:
        """Store an embedding in both tiers."""
        cache_key = f"{self._prefix}{account_id}"
        arr = np.asarray(embedding, dtype=np.float32)

        self._l1_put(cache_key, arr)

        if self._redis is not None:
            await self._redis.set(
                cache_key,
                arr.tobytes(),
                ex=self._l2_ttl,
            )

    async def invalidate(self, account_id: str) -> None:
        """Invalidate an account's cached embedding in BOTH tiers.

        This is the literal "targeted L-hop invalidation" the DACIS
        architecture is built around — ``DEL`` on a specific account key.
        Clearing only one tier would silently defeat the entire claim.
        """
        cache_key = f"{self._prefix}{account_id}"

        # L1 — remove from in-process dict
        self._l1.pop(cache_key, None)

        # L2 — remove from Redis
        if self._redis is not None:
            await self._redis.delete(cache_key)

    async def invalidate_many(self, account_ids: list[str]) -> None:
        """Invalidate multiple accounts — convenience wrapper."""
        for aid in account_ids:
            await self.invalidate(aid)

    # ── stats ────────────────────────────────────────────────────────────

    def l1_size(self) -> int:
        """Current number of entries in L1."""
        return len(self._l1)

    async def l2_key_count(self) -> int:
        """Approximate number of embedding keys in L2 (Redis).

        Uses DBSIZE as a rough proxy; in production you'd want a more
        precise scan, but for the stats endpoint this is sufficient.
        """
        if self._redis is None:
            return 0
        # Scan for keys with our prefix to get a more accurate count
        count = 0
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(
                cursor=cursor, match=f"{self._prefix}*", count=500
            )
            count += len(keys)
            if cursor == 0:
                break
        return count
