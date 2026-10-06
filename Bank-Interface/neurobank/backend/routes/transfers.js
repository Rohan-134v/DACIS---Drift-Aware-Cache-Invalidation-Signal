import { Router } from "express";
import { db } from "../firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { authenticate } from "../middleware/auth.js";
import crypto from "crypto";

const router = Router();

const DACIS_URL = process.env.DACIS_BACKEND_URL || "http://localhost:8000";
const DACIS_THRESHOLD = parseFloat(process.env.DACIS_SCORE_THRESHOLD || "0.7");

/**
 * Score a transfer through the DACIS fraud-detection pipeline.
 *
 * Returns the DACIS TransactionResponse on success, or null if the
 * backend is unreachable (fail-open policy — never block customers
 * because of infra issues).
 */
async function scoreThroughDACIS({ fromAccountId, toAccountId, amount }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${DACIS_URL}/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        transaction_id: `txn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        sender_id: fromAccountId,
        receiver_id: toAccountId,
        amount,
        timestamp: Date.now() / 1000,
      }),
    });

    if (!res.ok) {
      console.warn(`[DACIS] Scoring returned ${res.status} — proceeding without block.`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn(`[DACIS] Backend unreachable — fail-open. ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// POST /api/transfers
router.post("/", authenticate, async (req, res) => {
  const { fromAccountId, toAccountId, amount, note } = req.body;
  if (!fromAccountId || !toAccountId || !amount)
    return res.status(400).json({ message: "fromAccountId, toAccountId, and amount are required." });
  if (fromAccountId === toAccountId)
    return res.status(400).json({ message: "Source and destination accounts cannot be the same." });

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0)
    return res.status(400).json({ message: "Amount must be a positive number." });

  // ── PRE-FLIGHT CHECK: Is account already flagged? ────────────────────────
  try {
    const userSnap = await db.collection("users").doc(req.user.uid).get();
    if (userSnap.exists && userSnap.data().dacis_flagged) {
      return res.status(403).json({
        message: "Account is flagged by DACIS. Transfers are disabled.",
        dacis: { blocked: true }
      });
    }
  } catch (err) {
    console.error("[Transfers] Error checking user flag:", err);
  }

  // ── DACIS Fraud Scoring ──────────────────────────────────────────────────
  // Score the transaction BEFORE executing. If the DACIS pipeline flags it
  // (dg_score > threshold AND gate1 fires), block the transfer and flag
  // the sender's account.
  const dacisResult = await scoreThroughDACIS({
    fromAccountId,
    toAccountId,
    amount: parsedAmount,
  });

  if (dacisResult && dacisResult.gate1_fired && dacisResult.dg_score > DACIS_THRESHOLD) {
    // Auto-flag the user in Firestore
    try {
      const reason = `DACIS auto-flag: dg_score=${dacisResult.dg_score.toFixed(4)}, gate1_fired=true` +
        (dacisResult.gate2_confirmed ? ", gate2_confirmed=true" : "");

      await db.collection("users").doc(req.user.uid).update({
        dacis_flagged: true,
        dacis_reason: reason,
      });

      // Create a security incident
      await db.collection("security_incidents").add({
        userId: req.user.uid,
        reason,
        triggeredBy: "dacis_engine",
        resolved: false,
        createdAt: new Date().toISOString(),
        dacis_details: {
          transaction_id: dacisResult.transaction_id,
          sender_id: dacisResult.sender_id,
          receiver_id: dacisResult.receiver_id,
          amount: dacisResult.amount,
          dg_score: dacisResult.dg_score,
          prob_base: dacisResult.prob_base,
          gate1_fired: dacisResult.gate1_fired,
          gate2_confirmed: dacisResult.gate2_confirmed,
          z_score_account: dacisResult.z_score_account,
          z_score_community: dacisResult.z_score_community,
          community_root: dacisResult.community_root,
          cache_invalidated_accounts: dacisResult.cache_invalidated_accounts,
        },
      });
    } catch (flagErr) {
      console.error("[DACIS] Failed to flag user:", flagErr.message);
    }

    return res.status(403).json({
      message: "Transfer blocked by DACIS fraud detection.",
      dacis: {
        blocked: true,
        dg_score: dacisResult.dg_score,
        gate1_fired: dacisResult.gate1_fired,
        gate2_confirmed: dacisResult.gate2_confirmed,
      },
    });
  }
  // ──────────────────────────────────────────────────────────────────────────

  const fromRef = db.collection("accounts").doc(fromAccountId);
  const toRef = db.collection("accounts").doc(toAccountId);

  try {
    let newBalance;
    await db.runTransaction(async (t) => {
      const fromDoc = await t.get(fromRef);
      const toDoc = await t.get(toRef);

      if (!fromDoc.exists || fromDoc.data().userId !== req.user.uid)
        throw Object.assign(new Error("Source account not found."), { status: 404 });
      if (!toDoc.exists)
        throw Object.assign(new Error("Destination account not found."), { status: 404 });
      if (fromDoc.data().balance < parsedAmount)
        throw Object.assign(new Error("Insufficient funds."), { status: 400 });

      t.update(fromRef, { balance: FieldValue.increment(-parsedAmount) });
      t.update(toRef, { balance: FieldValue.increment(parsedAmount) });
      newBalance = fromDoc.data().balance - parsedAmount;
    });

    // Record transaction
    const txRef = await db.collection("transactions").add({
      accountId: fromAccountId,
      icon: "sync_alt",
      name: note || "Internal Transfer",
      category: "Transfer",
      amount: -parsedAmount,
      card: "INTERNAL",
      createdAt: new Date().toISOString(),
    });

    res.json({
      message: "Transfer successful.",
      transactionId: txRef.id,
      newBalance,
      // Include DACIS scoring info for transparency (when available)
      ...(dacisResult && {
        dacis: {
          blocked: false,
          dg_score: dacisResult.dg_score,
          gate1_fired: dacisResult.gate1_fired,
          gate2_confirmed: dacisResult.gate2_confirmed,
        },
      }),
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
