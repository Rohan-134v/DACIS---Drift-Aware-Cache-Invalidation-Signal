import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

const DACIS_URL = process.env.DACIS_BACKEND_URL || "http://localhost:8000";

// GET /api/dacis/engine-status
// Returns whether the DACIS ML backend is reachable + health info
router.get("/engine-status", authenticate, async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${DACIS_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await resp.json();
    res.json({ reachable: true, ...data });
  } catch {
    res.json({ reachable: false, status: "offline", redis_connected: false, model_loaded: false });
  }
});

// GET /api/dacis/check
// Evaluates security risk signals for the authenticated user.
// Returns { flagged: boolean, reason?: string }
router.get("/check", authenticate, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userSnap = await db.collection("users").doc(uid).get();

    if (!userSnap.exists) return res.json({ flagged: false });

    const user = userSnap.data();

    // ── Risk Signal 1: account explicitly suspended by admin ──
    if (user.suspended) {
      return res.json({ flagged: true, reason: "account_suspended" });
    }

    // ── Risk Signal 2: dacis_flagged field set by admin or fraud system ──
    if (user.dacis_flagged) {
      return res.json({ flagged: true, reason: user.dacis_reason || "security_intervention" });
    }

    // ── Risk Signal 3: check for any open security incidents ──
    const incidentSnap = await db
      .collection("security_incidents")
      .where("userId", "==", uid)
      .where("resolved", "==", false)
      .limit(1)
      .get();

    if (!incidentSnap.empty) {
      const incident = incidentSnap.docs[0].data();
      return res.json({ flagged: true, reason: incident.reason || "open_incident" });
    }

    res.json({ flagged: false });
  } catch (err) {
    console.error("DACIS check error:", err);
    // On error, do NOT flag — fail open to avoid locking out users on infra issues
    res.json({ flagged: false });
  }
});

// POST /api/dacis/flag  — admin triggers a manual flag on a user
router.post("/flag", authenticate, async (req, res) => {
  const callerSnap = await db.collection("users").doc(req.user.uid).get();
  if (callerSnap.data()?.role !== "admin")
    return res.status(403).json({ message: "Admin access required." });

  const { targetUid, reason } = req.body;
  if (!targetUid) return res.status(400).json({ message: "targetUid required." });

  await db.collection("users").doc(targetUid).update({
    dacis_flagged: true,
    dacis_reason: reason || "manual_flag",
  });

  // Also create an incident record
  await db.collection("security_incidents").add({
    userId: targetUid,
    reason: reason || "manual_flag",
    triggeredBy: req.user.uid,
    resolved: false,
    createdAt: new Date().toISOString(),
  });

  res.json({ message: "User flagged for DACIS intervention." });
});

// POST /api/dacis/resolve  — clear the flag (admin or user self-verify)
router.post("/resolve", authenticate, async (req, res) => {
  const { targetUid } = req.body;
  const uid = targetUid || req.user.uid;

  // Only admins can resolve other users; users can resolve themselves
  if (uid !== req.user.uid) {
    const callerSnap = await db.collection("users").doc(req.user.uid).get();
    if (callerSnap.data()?.role !== "admin")
      return res.status(403).json({ message: "Admin access required." });
  }

  await db.collection("users").doc(uid).update({
    dacis_flagged: false,
    dacis_reason: null,
  });

  // Resolve all open incidents for this user
  const incidentSnap = await db
    .collection("security_incidents")
    .where("userId", "==", uid)
    .where("resolved", "==", false)
    .get();

  const batch = db.batch();
  incidentSnap.docs.forEach((d) =>
    batch.update(d.ref, { resolved: true, resolvedAt: new Date().toISOString() })
  );
  await batch.commit();

  res.json({ message: "DACIS flag cleared." });
});


export default router;
