"""
Welford's online algorithm for streaming mean / variance of *vector*
observations, with scalar M2 (accumulated sum of squared-deviation norms).

This matches the pattern used throughout the DACIS research notebooks:
we track a vector mean but only the *scalar* total variance (norm of
deviation), NOT a full covariance matrix.

Key operations
--------------
* **Single-point update** — standard Welford.
* **Pairwise merge** — Chan et al. parallel-variance algorithm,
  generalised to vector means with scalar M2.  Used when union-find
  joins two communities so their stats can be combined without
  replaying raw observations.

Correctness contract for merge():
    merge(a, b) must produce IDENTICAL stats to feeding all of a's
    and b's raw observations into a single fresh tracker in sequence.
    This is explicitly tested in ``tests/test_welford.py``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Optional

import numpy as np


@dataclass
class EntityStats:
    """Running Welford statistics for a single entity (account or community).

    Attributes
    ----------
    count : int
        Number of observations incorporated.
    mean : np.ndarray
        Running mean vector (dimension = model hidden dim).
    M2 : float
        Accumulated sum of squared deviation *norms* (scalar).
        ``M2 = Σ_i ||x_i − mean_after_i||² · correction``
        following the standard Welford recurrence; see ``update()``.
    """

    count: int = 0
    mean: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float64))
    M2: float = 0.0


class WelfordVectorTracker:
    """Maintains per-entity Welford trackers keyed by string ID.

    Parameters
    ----------
    dim : int
        Embedding dimension (must match model hidden dim).
    burn_in : int
        Minimum observation count before ``z_score`` returns a value.
    z_thresh : float
        Z-score threshold used by ``is_anomaly()``.
    """

    def __init__(self, dim: int, burn_in: int, z_thresh: float) -> None:
        self.dim = dim
        self.burn_in = burn_in
        self.z_thresh = z_thresh
        self._stats: Dict[str, EntityStats] = {}

    # ── accessors ────────────────────────────────────────────────────────

    def get_stats(self, entity_id: str) -> EntityStats:
        """Return stats for *entity_id*, creating a fresh tracker if absent."""
        if entity_id not in self._stats:
            self._stats[entity_id] = EntityStats(
                count=0,
                mean=np.zeros(self.dim, dtype=np.float64),
                M2=0.0,
            )
        return self._stats[entity_id]

    def set_stats(self, entity_id: str, stats: EntityStats) -> None:
        """Directly set stats for an entity (used when loading from Redis)."""
        self._stats[entity_id] = stats

    def remove_stats(self, entity_id: str) -> None:
        """Remove an entity's stats (used after a union-find merge)."""
        self._stats.pop(entity_id, None)

    # ── single-point update (standard Welford) ───────────────────────────

    def update(self, entity_id: str, x: np.ndarray) -> None:
        """Incorporate observation *x* into the tracker for *entity_id*.

        Standard Welford recurrence:
            count  += 1
            delta   = x - mean
            mean   += delta / count
            delta2  = x - mean          (recomputed AFTER mean update)
            M2     += dot(delta, delta2)
        """
        x = np.asarray(x, dtype=np.float64)
        s = self.get_stats(entity_id)
        s.count += 1
        delta = x - s.mean
        s.mean = s.mean + delta / s.count
        delta2 = x - s.mean  # recomputed after mean update
        s.M2 += float(np.dot(delta, delta2))

    # ── z-score ──────────────────────────────────────────────────────────

    def z_score(self, entity_id: str, x: np.ndarray) -> Optional[float]:
        """Compute the z-score of *x* against the current baseline for *entity_id*.

        Returns ``None`` if the entity has fewer than ``burn_in`` observations
        (insufficient history means "cannot evaluate", not "fires").
        """
        s = self.get_stats(entity_id)
        if s.count < self.burn_in:
            return None

        variance = s.M2 / max(s.count - 1, 1)
        std = math.sqrt(max(variance, 1e-8))  # epsilon floor to avoid div-by-zero
        diff = np.asarray(x, dtype=np.float64) - s.mean
        return float(np.linalg.norm(diff)) / std

    # ── anomaly check ────────────────────────────────────────────────────

    def is_anomaly(self, entity_id: str, x: np.ndarray) -> tuple[bool, Optional[float]]:
        """Check if *x* is anomalous for *entity_id*.

        Returns ``(fired, z)`` where *fired* is True if the z-score
        exceeds ``z_thresh``, and *z* is the computed z-score (or None
        if burn-in is not met — in which case *fired* is always False).
        """
        z = self.z_score(entity_id, x)
        if z is None:
            return False, None
        return z > self.z_thresh, z

    # ── pairwise merge (Chan et al.) ─────────────────────────────────────

    @staticmethod
    def merge_stats(a: EntityStats, b: EntityStats) -> EntityStats:
        """Merge two EntityStats using the Chan et al. parallel-variance formula.

        Given stats_a = (n_a, mean_a, M2_a) and stats_b = (n_b, mean_b, M2_b):
            n_ab   = n_a + n_b
            delta  = mean_b - mean_a
            mean_ab = mean_a + delta × (n_b / n_ab)
            M2_ab  = M2_a + M2_b + dot(delta, delta) × (n_a × n_b / n_ab)

        This is the parallel-variance algorithm generalised to vector means
        with scalar M2.

        Correctness contract: ``merge_stats(a, b)`` produces identical
        stats to feeding all of a's and b's raw observations into a single
        fresh tracker in sequence.
        """
        if a.count == 0:
            return EntityStats(count=b.count, mean=b.mean.copy(), M2=b.M2)
        if b.count == 0:
            return EntityStats(count=a.count, mean=a.mean.copy(), M2=a.M2)

        n_ab = a.count + b.count
        delta = b.mean - a.mean
        mean_ab = a.mean + delta * (b.count / n_ab)
        M2_ab = a.M2 + b.M2 + float(np.dot(delta, delta)) * (a.count * b.count / n_ab)

        return EntityStats(count=n_ab, mean=mean_ab, M2=M2_ab)

    def merge(self, winner_id: str, loser_id: str) -> None:
        """Merge *loser_id*'s stats into *winner_id*, then discard the loser.

        Called by union-find when two communities are joined.
        """
        winner_stats = self.get_stats(winner_id)
        loser_stats = self.get_stats(loser_id)
        merged = self.merge_stats(winner_stats, loser_stats)
        self._stats[winner_id] = merged
        self.remove_stats(loser_id)
