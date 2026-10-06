"""
Redis-backed persistence for Welford ``EntityStats``.

Serialises ``(count, mean, M2)`` to Redis so gate state survives
backend restarts.  Uses MessagePack-style binary encoding: count as
int, mean as raw float64 bytes, M2 as float64.
"""

from __future__ import annotations

import struct
from typing import Optional

import numpy as np
import redis.asyncio as aioredis

from app.gates.welford import EntityStats


class StatsStore:
    """Persist and retrieve ``EntityStats`` in Redis.

    Parameters
    ----------
    redis_client : aioredis.Redis or None
        Redis handle.  May be ``None`` for in-memory-only operation
        (testing).
    prefix : str
        Redis key prefix, e.g. ``"welford:account:"`` or
        ``"welford:community:"``.
    dim : int
        Embedding dimension — needed to decode the mean vector.
    """

    def __init__(
        self,
        redis_client: Optional[aioredis.Redis],
        prefix: str,
        dim: int,
    ) -> None:
        self._redis = redis_client
        self._prefix = prefix
        self._dim = dim

    # ── serialisation ────────────────────────────────────────────────────

    @staticmethod
    def _encode(stats: EntityStats) -> bytes:
        """Pack ``EntityStats`` into a compact binary blob.

        Layout:  [count: int64] [M2: float64] [mean: dim × float64]
        """
        header = struct.pack("<qd", stats.count, stats.M2)
        mean_bytes = stats.mean.astype(np.float64).tobytes()
        return header + mean_bytes

    def _decode(self, data: bytes) -> EntityStats:
        """Unpack binary blob into ``EntityStats``."""
        header_size = struct.calcsize("<qd")
        count, M2 = struct.unpack("<qd", data[:header_size])
        mean = np.frombuffer(data[header_size:], dtype=np.float64).copy()
        return EntityStats(count=count, mean=mean, M2=M2)

    # ── Redis operations ─────────────────────────────────────────────────

    async def save(self, entity_id: str, stats: EntityStats) -> None:
        """Persist stats for *entity_id*."""
        if self._redis is None:
            return
        key = f"{self._prefix}{entity_id}"
        await self._redis.set(key, self._encode(stats))

    async def load(self, entity_id: str) -> Optional[EntityStats]:
        """Load stats for *entity_id*.  Returns ``None`` if absent."""
        if self._redis is None:
            return None
        key = f"{self._prefix}{entity_id}"
        data = await self._redis.get(key)
        if data is None:
            return None
        return self._decode(data)

    async def delete(self, entity_id: str) -> None:
        """Remove stats for *entity_id* (used after a union-find merge
        discards the losing root)."""
        if self._redis is None:
            return
        key = f"{self._prefix}{entity_id}"
        await self._redis.delete(key)

    async def save_batch(self, items: dict[str, EntityStats]) -> None:
        """Persist multiple stats entries in a single pipeline."""
        if self._redis is None or not items:
            return
        pipe = self._redis.pipeline(transaction=False)
        for entity_id, stats in items.items():
            pipe.set(f"{self._prefix}{entity_id}", self._encode(stats))
        await pipe.execute()
