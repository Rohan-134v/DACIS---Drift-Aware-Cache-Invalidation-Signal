"""
Tests for app.gates.dual_gate — dual-gate scoring with anti-leakage.

Critical correctness tests:
    1. Anti-leakage: a flagged point's values never appear in its own
       tracker's mean/M2 afterward.
    2. Gate 2 boost disabled (default): dg_score is IDENTICAL whether
       gate2_confirmed is True or False.
    3. Gate 2 boost enabled: dg_score is correctly multiplied by 1.2
       when gate2_confirmed is True.
"""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pytest

from app.gates.dual_gate import DualGateEvaluator, GateResult
from app.gates.welford import WelfordVectorTracker


DIM = 8
BURN_IN = 5
Z_THRESH = 3.0


def _make_evaluator(
    account_burn_in: int = BURN_IN,
    community_burn_in: int = BURN_IN,
) -> DualGateEvaluator:
    account_tracker = WelfordVectorTracker(
        dim=DIM, burn_in=account_burn_in, z_thresh=Z_THRESH
    )
    community_tracker = WelfordVectorTracker(
        dim=DIM, burn_in=community_burn_in, z_thresh=Z_THRESH
    )
    return DualGateEvaluator(account_tracker, community_tracker)


def _warm_up_tracker(
    tracker: WelfordVectorTracker,
    entity_id: str,
    n: int = 20,
    rng: np.random.RandomState | None = None,
) -> None:
    """Feed *n* near-zero observations to build a tight baseline."""
    if rng is None:
        rng = np.random.RandomState(42)
    for _ in range(n):
        tracker.update(entity_id, rng.randn(DIM) * 0.1)


# ── Anti-leakage exclusion ──────────────────────────────────────────────


class TestAntiLeakage:
    """A flagged observation must be scored against the CURRENT baseline
    then EXCLUDED from updating that baseline.

    Getting this order wrong (updating before checking, or updating
    regardless of flag) silently corrupts the baseline — this was a
    real, previously-diagnosed bug class in the DACIS research phase.
    """

    def test_flagged_point_not_in_account_tracker(self):
        """After a Gate 1 flag, the flagged point's values must NOT
        appear in the account tracker's mean or M2."""
        evaluator = _make_evaluator()
        account_id = "test_account"
        community_root = "test_community"

        rng = np.random.RandomState(42)

        # Warm up both trackers with a tight baseline near zero
        _warm_up_tracker(evaluator.account_tracker, account_id, 30, rng)
        _warm_up_tracker(evaluator.community_tracker, community_root, 30, rng)

        # Record the baseline BEFORE the anomalous point
        stats_before = evaluator.account_tracker.get_stats(account_id)
        mean_before = stats_before.mean.copy()
        m2_before = stats_before.M2
        count_before = stats_before.count

        # Submit an extreme outlier — should trigger Gate 1
        outlier = np.ones(DIM) * 100.0
        result = evaluator.score_transaction(
            account_id, community_root, outlier, prob_base=0.5
        )

        assert result.gate1_fired is True

        # Verify: stats must be UNCHANGED — the flagged point was excluded
        stats_after = evaluator.account_tracker.get_stats(account_id)
        assert stats_after.count == count_before
        np.testing.assert_array_equal(stats_after.mean, mean_before)
        assert stats_after.M2 == m2_before

    def test_non_flagged_point_updates_tracker(self):
        """A normal (non-flagged) point SHOULD update the tracker."""
        evaluator = _make_evaluator()
        account_id = "test_account"
        community_root = "test_community"

        rng = np.random.RandomState(42)
        _warm_up_tracker(evaluator.account_tracker, account_id, 30, rng)
        _warm_up_tracker(evaluator.community_tracker, community_root, 30, rng)

        count_before = evaluator.account_tracker.get_stats(account_id).count

        # Submit a normal point near the baseline
        normal = rng.randn(DIM) * 0.1
        result = evaluator.score_transaction(
            account_id, community_root, normal, prob_base=0.1
        )

        assert result.gate1_fired is False
        # Count should have incremented
        assert evaluator.account_tracker.get_stats(account_id).count == count_before + 1

    def test_flagged_point_not_in_community_tracker(self):
        """After a Gate 2 flag, the flagged point's values must NOT
        appear in the community tracker's mean or M2."""
        evaluator = _make_evaluator()
        account_id = "test_account"
        community_root = "test_community"

        rng = np.random.RandomState(42)
        _warm_up_tracker(evaluator.account_tracker, account_id, 30, rng)
        _warm_up_tracker(evaluator.community_tracker, community_root, 30, rng)

        stats_before = evaluator.community_tracker.get_stats(community_root)
        count_before = stats_before.count
        mean_before = stats_before.mean.copy()
        m2_before = stats_before.M2

        # We need an outlier that fires both gates.
        # Gate 1 fires → dg_score gets 1.5× boost.
        # Gate 2 fires → community tracker should NOT be updated.
        outlier = np.ones(DIM) * 100.0
        result = evaluator.score_transaction(
            account_id, community_root, outlier, prob_base=0.5
        )

        # Gate 2 should have fired (same outlier against community baseline)
        assert result.gate2_confirmed is True

        # Community stats must be UNCHANGED
        stats_after = evaluator.community_tracker.get_stats(community_root)
        assert stats_after.count == count_before
        np.testing.assert_array_equal(stats_after.mean, mean_before)
        assert stats_after.M2 == m2_before


# ── Gate 2 score boost ──────────────────────────────────────────────────


class TestGate2ScoreBoost:
    """When GATE2_SCORE_BOOST_ENABLED is False (default), dg_score must
    be IDENTICAL whether gate2_confirmed is True or False.

    This test catches a regression to the incorrect unconditional-boost
    behaviour.
    """

    def test_dg_score_identical_when_boost_disabled(self):
        """dg_score must NOT change based on gate2_confirmed when the
        boost flag is at its default (False)."""
        prob_base = 0.5

        # Scenario A: gate1 fires, gate2 also fires (both anomalous)
        evaluator_a = _make_evaluator()
        rng = np.random.RandomState(42)
        _warm_up_tracker(evaluator_a.account_tracker, "acct", 30, rng)
        _warm_up_tracker(evaluator_a.community_tracker, "comm", 30, rng)

        outlier = np.ones(DIM) * 100.0
        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            result_a = evaluator_a.score_transaction(
                "acct", "comm", outlier, prob_base
            )

        assert result_a.gate1_fired is True
        assert result_a.gate2_confirmed is True

        # Scenario B: gate1 fires, gate2 does NOT fire
        evaluator_b = _make_evaluator()
        rng2 = np.random.RandomState(42)
        _warm_up_tracker(evaluator_b.account_tracker, "acct", 30, rng2)
        # Don't warm up community tracker — burn-in not met → gate2 won't fire
        # (gate2_confirmed will be False because z_score returns None)

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            result_b = evaluator_b.score_transaction(
                "acct", "comm_cold", outlier, prob_base
            )

        assert result_b.gate1_fired is True
        assert result_b.gate2_confirmed is False

        # THE CRITICAL ASSERTION: dg_score must be identical
        assert result_a.dg_score == result_b.dg_score

    def test_dg_score_boosted_when_flag_enabled(self):
        """When GATE2_SCORE_BOOST_ENABLED=True AND gate2 confirms,
        dg_score should be multiplied by 1.2."""
        prob_base = 0.5

        evaluator = _make_evaluator()
        rng = np.random.RandomState(42)
        _warm_up_tracker(evaluator.account_tracker, "acct", 30, rng)
        _warm_up_tracker(evaluator.community_tracker, "comm", 30, rng)

        outlier = np.ones(DIM) * 100.0

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = True
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            result = evaluator.score_transaction(
                "acct", "comm", outlier, prob_base
            )

        assert result.gate1_fired is True
        assert result.gate2_confirmed is True

        # dg_score = min(1.0, 0.5 * 1.5 * 1.2) = min(1.0, 0.9) = 0.9
        expected = min(1.0, prob_base * 1.5 * 1.2)
        assert result.dg_score == pytest.approx(expected)

    def test_no_boost_when_gate1_does_not_fire(self):
        """When gate1 does NOT fire, dg_score = prob_base (no boost)."""
        evaluator = _make_evaluator()
        rng = np.random.RandomState(42)
        _warm_up_tracker(evaluator.account_tracker, "acct", 30, rng)
        _warm_up_tracker(evaluator.community_tracker, "comm", 30, rng)

        # Normal point near baseline
        normal = rng.randn(DIM) * 0.1
        prob_base = 0.3

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = False
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            result = evaluator.score_transaction(
                "acct", "comm", normal, prob_base
            )

        assert result.gate1_fired is False
        assert result.dg_score == pytest.approx(prob_base)

    def test_dg_score_capped_at_1(self):
        """dg_score must never exceed 1.0 even with all boosts."""
        prob_base = 0.9  # 0.9 * 1.5 * 1.2 = 1.62 → capped at 1.0

        evaluator = _make_evaluator()
        rng = np.random.RandomState(42)
        _warm_up_tracker(evaluator.account_tracker, "acct", 30, rng)
        _warm_up_tracker(evaluator.community_tracker, "comm", 30, rng)

        outlier = np.ones(DIM) * 100.0

        with patch("app.gates.dual_gate.settings") as mock_settings:
            mock_settings.GATE2_SCORE_BOOST_ENABLED = True
            mock_settings.GATE1_BOOST_MULTIPLIER = 1.5
            mock_settings.GATE2_BOOST_MULTIPLIER = 1.2
            result = evaluator.score_transaction(
                "acct", "comm", outlier, prob_base
            )

        assert result.dg_score == pytest.approx(1.0)
