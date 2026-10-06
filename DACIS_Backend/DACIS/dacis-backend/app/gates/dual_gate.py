"""
Dual-gate anomaly evaluator — the core scoring logic for DACIS.

Gate 1 (account-level Welford tripwire) and Gate 2 (community-level
Welford confirmation) are applied to each transaction in strict order
with **anti-leakage exclusion**: a flagged observation is scored against
the current baseline then EXCLUDED from updating that baseline.

Order of operations per transaction (MUST NOT be reordered):
    1. compute embedding  (done upstream in pipeline)
    2. gate1_fired = account_tracker.is_anomaly(account_id, embedding)
    3. if NOT gate1_fired: account_tracker.update(account_id, embedding)
    4. gate2_confirmed = community_tracker.is_anomaly(community_root, embedding)
    5. if NOT gate2_confirmed: community_tracker.update(community_root, embedding)
    6. compute dg_score with conditional gate2 boost

Getting steps 2-3 or 4-5 wrong (updating before checking, or updating
regardless of flag) silently corrupts the baseline — this was a real,
previously-diagnosed bug class in the DACIS research phase.

Gate 2 score boost
------------------
``GATE2_SCORE_BOOST_ENABLED`` defaults to ``False``.  Gate 2 showed no
validated independent discriminative signal in research evaluation
across 4 datasets.  The dg_score multiplication by 1.2 ONLY happens if
the flag is explicitly set to ``True``.  Gate 2's result is always
computed and surfaced as an informational badge.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from app.config import settings
from app.gates.welford import WelfordVectorTracker


@dataclass
class GateResult:
    """Result of the dual-gate evaluation for a single transaction."""

    gate1_fired: bool
    gate2_confirmed: bool
    dg_score: float
    z_score_account: Optional[float]
    z_score_community: Optional[float]


class DualGateEvaluator:
    """Evaluates both gates and fuses scores for each transaction.

    Parameters
    ----------
    account_tracker : WelfordVectorTracker
        Per-account Welford tracker (Gate 1).
    community_tracker : WelfordVectorTracker
        Per-community Welford tracker (Gate 2).
    """

    def __init__(
        self,
        account_tracker: WelfordVectorTracker,
        community_tracker: WelfordVectorTracker,
    ) -> None:
        self.account_tracker = account_tracker
        self.community_tracker = community_tracker

    def score_transaction(
        self,
        account_id: str,
        community_root: str,
        embedding: np.ndarray,
        prob_base: float,
    ) -> GateResult:
        """Score a single transaction through both gates.

        Strict anti-leakage order:
            1. Score gate 1 against current account baseline.
            2. Update account baseline ONLY IF gate 1 did NOT fire.
            3. Score gate 2 against current community baseline.
            4. Update community baseline ONLY IF gate 2 did NOT fire.
            5. Compute dg_score with conditional boosts.

        Parameters
        ----------
        account_id : str
            The sender account.
        community_root : str
            Union-find root for the sender's community.
        embedding : np.ndarray
            The freshly-computed embedding for this transaction.
        prob_base : float
            Raw fraud probability from the GraphSAGE model.

        Returns
        -------
        GateResult
            Contains gate1_fired, gate2_confirmed, dg_score, and
            diagnostic z-scores.
        """
        embedding = np.asarray(embedding, dtype=np.float64)

        # ── Gate 1: Account-level ────────────────────────────────────────
        gate1_fired, z_account = self.account_tracker.is_anomaly(
            account_id, embedding
        )

        # Anti-leakage: update ONLY if NOT flagged
        if not gate1_fired:
            self.account_tracker.update(account_id, embedding)

        # ── Gate 2: Community-level ──────────────────────────────────────
        gate2_confirmed, z_community = self.community_tracker.is_anomaly(
            community_root, embedding
        )

        # Anti-leakage: update ONLY if NOT flagged
        if not gate2_confirmed:
            self.community_tracker.update(community_root, embedding)

        # ── Score fusion ─────────────────────────────────────────────────
        if gate1_fired:
            dg_score = min(1.0, prob_base * settings.GATE1_BOOST_MULTIPLIER)
            # Gate 2 boost is gated behind the config flag
            if settings.GATE2_SCORE_BOOST_ENABLED and gate2_confirmed:
                dg_score = min(1.0, dg_score * settings.GATE2_BOOST_MULTIPLIER)
        else:
            # Gate 1 did not fire — no boost, dg_score = raw probability
            dg_score = prob_base

        return GateResult(
            gate1_fired=gate1_fired,
            gate2_confirmed=gate2_confirmed,
            dg_score=dg_score,
            z_score_account=z_account,
            z_score_community=z_community,
        )
