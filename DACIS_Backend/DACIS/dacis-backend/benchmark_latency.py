"""
Benchmark script for DACIS pipeline latency and compute overhead.

Produces the exact values needed for the research paper:
  - Table VII:  Compute overhead for Gate 1 only vs DACIS (dual-gate)
  - Table VIII: Latency (s) for each gate × L-hop configuration

Run:
    python benchmark_latency.py

No Docker or Redis required — uses in-memory FakeRedis identical to the
test suite.  All measurements are wall-clock time via time.perf_counter().
"""

from __future__ import annotations

import asyncio
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

# ── In-process path setup ────────────────────────────────────────────────
# Ensure the app package is importable when running from the repo root.
sys.path.insert(0, ".")

from app.cache.embedding_cache import EmbeddingCache
from app.cache.stats_store import StatsStore
from app.config import settings
from app.gates.dual_gate import DualGateEvaluator
from app.gates.welford import WelfordVectorTracker
from app.graph.graph_store import GraphStore
from app.graph.union_find import UnionFind
from app.model.registry import ModelService
from app.pipeline import PipelineState, process_transaction
from app.schemas import TransactionRequest


# ── Fake Redis (identical to tests/test_pipeline_integration.py) ─────────


class FakeRedis:
    """Minimal in-memory Redis replacement."""

    def __init__(self):
        self._store: Dict[str, bytes] = {}
        self._ttls: Dict[str, int] = {}

    async def get(self, key: str) -> Optional[bytes]:
        k = key if isinstance(key, str) else key.decode()
        return self._store.get(k)

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

        matched = [
            k.encode()
            for k in self._store.keys()
            if fnmatch.fnmatch(k, match)
        ]
        return 0, matched

    async def ping(self) -> bool:
        return True

    def pipeline(self, transaction: bool = False):
        return FakePipeline(self)

    async def aclose(self):
        pass


class FakePipeline:
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


# ── Pipeline factory ─────────────────────────────────────────────────────


async def build_pipeline_state(
    fake_redis: FakeRedis,
    enable_gate2: bool = True,
) -> PipelineState:
    """Build a fully wired PipelineState with optional gate2 disable."""
    dim = settings.MODEL_HIDDEN_DIM
    input_dim = settings.MODEL_INPUT_DIM

    graph = GraphStore(feature_dim=input_dim)
    account_tracker = WelfordVectorTracker(
        dim=dim, burn_in=settings.BURN_IN_MIN_COUNT, z_thresh=settings.Z_THRESH
    )
    community_tracker = WelfordVectorTracker(
        dim=dim,
        burn_in=settings.GATE2_BURN_IN_MIN_COUNT,
        z_thresh=settings.GATE2_Z_THRESH,
    )

    if enable_gate2:
        dual_gate = DualGateEvaluator(account_tracker, community_tracker)
    else:
        # Gate 1 only: use a community tracker with an impossibly high burn-in
        # so Gate 2's z_score() always returns None → gate2_confirmed = False.
        # This means Gate 2 never fires, simulating "Gate 1 only".
        disabled_community_tracker = WelfordVectorTracker(
            dim=dim,
            burn_in=999_999_999,  # burn-in never met → gate2 always returns None
            z_thresh=settings.GATE2_Z_THRESH,
        )
        dual_gate = DualGateEvaluator(account_tracker, disabled_community_tracker)

    def on_merge(winner: str, loser: str) -> None:
        community_tracker.merge(winner, loser)

    uf = UnionFind(redis_client=fake_redis, on_merge=on_merge)
    cache = EmbeddingCache(redis_client=fake_redis, l1_max_size=10_000, l2_ttl=3600)
    account_stats = StatsStore(redis_client=fake_redis, prefix="welford:acct:", dim=dim)
    community_stats = StatsStore(
        redis_client=fake_redis, prefix="welford:comm:", dim=dim
    )

    ModelService.reset()
    model_svc = ModelService.instance()
    await model_svc.load()

    broadcast_q = asyncio.Queue()

    return PipelineState(
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


# ── Transaction generator ───────────────────────────────────────────────


def make_transaction(idx: int, num_accounts: int = 200) -> TransactionRequest:
    """Generate a synthetic transaction for benchmarking."""
    sender = f"account_{idx % num_accounts}"
    receiver = f"account_{(idx + random.randint(1, num_accounts - 1)) % num_accounts}"
    return TransactionRequest(
        transaction_id=f"bench_{idx}",
        sender_id=sender,
        receiver_id=receiver,
        amount=round(random.uniform(10, 50000), 2),
        timestamp=time.time() + idx,
        features=[random.gauss(0, 1) for _ in range(settings.MODEL_INPUT_DIM)],
    )


# ── Benchmark configuration ─────────────────────────────────────────────


@dataclass
class BenchmarkConfig:
    """A single benchmark configuration to measure."""

    name: str
    l_hops: int
    enable_gate2: bool
    # Results populated after run
    latencies: List[float] = field(default_factory=list)
    timing_breakdowns: Dict[str, List[float]] = field(default_factory=dict)


# ── Core benchmark runner ────────────────────────────────────────────────


async def run_benchmark(
    config: BenchmarkConfig,
    warmup_count: int = 200,
    measure_count: int = 500,
) -> None:
    """Run a single benchmark configuration."""
    fake_redis = FakeRedis()
    state = await build_pipeline_state(fake_redis, enable_gate2=config.enable_gate2)

    # Override L_HOPS for this run
    original_l_hops = settings.L_HOPS
    settings.L_HOPS = config.l_hops

    try:
        # ── Warm-up phase ────────────────────────────────────────────
        print(f"  [{config.name}] Warming up with {warmup_count} transactions...")
        for i in range(warmup_count):
            txn = make_transaction(i)
            await process_transaction(txn, state)

        # ── Measurement phase ────────────────────────────────────────
        print(f"  [{config.name}] Measuring {measure_count} transactions...")
        config.latencies = []
        config.timing_breakdowns = {
            "graph_update": [],
            "subgraph": [],
            "inference": [],
            "gates": [],
            "cache_invalidation": [],
            "broadcast": [],
        }

        for i in range(measure_count):
            txn = make_transaction(warmup_count + i)
            resp = await process_transaction(txn, state)

            config.latencies.append(resp.latency_total_s)
            config.timing_breakdowns["graph_update"].append(resp.latency_graph_update_s)
            config.timing_breakdowns["subgraph"].append(resp.latency_subgraph_s)
            config.timing_breakdowns["inference"].append(resp.latency_inference_s)
            config.timing_breakdowns["gates"].append(resp.latency_gates_s)
            config.timing_breakdowns["cache_invalidation"].append(
                resp.latency_cache_invalidation_s
            )
            config.timing_breakdowns["broadcast"].append(resp.latency_broadcast_s)

    finally:
        # Restore original setting
        settings.L_HOPS = original_l_hops


async def run_baseline_no_gates(
    warmup_count: int = 200,
    measure_count: int = 500,
) -> Dict[str, float]:
    """Run the pipeline WITHOUT any gate evaluation to establish a baseline.

    Returns mean times for the inference-only portion (graph_update +
    subgraph + inference), which is the denominator for compute overhead.
    """
    fake_redis = FakeRedis()
    state = await build_pipeline_state(fake_redis, enable_gate2=False)

    # Use L=1 for the baseline (simplest configuration)
    original_l_hops = settings.L_HOPS
    settings.L_HOPS = 1

    try:
        # Warm-up
        print("  [Baseline no-gates] Warming up...")
        for i in range(warmup_count):
            txn = make_transaction(i)
            await process_transaction(txn, state)

        # Measure — we only care about graph_update + subgraph + inference
        inference_only_times = []
        print(f"  [Baseline no-gates] Measuring {measure_count} transactions...")
        for i in range(measure_count):
            txn = make_transaction(warmup_count + i)
            resp = await process_transaction(txn, state)
            # "Baseline" = graph_update + subgraph + inference (no gates)
            t_baseline = (
                resp.latency_graph_update_s
                + resp.latency_subgraph_s
                + resp.latency_inference_s
            )
            inference_only_times.append(t_baseline)

        return {
            "mean": statistics.mean(inference_only_times),
            "median": statistics.median(inference_only_times),
            "stdev": statistics.stdev(inference_only_times) if len(inference_only_times) > 1 else 0.0,
        }
    finally:
        settings.L_HOPS = original_l_hops


# ── Main ─────────────────────────────────────────────────────────────────


async def main():
    warmup = 200
    measure = 500

    print("=" * 70)
    print("  DACIS Benchmark — Latency & Compute Overhead")
    print("=" * 70)
    print(f"  Warm-up: {warmup} txns | Measured: {measure} txns")
    print(f"  Model: {settings.MODEL_PATH}")
    print(f"  Input dim: {settings.MODEL_INPUT_DIM} | Hidden dim: {settings.MODEL_HIDDEN_DIM}")
    print(f"  Burn-in (Gate 1): {settings.BURN_IN_MIN_COUNT} | "
          f"Burn-in (Gate 2): {settings.GATE2_BURN_IN_MIN_COUNT}")
    print("=" * 70)

    # Define the 4 ablation configurations
    configs = [
        BenchmarkConfig(name="Gate 1 only, L=1", l_hops=1, enable_gate2=False),
        BenchmarkConfig(name="Gate 1 only, L=2", l_hops=2, enable_gate2=False),
        BenchmarkConfig(name="Dual-gate, L=1", l_hops=1, enable_gate2=True),
        BenchmarkConfig(name="Dual-gate, L=2", l_hops=2, enable_gate2=True),
    ]

    # Run each configuration
    for cfg in configs:
        print(f"\n> Running: {cfg.name}")
        await run_benchmark(cfg, warmup_count=warmup, measure_count=measure)

    # Run baseline (no gates) for compute overhead calculation
    print("\n> Running: Baseline (no gates, L=1)")
    baseline = await run_baseline_no_gates(warmup_count=warmup, measure_count=measure)

    # ── Results ──────────────────────────────────────────────────────

    print("\n")
    print("=" * 70)
    print("  TABLE VIII -- Ablation: Gate Configuration and Neighborhood Depth")
    print("=" * 70)
    print(f"  {'Configuration':<25} {'Mean (s)':>12} {'Median (s)':>12} "
          f"{'Std (s)':>12} {'P95 (s)':>12}")
    print("  " + "-" * 73)

    for cfg in configs:
        mean_lat = statistics.mean(cfg.latencies)
        med_lat = statistics.median(cfg.latencies)
        std_lat = statistics.stdev(cfg.latencies) if len(cfg.latencies) > 1 else 0.0
        p95_lat = sorted(cfg.latencies)[int(len(cfg.latencies) * 0.95)]
        print(f"  {cfg.name:<25} {mean_lat:>12.6f} {med_lat:>12.6f} "
              f"{std_lat:>12.6f} {p95_lat:>12.6f}")

    print("\n")
    print("=" * 70)
    print("  TABLE VII -- FP Invalidation Rate and Overhead")
    print("=" * 70)
    print(f"  Baseline inference-only (no gates, L=1): "
          f"{baseline['mean']:.6f}s mean")
    print()

    # Gate 1 only overhead: compare Gate 1 L=1 total vs baseline
    gate1_cfg = configs[0]  # Gate 1 only, L=1
    dual_cfg = configs[2]   # Dual-gate, L=1

    gate1_mean = statistics.mean(gate1_cfg.latencies)
    dual_mean = statistics.mean(dual_cfg.latencies)

    gate1_overhead_abs = gate1_mean - baseline["mean"]
    dual_overhead_abs = dual_mean - baseline["mean"]

    gate1_overhead_pct = (gate1_overhead_abs / baseline["mean"]) * 100 if baseline["mean"] > 0 else 0
    dual_overhead_pct = (dual_overhead_abs / baseline["mean"]) * 100 if baseline["mean"] > 0 else 0

    print(f"  {'Method':<30} {'Overhead (abs)':>15} {'Overhead (%)':>15}")
    print("  " + "-" * 60)
    print(f"  {'Gate 1 only (magnitude)':<30} {gate1_overhead_abs:>14.6f}s {gate1_overhead_pct:>14.2f}%")
    print(f"  {'DACIS (dual-gate)':<30} {dual_overhead_abs:>14.6f}s {dual_overhead_pct:>14.2f}%")

    # ── Detailed timing breakdown ────────────────────────────────────

    print("\n")
    print("=" * 70)
    print("  DETAILED TIMING BREAKDOWN (mean per transaction)")
    print("=" * 70)

    stages = ["graph_update", "subgraph", "inference", "gates", "cache_invalidation", "broadcast"]
    header = f"  {'Config':<25}"
    for stage in stages:
        header += f" {stage[:12]:>12}"
    print(header)
    print("  " + "-" * (25 + 12 * len(stages) + len(stages)))

    for cfg in configs:
        row = f"  {cfg.name:<25}"
        for stage in stages:
            mean_val = statistics.mean(cfg.timing_breakdowns[stage])
            row += f" {mean_val:>12.6f}"
        print(row)

    # ── Paper-ready values ───────────────────────────────────────────

    print("\n")
    print("=" * 70)
    print("  PAPER-READY VALUES (copy-paste into LaTeX)")
    print("=" * 70)

    print("\n  % Table VIII latency values")
    for cfg in configs:
        mean_lat = statistics.mean(cfg.latencies)
        # Format as scientific notation if very small, otherwise fixed
        if mean_lat < 0.001:
            print(f"  % {cfg.name}: {mean_lat:.2e} s")
        else:
            print(f"  % {cfg.name}: {mean_lat:.4f} s")

    print(f"\n  % Table VII overhead values")
    print(f"  % Gate 1 only (magnitude): {gate1_overhead_pct:.2f}%")
    print(f"  % DACIS (dual-gate):       {dual_overhead_pct:.2f}%")

    # Also compute gate-time-only overhead (more precise)
    gate1_gate_time = statistics.mean(gate1_cfg.timing_breakdowns["gates"])
    dual_gate_time = statistics.mean(dual_cfg.timing_breakdowns["gates"])
    gate1_gate_pct = (gate1_gate_time / baseline["mean"]) * 100 if baseline["mean"] > 0 else 0
    dual_gate_pct = (dual_gate_time / baseline["mean"]) * 100 if baseline["mean"] > 0 else 0

    print(f"\n  % Alternative: gate-evaluation-only overhead")
    print(f"  % Gate 1 only gate time:  {gate1_gate_time:.6f}s ({gate1_gate_pct:.2f}% of baseline)")
    print(f"  % Dual-gate gate time:    {dual_gate_time:.6f}s ({dual_gate_pct:.2f}% of baseline)")


if __name__ == "__main__":
    # Seed for reproducibility
    random.seed(42)
    np.random.seed(42)

    asyncio.run(main())
