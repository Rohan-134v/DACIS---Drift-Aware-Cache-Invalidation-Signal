import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/transactions?search=&category=
router.get("/", authenticate, async (req, res) => {
  // Get all account IDs belonging to this user
  const accSnap = await db.collection("accounts").where("userId", "==", req.user.uid).get();
  const accountIds = accSnap.docs.map((d) => d.id);
  if (!accountIds.length) return res.json([]);

  try {
    const txSnap = await db
      .collection("transactions")
      .where("accountId", "in", accountIds)
      .limit(100)
      .get();

    let txns = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Sort in memory to avoid needing a composite index
    txns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const { search, category } = req.query;
    if (search) txns = txns.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
    if (category) txns = txns.filter((t) => t.category?.toLowerCase() === category.toLowerCase());

    res.json(txns);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

export default router;
