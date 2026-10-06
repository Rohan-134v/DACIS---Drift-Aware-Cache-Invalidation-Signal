"""
DACIS Backend Configuration.

All tunable thresholds, TTLs, dimensions, and feature flags live here.
No magic numbers elsewhere in the codebase — import from ``app.config.settings``.
Uses pydantic-settings to read from ``.env`` at startup.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Central configuration for DACIS backend.

    Every value is documented inline. Reads from ``.env`` file
    and environment variables (env vars take precedence).
    """

    # ── Redis ────────────────────────────────────────────────────────────
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL. Used for L2 cache, stats, and union-find persistence.",
    )

    # ── Model dimensions ─────────────────────────────────────────────────
    MODEL_INPUT_DIM: int = Field(
        default=16,
        description="Number of input features per node (must match training data).",
    )
    MODEL_HIDDEN_DIM: int = Field(
        default=64,
        description=(
            "Hidden dimension / embedding size of the GraphSAGE model. "
            "Also determines the dimensionality of Welford mean vectors."
        ),
    )
    MODEL_PATH: str = Field(
        default="models/dacis_graphsage.pt",
        description="Path to the serialized GraphSAGE state_dict.",
    )

    # ── Gate 1 — Account-level Welford tripwire ──────────────────────────
    Z_THRESH: float = Field(
        default=3.0,
        description=(
            "Z-score threshold for Gate 1 (account-level) anomaly detection. "
            "An embedding is flagged if ||z_v - μ_v|| / σ_v > Z_THRESH."
        ),
    )
    BURN_IN_MIN_COUNT: int = Field(
        default=5,
        description=(
            "Minimum number of observations before an account's Welford tracker "
            "can produce a z-score. Below this, z_score() returns None (cannot "
            "evaluate, not 'fires')."
        ),
    )

    # ── Gate 2 — Community-level Welford confirmation ────────────────────
    GATE2_Z_THRESH: float = Field(
        default=3.0,
        description="Z-score threshold for Gate 2 (community-level) anomaly detection.",
    )
    GATE2_BURN_IN_MIN_COUNT: int = Field(
        default=5,
        description="Minimum observations before a community tracker can produce a z-score.",
    )
    GATE2_SCORE_BOOST_ENABLED: bool = Field(
        default=False,
        description=(
            "Whether Gate 2 confirmation multiplies dg_score by 1.2. "
            "Gate 2 showed no validated independent discriminative signal in "
            "research evaluation across 4 datasets — see README. Enable only "
            "for exploratory/demo purposes, never as a default."
        ),
    )

    # ── Score fusion ─────────────────────────────────────────────────────
    GATE1_BOOST_MULTIPLIER: float = Field(
        default=1.5,
        description="When Gate 1 fires, dg_score = min(1.0, prob_base × this).",
    )
    GATE2_BOOST_MULTIPLIER: float = Field(
        default=1.2,
        description=(
            "When Gate 2 confirms AND GATE2_SCORE_BOOST_ENABLED is True, "
            "dg_score = min(1.0, dg_score × this)."
        ),
    )

    # ── Graph ────────────────────────────────────────────────────────────
    L_HOPS: int = Field(
        default=1,
        description="Number of hops for subgraph extraction around a transaction's sender.",
    )
    MAX_NEIGHBORS_PER_HOP: int = Field(
        default=25,
        description=(
            "Maximum neighbors sampled per hop in subgraph BFS. Caps the "
            "fan-out to keep inference cost bounded."
        ),
    )

    # ── Embedding cache ──────────────────────────────────────────────────
    EMBEDDING_CACHE_L1_MAX_SIZE: int = Field(
        default=10_000,
        description="Max entries in the in-process LRU (L1) embedding cache.",
    )
    EMBEDDING_CACHE_L2_TTL: int = Field(
        default=3600,
        description="TTL in seconds for L2 (Redis) embedding cache entries.",
    )

    # ── Union-find ───────────────────────────────────────────────────────
    UNION_FIND_FLUSH_INTERVAL: int = Field(
        default=100,
        description=(
            "Number of find() calls between periodic flushes of path-compression "
            "updates to Redis. Root changes from union() are always flushed immediately."
        ),
    )

    # ── Burst injection (demo) ───────────────────────────────────────────
    DEFAULT_RING_SIZE: int = Field(
        default=6,
        description="Default number of accounts in a synthetic fraud ring.",
    )
    DEFAULT_BURST_LENGTH: int = Field(
        default=40,
        description="Default number of transactions in a synthetic fraud burst.",
    )

    # ── Server ───────────────────────────────────────────────────────────
    HOST: str = Field(default="0.0.0.0", description="Bind address.")
    PORT: int = Field(default=8000, description="Bind port.")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
