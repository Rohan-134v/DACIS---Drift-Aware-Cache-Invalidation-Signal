# DACIS Backend

Live streaming fraud-detection middleware demonstrating drift-aware cache
invalidation for temporal GNN inference, built on validated research
findings from the DACIS project (AMLSim evaluation, Gate 1 precision
99.21%, n=380 flagged transactions, 377 true positives / 3 false positives).

## Architecture
Transaction ──▶ FastAPI ingest ──▶ pipeline.process_transaction()
│
┌─────────────────────┼─────────────────────┐
▼                     ▼                     ▼
graph_store          dacis_model.py           gates/
(adjacency + features)   (GraphSAGE inference   (Gate 1 + Gate 2)
get_subgraph(L=1)        on L-hop subgraph)
│                     │                     │
└─────────────────────┴─────────────────────┘
│
▼
embedding_cache (L1 LRU + L2 Redis)
stats_store (Welford state, Redis)
union_find (community roots, Redis)
│
▼
dg_score + WebSocket broadcast

Each incoming transaction touches only the sender's L-hop subgraph — this
is the concrete implementation of DACIS's "partial re-embedding" claim.
The graph is never fully recomputed.

## Gate Math

**Gate 1 — Account Welford Tripwire** (validated, scores `dg_score`)

For account `v` with new embedding `z_v`:
fires if  ||z_v − μ_v|| / σ_v  >  Z_THRESH

`μ_v`, `σ_v` are maintained online via Welford's algorithm (O(1) per
update). An account needs `count >= BURN_IN_MIN_COUNT` observations
before it can fire — insufficient history means "cannot evaluate," not
"fires." A flagged transaction is scored against the current baseline
but **excluded** from updating that baseline (anti-leakage: a drifting
account cannot normalize its own escalation into its own comparison
distribution).

**Gate 2 — Community Welford Confirmation** (diagnostic only by default)

Same Welford check, applied to the mean embedding of an account's
weakly-connected community (tracked incrementally via union-find, merged
via the pairwise Welford combination formula on every union). **This
gate does NOT multiply `dg_score` unless `GATE2_SCORE_BOOST_ENABLED=true`
in config.** Research validation (see `docs/gate2_findings.md` or
project paper) found no independent discriminative signal for Gate 2
across four evaluated datasets when tested on the population Gate 1
did not already flag — testing Gate 2 only on Gate-1-flagged nodes
produces a spurious near-100% confirmation rate due to selection bias,
not real signal. Gate 2's result is still computed and surfaced (useful
as a UI badge / research demo toggle) but must not silently inflate the
reported fraud probability in the default configuration.

**Score fusion (when Gate 1 fires):**
dg_score = min(1.0, prob_base × 1.5)
if GATE2_SCORE_BOOST_ENABLED and gate2_confirmed:
dg_score = min(1.0, dg_score × 1.2)

## Memory Management

- **Graph store**: adjacency + running feature aggregates held in-process.
  Grows with unique accounts seen; no eviction by default (bounded by
  demo pool size). For long-running deployments, add an LRU account
  eviction policy keyed on last-seen timestamp.
- **Embedding cache**: two-tier. L1 is an in-process LRU (fast path, no
  network hop). L2 is Redis (`volatile-lru` eviction policy in
  `docker-compose.yml`), acting as the durable/shared serving cache DACIS
  actually invalidates — `DEL` on a specific account key is the literal
  "targeted L-hop invalidation" the architecture is built around, not a
  blanket flush.
- **Welford stats** (account + community): persisted in Redis via
  `stats_store.py`, so gate state survives backend restarts.
- **Union-find**: parent pointers persisted in Redis; `find()` uses path
  compression, but path compression over a remote store means every
  compressed edge is a round-trip — keep an in-process parent-pointer
  cache as the fast path, flushing to Redis periodically or on merge
  events only, rather than on every `find()` call.

## Running

```bash
cp .env.example .env
docker compose up --build
```

Backend on `:8000`. Redis on `:6379`.

## Integration

- `POST /burst/trigger?ring_size=6&burst_length=40` — injects a
  synthetic coordinated fraud ring (tight counterparty set, elevated
  velocity, distinct amount profile) into the live stream.
- `WS /ws/stream` — every processed transaction, as JSON
  (`TransactionResponse`), including `gate1_fired`, `gate2_confirmed`,
  `dg_score`, `cache_invalidated_accounts`.
- `GET /cache/stats` — current cache occupancy (both tiers).
- `GET /health` — Redis connectivity + model load status.