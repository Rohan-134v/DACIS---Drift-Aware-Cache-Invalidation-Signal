import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/accounts
router.get("/", authenticate, async (req, res) => {
  const snap = await db.collection("accounts").where("userId", "==", req.user.uid).get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// GET /api/accounts/verify?number=XXXX
// Looks up any account by its masked number and returns holder name + masked number.
// Used by the transfer form to verify a beneficiary before allowing transfer.
router.get("/verify", authenticate, async (req, res) => {
  const { number } = req.query;
  if (!number || number.trim().length < 4)
    return res.status(400).json({ message: "Account number is required." });

  const input = number.trim();
  // Extract last 4 digits from whatever format the user typed
  const last4 = input.replace(/[^0-9]/g, "").slice(-4);

  if (last4.length < 4)
    return res.status(400).json({ message: "Please enter at least the last 4 digits of the account number." });

  const snap = await db.collection("accounts").get();
  // Match by last-4 digits of the stored masked number (e.g. ****4920 → 4920)
  const match = snap.docs.find((d) => {
    const stored = (d.data().number || "").replace(/[^0-9]/g, "");
    return stored.slice(-4) === last4;
  });

  if (!match)
    return res.status(404).json({ message: "No account found with that number. Please check and try again." });

  const accData = match.data();
  const isSelf = accData.userId === req.user.uid;

  // Fetch the account holder's name from users collection
  const userSnap = await db.collection("users").doc(accData.userId).get();
  const holderName = userSnap.exists ? userSnap.data().name : "Account Holder";

  res.json({
    verified: true,
    accountId: match.id,
    number: accData.number,
    holderName: isSelf ? `${holderName} (You)` : holderName,
    bankName: accData.bankName || "NeuroBank",
    accountType: accData.type,
    isSelf,
  });
});

// GET /api/accounts/:id
router.get("/:id", authenticate, async (req, res) => {
  const doc = await db.collection("accounts").doc(req.params.id).get();
  if (!doc.exists || doc.data().userId !== req.user.uid)
    return res.status(404).json({ message: "Account not found." });
  res.json({ id: doc.id, ...doc.data() });
});

export default router;
