"""
Union-Find with union-by-rank and path compression.

Fast path: in-process ``dict`` for parent pointers (avoids a Redis
round-trip per ``find()`` call, since path compression naturally chases
multiple pointers).

Redis persistence strategy (design tradeoff documented here):
  - **On every union()**: root changes are persisted immediately so they
    survive backend restarts.  This is the correctness-critical path.
  - **Periodic flush for path-compression updates**: ``find()`` applies
    path compression locally but does NOT write every compressed edge
    to Redis.  Instead, compressed parent pointers are flushed in bulk
    every ``UNION_FIND_FLUSH_INTERVAL`` find() calls.  This trades a
    small amount of redundant work on cold restart (re-doing path
    compression) for dramatically lower Redis write load during normal
    operation.
  - On cold start, the in-process cache is populated from Redis.

When ``union(a, b)`` causes a merge (roots differ), the LOSING root's
community Welford stats are merged into the WINNING root's stats via
``WelfordVectorTracker.merge()``, then the losing root's stats entry is
discarded.
"""

from __future__ import annotations

from typing import Callable, Dict, Optional, Set

import redis.asyncio as aioredis


class UnionFind:
    """Async-aware union-find with in-process cache and Redis backing.

    Parameters
    ----------
    redis_client : aioredis.Redis or None
        Redis handle for persistence.  May be ``None`` for testing.
    redis_prefix : str
        Key prefix for parent/rank entries in Redis.
    flush_interval : int
        Number of ``find()`` calls between bulk flushes of path-
        compression updates to Redis.
    on_merge : callable or None
        ``on_merge(winner_root, loser_root)`` is called synchronously
        when a union causes two distinct communities to merge.  Used
        to trigger ``WelfordVectorTracker.merge()``.
    """

    def __init__(
        self,
        redis_client: Optional[aioredis.Redis] = None,
        redis_prefix: str = "uf:",
        flush_interval: int = 100,
        on_merge: Optional[Callable[[str, str], None]] = None,
    ) -> None:
        self._parent: Dict[str, str] = {}
        self._rank: Dict[str, int] = {}
        self._redis = redis_client
        self._prefix = redis_prefix
        self._flush_interval = flush_interval
        self._find_counter = 0
        self._dirty: Set[str] = set()  # nodes whose parent was compressed locally
        self._on_merge = on_merge

    # ── core operations ──────────────────────────────────────────────────

    def _ensure_node(self, x: str) -> None:
        """Lazily initialise a node as its own root."""
        if x not in self._parent:
            self._parent[x] = x
            self._rank[x] = 0

    def find(self, x: str) -> str:
        """Find root of *x* with path compression (in-process only).

        Path compression writes are batched — see class docstring.
        """
        self._ensure_node(x)
        root = x
        while self._parent[root] != root:
            root = self._parent[root]
        # Path compression — update locally, mark dirty for periodic flush
        current = x
        while self._parent[current] != root:
            next_node = self._parent[current]
            self._parent[current] = root
            self._dirty.add(current)
            current = next_node

        self._find_counter += 1
        return root

    def union(self, a: str, b: str) -> str:
        """Union the sets containing *a* and *b*.

        Returns the new root.  If roots were already the same, no merge
        callback is triggered.  When roots differ, the losing root's
        stats are merged into the winner via ``on_merge``.
        """
        root_a = self.find(a)
        root_b = self.find(b)
        if root_a == root_b:
            return root_a

        # Union by rank
        if self._rank[root_a] < self._rank[root_b]:
            root_a, root_b = root_b, root_a  # root_a is the winner
        self._parent[root_b] = root_a
        if self._rank[root_a] == self._rank[root_b]:
            self._rank[root_a] += 1

        # Merge callback (Welford stats)
        if self._on_merge is not None:
            self._on_merge(root_a, root_b)

        return root_a

    def connected(self, a: str, b: str) -> bool:
        """Check whether *a* and *b* are in the same component."""
        return self.find(a) == self.find(b)

    # ── Redis persistence ────────────────────────────────────────────────

    async def persist_union(self, winner: str, loser: str) -> None:
        """Persist a union result to Redis (called after every union).

        Root changes must survive restarts — this is the correctness-
        critical write path.
        """
        if self._redis is None:
            return
        pipe = self._redis.pipeline(transaction=False)
        pipe.set(f"{self._prefix}parent:{loser}", winner)
        pipe.set(f"{self._prefix}rank:{winner}", str(self._rank.get(winner, 0)))
        # Ensure winner's parent entry exists
        pipe.set(f"{self._prefix}parent:{winner}", winner)
        await pipe.execute()

    async def flush_compressed_paths(self) -> None:
        """Bulk-write locally-compressed parent pointers to Redis.

        Called periodically (every ``flush_interval`` find() calls) or
        on graceful shutdown.  NOT called on every find() — that would
        defeat the purpose of the in-process cache.
        """
        if self._redis is None or not self._dirty:
            return
        pipe = self._redis.pipeline(transaction=False)
        for node in self._dirty:
            pipe.set(f"{self._prefix}parent:{node}", self._parent[node])
        await pipe.execute()
        self._dirty.clear()

    async def maybe_flush(self) -> None:
        """Flush if the find counter has reached the interval threshold."""
        if self._find_counter >= self._flush_interval:
            await self.flush_compressed_paths()
            self._find_counter = 0

    async def load_from_redis(self) -> None:
        """Populate the in-process cache from Redis on cold start."""
        if self._redis is None:
            return
        # Scan for all parent keys
        cursor = 0
        prefix = f"{self._prefix}parent:"
        while True:
            cursor, keys = await self._redis.scan(
                cursor=cursor, match=f"{prefix}*", count=500
            )
            for key in keys:
                node = key.decode() if isinstance(key, bytes) else key
                node = node[len(prefix):]
                parent_raw = await self._redis.get(f"{prefix}{node}")
                if parent_raw is not None:
                    parent = parent_raw.decode() if isinstance(parent_raw, bytes) else parent_raw
                    self._parent[node] = parent
            if cursor == 0:
                break
        # Load ranks
        rank_prefix = f"{self._prefix}rank:"
        cursor = 0
        while True:
            cursor, keys = await self._redis.scan(
                cursor=cursor, match=f"{rank_prefix}*", count=500
            )
            for key in keys:
                node = key.decode() if isinstance(key, bytes) else key
                node = node[len(rank_prefix):]
                rank_raw = await self._redis.get(f"{rank_prefix}{node}")
                if rank_raw is not None:
                    rank_val = rank_raw.decode() if isinstance(rank_raw, bytes) else rank_raw
                    self._rank[node] = int(rank_val)
            if cursor == 0:
                break

    async def union_and_persist(self, a: str, b: str) -> str:
        """Convenience: union + immediate Redis persistence.

        This is the primary entry point used by the pipeline.
        """
        root_a_before = self.find(a)
        root_b_before = self.find(b)
        new_root = self.union(a, b)
        if root_a_before != root_b_before:
            # Roots changed — persist immediately
            loser = root_b_before if new_root == root_a_before else root_a_before
            await self.persist_union(new_root, loser)
        await self.maybe_flush()
        return new_root
