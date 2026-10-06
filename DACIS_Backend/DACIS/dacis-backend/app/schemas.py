"""
Pydantic schemas for DACIS API request / response models.

These are the contracts between the FastAPI route handlers and the
pipeline, and between the backend and any connected WebSocket clients.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ── Inbound ──────────────────────────────────────────────────────────────


class TransactionRequest(BaseModel):
    """A single incoming transaction to be scored."""

    transaction_id: str = Field(..., description="Unique transaction identifier.")
    sender_id: str = Field(..., description="Account ID of the transaction sender.")
    receiver_id: str = Field(..., description="Account ID of the transaction receiver.")
    amount: float = Field(..., description="Transaction amount.")
    timestamp: float = Field(..., description="Unix epoch timestamp of the transaction.")
    features: Optional[List[float]] = Field(
        default=None,
        description=(
            "Optional raw feature vector for the sender node. If omitted the "
            "pipeline uses the current features stored in graph_store."
        ),
    )


# ── Outbound ─────────────────────────────────────────────────────────────


class TransactionResponse(BaseModel):
    """Result of scoring a single transaction, broadcast over WebSocket."""

    transaction_id: str
    sender_id: str
    receiver_id: str
    amount: float
    timestamp: float

    # Model output
    prob_base: float = Field(
        ...,
        description="Raw fraud probability from the GraphSAGE model (before gate boosts).",
    )

    # Gate results — always present regardless of config flags
    gate1_fired: bool = Field(
        ...,
        description="True if the account-level Welford z-score exceeded Z_THRESH.",
    )
    gate2_confirmed: bool = Field(
        ...,
        description=(
            "True if the community-level Welford z-score exceeded GATE2_Z_THRESH. "
            "Informational badge — does NOT affect dg_score unless "
            "GATE2_SCORE_BOOST_ENABLED is True."
        ),
    )
    dg_score: float = Field(
        ...,
        description=(
            "Final drift-gated fraud score. Equals prob_base when Gate 1 does "
            "not fire; equals min(1.0, prob_base × 1.5) when Gate 1 fires; "
            "optionally multiplied by 1.2 if Gate 2 confirms AND the boost "
            "flag is enabled."
        ),
    )

    # Cache invalidation info
    cache_invalidated_accounts: List[str] = Field(
        default_factory=list,
        description="Account IDs whose cached embeddings were invalidated by this transaction.",
    )

    # Optional diagnostics
    z_score_account: Optional[float] = Field(
        default=None, description="Account-level z-score (None if burn-in not met)."
    )
    z_score_community: Optional[float] = Field(
        default=None, description="Community-level z-score (None if burn-in not met)."
    )
    community_root: Optional[str] = Field(
        default=None, description="Union-find community root for the sender."
    )

    # Timing diagnostics (populated by pipeline instrumentation)
    latency_total_s: Optional[float] = Field(
        default=None,
        description="Total end-to-end pipeline wall time in seconds.",
    )
    latency_graph_update_s: Optional[float] = Field(
        default=None,
        description="Wall time for graph mutation + union-find in seconds.",
    )
    latency_subgraph_s: Optional[float] = Field(
        default=None,
        description="Wall time for L-hop BFS subgraph extraction in seconds.",
    )
    latency_inference_s: Optional[float] = Field(
        default=None,
        description="Wall time for model get_embedding() + predict_prob() in seconds.",
    )
    latency_gates_s: Optional[float] = Field(
        default=None,
        description="Wall time for dual-gate scoring (Gate 1 + Gate 2 Welford) in seconds.",
    )
    latency_cache_invalidation_s: Optional[float] = Field(
        default=None,
        description="Wall time for targeted cache invalidation in seconds.",
    )
    latency_broadcast_s: Optional[float] = Field(
        default=None,
        description="Wall time for WebSocket broadcast in seconds.",
    )


# ── Operational endpoints ────────────────────────────────────────────────


class CacheStats(BaseModel):
    """Embedding cache occupancy for both tiers."""

    l1_size: int = Field(..., description="Current number of entries in the L1 in-process LRU cache.")
    l1_max_size: int = Field(..., description="Maximum L1 cache capacity.")
    l2_key_count: int = Field(
        ..., description="Approximate number of embedding keys in L2 (Redis)."
    )


class HealthResponse(BaseModel):
    """Health check result."""

    status: str = Field(..., description="'ok' or 'degraded'.")
    redis_connected: bool
    model_loaded: bool


class BurstRequest(BaseModel):
    """Query parameters for the burst injection endpoint."""

    ring_size: int = Field(default=6, ge=2, description="Number of accounts in the fraud ring.")
    burst_length: int = Field(
        default=40, ge=1, description="Number of transactions in the burst."
    )
