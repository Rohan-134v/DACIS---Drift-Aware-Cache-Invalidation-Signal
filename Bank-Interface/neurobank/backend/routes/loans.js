import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

// ── Customer routes ───────────────────────────────────────────────────────────

// GET /api/loans — list user's loans
router.get("/", authenticate, async (req, res) => {
  try {
    const snap = await db.collection("loans").where("userId", "==", req.user.uid).orderBy("createdAt", "desc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("GET /loans error:", err);
    res.status(500).json({ message: "Failed to fetch loans" });
  }
});

// POST /api/loans — apply for a loan
router.post("/", authenticate, async (req, res) => {
  try {
    const { type, amount, tenureMonths, purpose } = req.body;
    const loanTypes = ["home", "auto", "education", "business", "personal"];
    if (!type || !loanTypes.includes(type)) return res.status(400).json({ message: "Invalid loan type." });
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ message: "Amount must be positive." });
    if (!tenureMonths || parseInt(tenureMonths) <= 0) return res.status(400).json({ message: "Tenure must be positive." });

    const rateMap = { home: 3.75, auto: 4.25, education: 3.5, business: 5.0, personal: 6.5 };
    const rate = rateMap[type];
    const principal = parseFloat(amount);
    const months = parseInt(tenureMonths);
    const monthlyRate = rate / 100 / 12;
    const emi = monthlyRate === 0 ? principal / months
      : Math.round((principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1) * 100) / 100;

    const userSnap = await db.collection("users").doc(req.user.uid).get();
    const userName = userSnap.exists ? userSnap.data().name : "Unknown";

    const loan = {
      userId: req.user.uid,
      userName,
      type,
      amount: principal,
      tenureMonths: months,
      purpose: purpose || "",
      interestRate: rate,
      emi,
      status: "pending", // pending | approved | rejected | active | closed
      outstanding: principal,
      paidMonths: 0,
      emiAutopay: null,
      disbursedToAccountId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ref = await db.collection("loans").add(loan);
    res.status(201).json({ id: ref.id, ...loan });
  } catch (err) {
    console.error("POST /loans error:", err);
    res.status(500).json({ message: "Failed to apply for loan" });
  }
});

// GET /api/loans/:id — get single loan
router.get("/:id", authenticate, async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ message: "Loan not found." });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch loan" });
  }
});

// POST /api/loans/:id/emi-autopay — set up EMI autopay
router.post("/:id/emi-autopay", authenticate, async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ message: "Loan not found." });
    if (doc.data().status !== "active")
      return res.status(400).json({ message: "EMI autopay can only be set on active loans." });

    const { accountId, dayOfMonth } = req.body;
    if (!accountId) return res.status(400).json({ message: "accountId is required." });
    const day = parseInt(dayOfMonth) || 1;

    // Verify account belongs to user
    const accDoc = await db.collection("accounts").doc(accountId).get();
    if (!accDoc.exists || accDoc.data().userId !== req.user.uid)
      return res.status(404).json({ message: "Account not found." });

    const emiAutopay = { accountId, dayOfMonth: day, active: true, createdAt: new Date().toISOString() };
    await db.collection("loans").doc(req.params.id).update({ emiAutopay, updatedAt: new Date().toISOString() });
    res.json({ message: "EMI autopay set up successfully.", emiAutopay });
  } catch (err) {
    console.error("POST /loans/:id/emi-autopay error:", err);
    res.status(500).json({ message: "Failed to set up EMI autopay" });
  }
});

// DELETE /api/loans/:id/emi-autopay — cancel EMI autopay
router.delete("/:id/emi-autopay", authenticate, async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ message: "Loan not found." });
    await db.collection("loans").doc(req.params.id).update({ emiAutopay: null, updatedAt: new Date().toISOString() });
    res.json({ message: "EMI autopay cancelled." });
  } catch (err) {
    res.status(500).json({ message: "Failed to cancel EMI autopay" });
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/loans/admin/all — list all loans
router.get("/admin/all", authenticate, requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("loans").orderBy("createdAt", "desc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch loans" });
  }
});

// PATCH /api/loans/admin/:id/approve — approve and disburse
router.patch("/admin/:id/approve", authenticate, requireAdmin, async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Loan not found." });
    if (doc.data().status !== "pending") return res.status(400).json({ message: "Only pending loans can be approved." });

    const loan = doc.data();

    // Find user's primary checking account to disburse into
    const accSnap = await db.collection("accounts").where("userId", "==", loan.userId).get();
    if (accSnap.empty) return res.status(404).json({ message: "No account found for this user." });
    const accDoc = accSnap.docs.find(d => d.data().type === "checking") || accSnap.docs[0];
    const accountId = accDoc.id;
    const currentBalance = accDoc.data().balance || 0;

    const batch = db.batch();
    // Credit loan amount to account
    batch.update(db.collection("accounts").doc(accountId), { balance: currentBalance + loan.amount });
    // Record transaction
    batch.set(db.collection("transactions").doc(), {
      accountId,
      icon: "account_balance",
      name: `${loan.type.charAt(0).toUpperCase() + loan.type.slice(1)} Loan Disbursement`,
      category: "Loan",
      amount: loan.amount,
      card: "LOAN",
      createdAt: new Date().toISOString(),
    });
    // Update loan status
    batch.update(db.collection("loans").doc(req.params.id), {
      status: "active",
      disbursedToAccountId: accountId,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await batch.commit();

    res.json({ message: "Loan approved and disbursed.", accountId, amount: loan.amount });
  } catch (err) {
    console.error("PATCH /loans/admin/:id/approve error:", err);
    res.status(500).json({ message: "Failed to approve loan" });
  }
});

// PATCH /api/loans/admin/:id/reject — reject loan
router.patch("/admin/:id/reject", authenticate, requireAdmin, async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Loan not found." });
    if (doc.data().status !== "pending") return res.status(400).json({ message: "Only pending loans can be rejected." });
    const { reason } = req.body;
    await db.collection("loans").doc(req.params.id).update({
      status: "rejected",
      rejectionReason: reason || "Application did not meet criteria.",
      updatedAt: new Date().toISOString(),
    });
    res.json({ message: "Loan rejected." });
  } catch (err) {
    res.status(500).json({ message: "Failed to reject loan" });
  }
});

export default router;
