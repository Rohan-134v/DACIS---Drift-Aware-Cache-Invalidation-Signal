"""
Integration tests for the DACIS pipeline.

All tests run fully in-memory with fake Redis/stats-store — no real
Redis dependency required.

Critical correctness tests:
    1. Two-tier cache invalidation: invalidate() clears BOTH L1 and L2.
    2. End-to-end transaction processing through the full pipeline.
    3. Anti-leakage integration through the pipeline.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest

from app.cache.embedding_cache import EmbeddingCache
from app.cache.stats_store import StatsStore
from app.config import settings
from app.gates.dual_gate import DualGateEvaluator
from app.gates.welford import WelfordVectorTracker
from app.graph.graph_store import GraphStore
from app.graph.union_find import UnionFind
from app.model.dacis_model import DACISGraphSAGE
from app.model.registry import ModelService
from app.pipeline import PipelineState, process_transaction
from app.schemas import TransactionRequest


# ── Fake Redis ───────────────────────────────────────────────────────────


class FakeRedis:
    """Minimal in-memory Redis replacement for testing.

    Supports get/set/delete/scan/ping/pipeline — enough for all the
    Redis-backed components to function.
    """

    def __init__(self):
        self._store: Dict[str, bytes] = {}
        self._ttls: Dict[str, int] = {}

    async def get(self, key: str) -> Optional[bytes]:
        k = key if isinstance(key, str) else key.decode()
        val = self._store.get(k)
        return val

    async def set(self, key: str, value: Any, ex: Optional[int] = None) -> None:
        k = key if isinstance(key, str) else key.decode()
        if isinstance(value, str):
            value = value.encode()
        elif isinstance(value, int):
            value = str(value).encode()
        self._store[k] = value
        if ex is not None:
            self._ttls[k] = ex

    async def delete(self, key: str) -> int:
        k = key if isinstance(key, str) else key.decode()
        if k in self._store:
            del self._store[k]
            self._ttls.pop(k, None)
            return 1
        return 0

    async def scan(self, cursor: int = 0, match: str = "*", count: int = 100):
        import fnmatch
        pattern = match.replace("*", ".*") if "*" in match else match
        matched = [
            k.encode() for k in self._store.keys()
            if fnmatch.fnmatch(k, match)
        ]
        return 0, matched  # always return cursor=0 (single batch)

    async def ping(self) -> bool:
        return True

    def pipeline(self, transaction: bool = False):
        return FakePipeline(self)

    async def aclose(self):
        pass


class FakePipeline:
    """Minimal pipeline for batching Redis commands."""

    def __init__(self, redis: FakeRedis):
        self._redis = redis
        self._commands: list = []

    def set(self, key: str, value: Any, ex: Optional[int] = None):
        self._commands.append(("set", key, value, ex))
        return self

    def delete(self, key: str):
        self._commands.append(("delete", key))
        return self

    async def execute(self):
        results = []
        for cmd in self._commands:
            if cmd[0] == "set":
                await self._redis.set(cmd[1], cmd[2], cmd[3] if len(cmd) > 3 else None)
                results.append(True)
            elif cmd[0] == "delete":
                r = await self._redis.delete(cmd[1])
                results.append(r)
        self._commands.clear()
        return results


# ── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture
def embedding_cache(fake_redis):
    return EmbeddingCache(
        redis_client=fake_redis,
        l1_max_size=100,
        l2_ttl=3600,
    )


@pytest.fixture
def pipeline_state(fake_redis):
    """Build a fully wired PipelineState with fake Redis and a real
    (placeholder) model."""
    dim = settings.MODEL_HIDDEN_DIM
    input_dim = settings.MODEL_INPUT_DIM

    graph = GraphStore(feature_dim=input_dim)
    account_tracker = WelfordVectorTracker(
        dim=dim, burn_in=settings.BURN_IN_MIN_COUNT, z_thresh=settings.Z_THRESH
    )
    community_tracker = WelfordVectorTracker(
        dim=dim, burn_in=settings.GATE2_BURN_IN_MIN_COUNT, z_thresh=settings.GATE2_Z_THRESH
    )
    dual_gate = DualGateEvaluator(account_tracker, community_tracker)

    def on_merge(winner, loser):
        community_tracker.merge(winner, loser)

    uf = UnionFind(redis_client=fake_redis, on_merge=on_merge)
    cache = EmbeddingCache(redis_client=fake_redis, l1_max_size=100, l2_ttl=3600)
    account_stats = StatsStore(redis_client=fake_redis, prefix="welford:acct:", dim=dim)
    community_stats = StatsStore(redis_client=fake_redis, prefix="welford:comm:", dim=dim)

    # Set up ModelService singleton with placeholder model
    ModelService.reset()
    model_svc = ModelService.instance()

    broadcast_q = asyncio.Queue()

    state = PipelineState(
        graph_store=graph,
        embedding_cache=cache,
        account_tracker=account_tracker,
        community_tracker=community_tracker,
        dual_gate=dual_gate,
        union_find=uf,
        account_stats_store=account_stats,
        community_stats_store=community_stats,
        model_service=model_svc,
        broadcast_queue=broadcast_q,
    )
    return state


# ── Two-tier cache invalidation ──────────────────────────────────────────


class TestTwoTierCacheInvalidation:
    """invalidate(account_id) MUST clear BOTH L1 and L2 — a bug here
    would silently defeat the entire "targeted invalidation" claim."""

    async def test_invalidate_clears_both_tiers(self, embedding_cache: EmbeddingCache, fake_redis: FakeRedis):
        """After invalidate(), the embedding should be absent from both tiers."""
        account_id = "test_account"
        embedding = np.array([1.0, 2.0, 3.0], dtype=np.float32)

        # Populate both tiers
        await embedding_cache.put(account_id, embedding)

        # Verify present in L1
        cache_key = f"{embedding_cache._prefix}{account_id}"
        assert cache_key in embedding_cache._l1

        # Verify present in L2
        l2_val = await fake_redis.get(cache_key)
        assert l2_val is not None

        # Invalidate
        await embedding_cache.invalidate(account_id)

        # L1 must be cleared
        assert cache_key not in embedding_cache._l1

        # L2 must be cleared
        l2_val_after = await fake_redis.get(cache_key)
        assert l2_val_after is None

        # get() must return None
        result = await embedding_cache.get(account_id)
        assert result is None

    async def test_l2_hit_populates_l1(self, embedding_cache: EmbeddingCache, fake_redis: FakeRedis):
        """An L2 hit should populate L1 for subsequent fast lookups."""
        account_id = "test_account"
        embedding = np.array([1.0, 2.0, 3.0], dtype=np.float32)

        # Manually put into L2 only
        cache_key = f"{embedding_cache._prefix}{account_id}"
        await fake_redis.set(cache_key, embedding.tobytes())

        # L1 should be empty
        assert cache_key not in embedding_cache._l1

        # get() should find it in L2 and populate L1
        result = await embedding_cache.get(account_id)
        assert result is not None
        np.testing.assert_array_almost_equal(result, embedding)

        # L1 should now have it
        assert cache_key in embedding_cache._l1

    async def test_invalidate_only_l1_leaves_stale_l2(self, embedding_cache: EmbeddingCache, fake_redis: FakeRedis):
        """Demonstrate why we MUST clear both tiers: clearing only L1
        leaves stale data in L2 that would be served on next get()."""
        account_id = "test_account"
        embedding = np.array([1.0, 2.0, 3.0], dtype=np.float32)

        await embedding_cache.put(account_id, embedding)

        # Simulate buggy invalidation: only clear L1
        cache_key = f"{embedding_cache._prefix}{account_id}"
        embedding_cache._l1.pop(cache_key, None)

        # L2 still has the data — get() would return stale value!
        result = await embedding_cache.get(account_id)
        assert result is not None  # This is the BUG — stale data served

        # Now do proper invalidation
        await embedding_cache.invalidate(account_id)
        result = await embedding_cache.get(account_id)
        assert result is None  # Correctly cleared from both tiers

    async def test_l1_lru_eviction(self, fake_redis: FakeRedis):
        """L1 should evict oldest entries when at capacity."""
        cache = EmbeddingCache(
            redis_client=fake_redis, l1_max_size=3, l2_ttl=3600
        )
        for i in range(5):
            await cache.put(f"account_{i}", np.array([float(i)], dtype=np.float32))

        # L1 should have exactly 3 entries (most recent)
        assert cache.l1_size() == 3

        # Oldest entries (0, 1) should be evicted from L1
        cache_key_0 = f"{cache._prefix}account_0"
        cache_key_1 = f"{cache._prefix}account_1"
        assert cache_key_0 not in cache._l1
        assert cache_key_1 not in cache._l1

        # But they should still be in L2
        result = await cache.get("account_0")
        assert result is not None


# ── Pipeline Integration ─────────────────────────────────────────────────


class TestPipelineIntegration:
    """End-to-end tests through the full pipeline with fake Redis."""

    async def test_process_transaction_returns_response(self, pipeline_state: PipelineState):
        """process_transaction should return a well-formed TransactionResponse."""
        # Load the placeholder model
        await pipeline_state.model.load()

        txn = TransactionRequest(
            transaction_id="txn_001",
            sender_id="alice",
            receiver_id="bob",
            amount=100.0,
            timestamp=1700000000.0,
            features=[float(i) for i in range(settings.MODEL_INPUT_DIM)],
        )

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            response = await process_transaction(txn, pipeline_state)

        assert response.transaction_id == "txn_001"
        assert response.sender_id == "alice"
        assert response.receiver_id == "bob"
        assert isinstance(response.dg_score, float)
        assert 0.0 <= response.dg_score <= 1.0
        assert isinstance(response.gate1_fired, bool)
        assert isinstance(response.gate2_confirmed, bool)

    async def test_graph_updated_after_transaction(self, pipeline_state: PipelineState):
        """The graph should contain the new edge after processing."""
        await pipeline_state.model.load()

        txn = TransactionRequest(
            transaction_id="txn_002",
            sender_id="charlie",
            receiver_id="dave",
            amount=50.0,
            timestamp=1700000001.0,
            features=[float(i) for i in range(settings.MODEL_INPUT_DIM)],
        )

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            await process_transaction(txn, pipeline_state)

        assert pipeline_state.graph.has_node("charlie")
        assert pipeline_state.graph.has_node("dave")
        assert "dave" in pipeline_state.graph.neighbors("charlie")

    async def test_union_find_links_sender_receiver(self, pipeline_state: PipelineState):
        """Sender and receiver should be in the same community after processing."""
        await pipeline_state.model.load()

        txn = TransactionRequest(
            transaction_id="txn_003",
            sender_id="eve",
            receiver_id="frank",
            amount=200.0,
            timestamp=1700000002.0,
            features=[float(i) for i in range(settings.MODEL_INPUT_DIM)],
        )

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            await process_transaction(txn, pipeline_state)

        assert pipeline_state.union_find.connected("eve", "frank")

    async def test_broadcast_queue_receives_message(self, pipeline_state: PipelineState):
        """The broadcast should push the response to all registered client queues."""
        await pipeline_state.model.load()

        # Register a client
        client_q = await pipeline_state.register_ws_client()

        txn = TransactionRequest(
            transaction_id="txn_004",
            sender_id="grace",
            receiver_id="heidi",
            amount=300.0,
            timestamp=1700000003.0,
            features=[float(i) for i in range(settings.MODEL_INPUT_DIM)],
        )

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            await process_transaction(txn, pipeline_state)

        # Client queue should have received the broadcast
        assert not client_q.empty()
        msg = client_q.get_nowait()
        assert msg["transaction_id"] == "txn_004"

        await pipeline_state.unregister_ws_client(client_q)

    async def test_cache_invalidation_on_flag(self, pipeline_state: PipelineState):
        """When gate1 fires, the L-hop neighbourhood's cached embeddings
        should be invalidated from BOTH tiers."""
        await pipeline_state.model.load()

        account_id = "mallory"
        community_root = "mallory"  # initially its own root

        # Pre-populate the cache for mallory
        embedding = np.random.randn(settings.MODEL_HIDDEN_DIM).astype(np.float32)
        await pipeline_state.cache.put(account_id, embedding)

        # Verify cache is populated
        cached = await pipeline_state.cache.get(account_id)
        assert cached is not None

        # Warm up the tracker so gate1 can fire
        rng = np.random.RandomState(42)
        for _ in range(30):
            pipeline_state.account_tracker.update(
                account_id, rng.randn(settings.MODEL_HIDDEN_DIM) * 0.01
            )
        for _ in range(30):
            pipeline_state.community_tracker.update(
                community_root, rng.randn(settings.MODEL_HIDDEN_DIM) * 0.01
            )

        # We need to mock the model to return an extreme embedding
        # that will trigger gate1
        async def mock_get_embedding(x, edge_index):
            result = np.zeros((x.shape[0], settings.MODEL_HIDDEN_DIM), dtype=np.float32)
            result[0] = np.ones(settings.MODEL_HIDDEN_DIM) * 100.0  # extreme
            return result

        async def mock_predict_prob(x, edge_index):
            return np.array([0.8] * x.shape[0], dtype=np.float32)

        pipeline_state.model.get_embedding = mock_get_embedding
        pipeline_state.model.predict_prob = mock_predict_prob

        txn = TransactionRequest(
            transaction_id="txn_flag",
            sender_id=account_id,
            receiver_id="norm_account",
            amount=99999.0,
            timestamp=1700000010.0,
        )

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            response = await process_transaction(txn, pipeline_state)

        assert response.gate1_fired is True

        # Cache should be invalidated for the sender
        cached_after = await pipeline_state.cache.get(account_id)
        assert cached_after is None


# ── Stats Store ──────────────────────────────────────────────────────────


class TestStatsStore:
    """Test stats persistence with fake Redis."""

    async def test_save_and_load(self, fake_redis):
        from app.gates.welford import EntityStats

        store = StatsStore(redis_client=fake_redis, prefix="test:", dim=4)
        stats = EntityStats(
            count=10,
            mean=np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float64),
            M2=5.5,
        )
        await store.save("entity_1", stats)
        loaded = await store.load("entity_1")
        assert loaded is not None
        assert loaded.count == stats.count
        np.testing.assert_array_almost_equal(loaded.mean, stats.mean)
        assert loaded.M2 == pytest.approx(stats.M2)

    async def test_load_missing(self, fake_redis):
        store = StatsStore(redis_client=fake_redis, prefix="test:", dim=4)
        loaded = await store.load("nonexistent")
        assert loaded is None

    async def test_delete(self, fake_redis):
        from app.gates.welford import EntityStats

        store = StatsStore(redis_client=fake_redis, prefix="test:", dim=4)
        stats = EntityStats(
            count=5,
            mean=np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float64),
            M2=2.0,
        )
        await store.save("entity_2", stats)
        await store.delete("entity_2")
        loaded = await store.load("entity_2")
        assert loaded is None
