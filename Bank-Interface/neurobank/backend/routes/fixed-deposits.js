import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/fixed-deposits
router.get("/", authenticate, async (req, res) => {
  try {
    const snap = await db.collection("fixedDeposits").where("userId", "==", req.user.uid).get();
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (error) {
    console.error("Error fetching fixed deposits:", error);
    res.status(500).json({ message: "Failed to fetch fixed deposits" });
  }
});

// POST /api/fixed-deposits
router.post("/", authenticate, async (req, res) => {
  const { vaultType, amount, duration } = req.body;
  
  if (!vaultType || !amount || !duration) {
    return res.status(400).json({ message: "Vault type, amount, and duration are required." });
  }

  try {
    let name = "Shield Tier I";
    let rate = "5.25%";
    if (vaultType === "quantum") {
      name = "Quantum Yield";
      rate = "5.50%";
    } else if (vaultType === "deep") {
      name = "Deep Vault Secure";
      rate = "4.75%";
    }

    const principal = parseFloat(amount);
    const durationMonths = parseInt(duration, 10);
    const rateFloat = parseFloat(rate) / 100;
    const interest = principal * rateFloat * (durationMonths / 12);
    
    const maturityDate = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + durationMonths);
    const maturityFormatted = maturityDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const newFD = {
      userId: req.user.uid,
      name,
      rate,
      principal,
      interest,
      maturity: maturityFormatted,
      status: "Active",
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection("fixedDeposits").add(newFD);
    res.status(201).json({ id: docRef.id, ...newFD });
  } catch (error) {
    console.error("Error creating fixed deposit:", error);
    res.status(500).json({ message: "Failed to create fixed deposit" });
  }
});

export default router;
