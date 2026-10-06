import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";
import bcrypt from "bcryptjs";

const router = Router();

const owns = async (cardId, uid) => {
  const doc = await db.collection("cards").doc(cardId).get();
  if (!doc.exists || doc.data().userId !== uid) return null;
  return doc;
};

// GET /api/cards
router.get("/", authenticate, async (req, res) => {
  try {
    const snap = await db.collection("cards").where("userId", "==", req.user.uid).get();
    res.json(snap.docs.map((d) => {
      const { pin, fullNumber, cvv, ...safe } = d.data();
      return { id: d.id, ...safe, hasPin: !!pin };
    }));
  } catch (err) {
    console.error("GET /cards error:", err);
    res.status(500).json({ message: "Failed to fetch cards" });
  }
});

// POST /api/cards — issue new card
router.post("/", authenticate, async (req, res) => {
  try {
    const { cardType, name } = req.body;
    if (!cardType || !["virtual", "physical"].includes(cardType))
      return res.status(400).json({ message: "cardType must be 'virtual' or 'physical'." });

    const userSnap = await db.collection("users").doc(req.user.uid).get();
    const holder = userSnap.exists ? (userSnap.data().name?.toUpperCase() || "CARDHOLDER") : (req.user.name?.toUpperCase() || "CARDHOLDER");

    const last4 = String(Math.floor(1000 + Math.random() * 9000));
    const fullNumber = `4${Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("")}`;
    const maskedNumber = `\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 ${last4}`;
    const exp = new Date();
    exp.setFullYear(exp.getFullYear() + 3);
    const expiry = `${String(exp.getMonth() + 1).padStart(2, "0")}/${String(exp.getFullYear()).slice(-2)}`;
    const cvv = String(Math.floor(100 + Math.random() * 900));

    const doc = {
      userId: req.user.uid,
      name: name || (cardType === "virtual" ? "Neuro Virtual" : "Neuro Titanium"),
      number: maskedNumber,
      fullNumber,
      last4,
      cvv,
      expiry,
      holder,
      cardType,
      frozen: false,
      hasPin: false,
      spendingLimit: null,
      limits: { online: true, international: false, atm: cardType === "physical" },
      autopays: [],
      createdAt: new Date().toISOString(),
    };

    const accSnap = await db.collection("accounts").where("userId", "==", req.user.uid).limit(1).get();
    if (!accSnap.empty) doc.accountId = accSnap.docs[0].id;

    const ref = await db.collection("cards").add(doc);
    const { pin: _pin, ...safe } = doc;
    res.status(201).json({ id: ref.id, ...safe, hasPin: false });
  } catch (err) {
    console.error("POST /cards error:", err);
    res.status(500).json({ message: "Failed to create card" });
  }
});

// DELETE /api/cards/:id
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const doc = await owns(req.params.id, req.user.uid);
    if (!doc) return res.status(404).json({ message: "Card not found." });
    await db.collection("cards").doc(req.params.id).delete();
    res.json({ message: "Card deleted." });
  } catch (err) {
    console.error("DELETE /cards/:id error:", err);
    res.status(500).json({ message: "Failed to delete card" });
  }
});

// GET /api/cards/:id/reveal
router.get("/:id/reveal", authenticate, async (req, res) => {
  try {
    const doc = await owns(req.params.id, req.user.uid);
    if (!doc) return res.status(404).json({ message: "Card not found." });
    const data = doc.data();
    if (data.pin) {
      const { pin } = req.query;
      if (!pin) return res.status(403).json({ message: "PIN required to reveal card details.", requiresPin: true });
      const valid = await bcrypt.compare(String(pin), data.pin);
      if (!valid) return res.status(403).json({ message: "Incorrect PIN.", requiresPin: true });
    }
    res.json({ fullNumber: data.fullNumber || data.number, cvv: data.cvv || "•••", expiry: data.expiry });
  } catch (err) {
    console.error("GET /reveal error:", err);
    res.status(500).json({ message: "Failed to reveal card" });
  }
});

// PATCH /api/cards/:id/freeze
router.patch("/:id/freeze", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });
  const frozen = !doc.data().frozen;
  await db.collection("cards").doc(req.params.id).update({ frozen });
  res.json({ frozen, message: frozen ? "Card frozen." : "Card unfrozen." });
});

// PATCH /api/cards/:id/pin — set or change PIN
router.patch("/:id/pin", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const { newPin, currentPin } = req.body;
  if (!newPin || !/^\d{4}$/.test(String(newPin)))
    return res.status(400).json({ message: "PIN must be exactly 4 digits." });

  const data = doc.data();
  // If PIN already set, verify current PIN first
  if (data.pin) {
    if (!currentPin) return res.status(403).json({ message: "Current PIN required." });
    const valid = await bcrypt.compare(String(currentPin), data.pin);
    if (!valid) return res.status(403).json({ message: "Current PIN is incorrect." });
  }

  const hashed = await bcrypt.hash(String(newPin), 10);
  await db.collection("cards").doc(req.params.id).update({ pin: hashed, hasPin: true });
  res.json({ message: "PIN updated successfully." });
});

// PATCH /api/cards/:id/limits — toggle online/international/atm
router.patch("/:id/limits", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const { online, international, atm } = req.body;
  const update = {};
  if (online !== undefined)        update["limits.online"] = Boolean(online);
  if (international !== undefined) update["limits.international"] = Boolean(international);
  if (atm !== undefined)           update["limits.atm"] = Boolean(atm);

  await db.collection("cards").doc(req.params.id).update(update);
  const updated = { ...doc.data().limits, ...{ online, international, atm } };
  res.json({ message: "Limits updated.", limits: updated });
});

// PATCH /api/cards/:id/spending-limit — set daily spend cap
router.patch("/:id/spending-limit", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const { amount } = req.body; // null to remove limit
  if (amount !== null && (isNaN(parseFloat(amount)) || parseFloat(amount) < 0))
    return res.status(400).json({ message: "Amount must be a positive number or null." });

  const spendingLimit = amount === null ? null : parseFloat(amount);
  await db.collection("cards").doc(req.params.id).update({ spendingLimit });
  res.json({ message: spendingLimit === null ? "Spending limit removed." : `Daily limit set to $${spendingLimit}.`, spendingLimit });
});

// GET /api/cards/:id/autopays
router.get("/:id/autopays", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });
  res.json(doc.data().autopays || []);
});

// POST /api/cards/:id/autopays — add autopay
router.post("/:id/autopays", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const { merchant, amount, cycle } = req.body; // cycle: "monthly" | "weekly" | "yearly"
  if (!merchant || !amount || !cycle)
    return res.status(400).json({ message: "merchant, amount, and cycle are required." });

  const entry = {
    id: Date.now().toString(),
    merchant,
    amount: parseFloat(amount),
    cycle,
    active: true,
    nextDate: getNextDate(cycle),
  };

  const autopays = [...(doc.data().autopays || []), entry];
  await db.collection("cards").doc(req.params.id).update({ autopays });
  res.status(201).json(entry);
});

// DELETE /api/cards/:id/autopays/:apId — remove autopay
router.delete("/:id/autopays/:apId", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const autopays = (doc.data().autopays || []).filter((a) => a.id !== req.params.apId);
  await db.collection("cards").doc(req.params.id).update({ autopays });
  res.json({ message: "Autopay removed." });
});

// PATCH /api/cards/:id/autopays/:apId/toggle — pause/resume
router.patch("/:id/autopays/:apId/toggle", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const autopays = (doc.data().autopays || []).map((a) =>
    a.id === req.params.apId ? { ...a, active: !a.active } : a
  );
  await db.collection("cards").doc(req.params.id).update({ autopays });
  const updated = autopays.find((a) => a.id === req.params.apId);
  res.json({ message: updated?.active ? "Autopay resumed." : "Autopay paused.", autopay: updated });
});

// GET /api/cards/:id/transactions — last 20 transactions for this card
router.get("/:id/transactions", authenticate, async (req, res) => {
  const doc = await owns(req.params.id, req.user.uid);
  if (!doc) return res.status(404).json({ message: "Card not found." });

  const last4 = doc.data().last4;
  // Match transactions by card field (stored as **XXXX or last4)
  const snap = await db.collection("transactions")
    .where("accountId", "in", await getUserAccountIds(req.user.uid))
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const txns = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.card && (t.card.includes(last4) || t.card === `**${last4}`));

  res.json(txns);
});

async function getUserAccountIds(uid) {
  const snap = await db.collection("accounts").where("userId", "==", uid).get();
  const ids = snap.docs.map((d) => d.id);
  return ids.length > 0 ? ids : ["__none__"];
}

function getNextDate(cycle) {
  const d = new Date();
  if (cycle === "weekly")  d.setDate(d.getDate() + 7);
  if (cycle === "monthly") d.setMonth(d.getMonth() + 1);
  if (cycle === "yearly")  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
}

export default router;
