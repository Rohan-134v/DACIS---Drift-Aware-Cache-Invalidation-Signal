import { Router } from "express";
import { db, adminAuth } from "../firebase.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// GET /api/admin/users  — list all users with their Firestore profiles
router.get("/users", async (_req, res) => {
  const snap = await db.collection("users").orderBy("createdAt", "desc").limit(100).get();
  res.json(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
});

// GET /api/admin/users/:uid  — single user detail
router.get("/users/:uid", async (req, res) => {
  const doc = await db.collection("users").doc(req.params.uid).get();
  if (!doc.exists) return res.status(404).json({ message: "User not found." });
  res.json({ uid: doc.id, ...doc.data() });
});

// PATCH /api/admin/users/:uid/suspend  — toggle suspended flag
router.patch("/users/:uid/suspend", async (req, res) => {
  const ref = db.collection("users").doc(req.params.uid);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ message: "User not found." });
  const suspended = !doc.data().suspended;
  await ref.update({ suspended });
  // Disable/enable Firebase Auth account
  await adminAuth.updateUser(req.params.uid, { disabled: suspended });
  res.json({ suspended, message: suspended ? "User suspended." : "User reinstated." });
});

// GET /api/admin/transactions  — all transactions across all users
router.get("/transactions", async (req, res) => {
  const snap = await db
    .collection("transactions")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// GET /api/admin/stats  — dashboard summary stats
router.get("/stats", async (_req, res) => {
  const [usersSnap, txSnap, accSnap] = await Promise.all([
    db.collection("users").count().get(),
    db.collection("transactions").count().get(),
    db.collection("accounts").count().get(),
  ]);
  res.json({
    totalUsers: usersSnap.data().count,
    totalTransactions: txSnap.data().count,
    totalAccounts: accSnap.data().count,
  });
});

// GET /api/admin/loans — all loans
router.get("/loans", async (_req, res) => {
  try {
    const snap = await db.collection("loans").orderBy("createdAt", "desc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ message: "Failed to fetch loans" }); }
});

// PATCH /api/admin/loans/:id/approve
router.patch("/loans/:id/approve", async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Loan not found." });
    if (doc.data().status !== "pending") return res.status(400).json({ message: "Only pending loans can be approved." });
    const loan = doc.data();
    const accSnap = await db.collection("accounts").where("userId", "==", loan.userId).get();
    if (accSnap.empty) return res.status(404).json({ message: "No account found for this user." });
    const accDoc = accSnap.docs.find(d => d.data().type === "checking") || accSnap.docs[0];
    const accountId = accDoc.id;
    const batch = db.batch();
    batch.update(db.collection("accounts").doc(accountId), { balance: (accDoc.data().balance || 0) + loan.amount });
    batch.set(db.collection("transactions").doc(), {
      accountId, icon: "account_balance",
      name: `${loan.type.charAt(0).toUpperCase() + loan.type.slice(1)} Loan Disbursement`,
      category: "Loan", amount: loan.amount, card: "LOAN", createdAt: new Date().toISOString(),
    });
    batch.update(db.collection("loans").doc(req.params.id), {
      status: "active", disbursedToAccountId: accountId,
      approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await batch.commit();
    res.json({ message: "Loan approved and disbursed.", accountId, amount: loan.amount });
  } catch (err) { console.error(err); res.status(500).json({ message: "Failed to approve loan" }); }
});

// PATCH /api/admin/loans/:id/reject
router.patch("/loans/:id/reject", async (req, res) => {
  try {
    const doc = await db.collection("loans").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Loan not found." });
    if (doc.data().status !== "pending") return res.status(400).json({ message: "Only pending loans can be rejected." });
    await db.collection("loans").doc(req.params.id).update({
      status: "rejected", rejectionReason: req.body.reason || "Application did not meet criteria.",
      updatedAt: new Date().toISOString(),
    });
    res.json({ message: "Loan rejected." });
  } catch (err) { res.status(500).json({ message: "Failed to reject loan" }); }
});

// GET /api/admin/cards — all cards across all users
router.get("/cards", async (_req, res) => {
  try {
    const snap = await db.collection("cards").get();
    res.json(snap.docs.map((d) => {
      const { pin, fullNumber, cvv, ...safe } = d.data();
      return { id: d.id, ...safe };
    }));
  } catch (err) { res.status(500).json({ message: "Failed to fetch cards" }); }
});

// PATCH /api/admin/cards/:id/freeze — admin force freeze/unfreeze
router.patch("/cards/:id/freeze", async (req, res) => {
  try {
    const doc = await db.collection("cards").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Card not found." });
    const frozen = req.body.frozen !== undefined ? Boolean(req.body.frozen) : !doc.data().frozen;
    await db.collection("cards").doc(req.params.id).update({ frozen });
    res.json({ frozen, message: frozen ? "Card frozen by admin." : "Card unfrozen by admin." });
  } catch (err) { res.status(500).json({ message: "Failed to update card" }); }
});

// POST /api/admin/cards/issue — issue a card for any user
router.post("/cards/issue", async (req, res) => {
  try {
    const { userId, cardType, name } = req.body;
    if (!userId || !cardType || !["virtual", "physical"].includes(cardType))
      return res.status(400).json({ message: "userId and cardType (virtual|physical) required." });
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ message: "User not found." });
    const holder = userSnap.data().name?.toUpperCase() || "CARDHOLDER";
    const last4 = String(Math.floor(1000 + Math.random() * 9000));
    const fullNumber = `4${Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("")}` ;
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 3);
    const expiry = `${String(exp.getMonth() + 1).padStart(2, "0")}/${String(exp.getFullYear()).slice(-2)}`;
    const cvv = String(Math.floor(100 + Math.random() * 900));
    const doc = {
      userId, name: name || (cardType === "virtual" ? "Neuro Virtual" : "Neuro Titanium"),
      number: `•••• •••• •••• ${last4}`, fullNumber, last4, cvv, expiry, holder,
      cardType, frozen: false, hasPin: false, spendingLimit: null,
      limits: { online: true, international: false, atm: cardType === "physical" },
      autopays: [], createdAt: new Date().toISOString(),
    };
    const ref = await db.collection("cards").add(doc);
    const { fullNumber: _fn, cvv: _c, pin: _p, ...safe } = doc;
    res.status(201).json({ id: ref.id, ...safe });
  } catch (err) { res.status(500).json({ message: "Failed to issue card" }); }
});

// GET /api/admin/fixed-deposits — all FDs
router.get("/fixed-deposits", async (_req, res) => {
  try {
    const snap = await db.collection("fixedDeposits").orderBy("createdAt", "desc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ message: "Failed to fetch FDs" }); }
});

// PATCH /api/admin/fixed-deposits/:id/status — update FD status
router.patch("/fixed-deposits/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: "status required." });
    await db.collection("fixedDeposits").doc(req.params.id).update({ status });
    res.json({ message: `FD status updated to ${status}.` });
  } catch (err) { res.status(500).json({ message: "Failed to update FD" }); }
});

// GET /api/admin/security-incidents — all open DACIS incidents
router.get("/security-incidents", async (_req, res) => {
  try {
    const snap = await db.collection("security_incidents").orderBy("createdAt", "desc").limit(100).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ message: "Failed to fetch incidents" }); }
});

// GET /api/admin/settings — read system defaults
router.get("/settings", async (_req, res) => {
  try {
    const doc = await db.collection("config").doc("system").get();
    if (!doc.exists) return res.json({ loanPaymentIntervalDays: 30, fdDefaultTermMonths: 12, cardExpiryYears: 3 });
    res.json(doc.data());
  } catch (err) { res.status(500).json({ message: "Failed to fetch settings" }); }
});

// PUT /api/admin/settings — update system defaults
router.put("/settings", async (req, res) => {
  try {
    const data = req.body || {};
    await db.collection("config").doc("system").set(data, { merge: true });
    res.json({ message: "Settings saved." });
  } catch (err) { res.status(500).json({ message: "Failed to save settings" }); }
});

// POST /api/admin/users/create — create a new customer account
router.post("/users/create", async (req, res) => {
  try {
    const { name, email, password, accountType = "checking", initialDeposit = 0 } = req.body;
    if (!name || !email)
      return res.status(400).json({ message: "name and email are required." });

    // Generate a default password if not provided
    const defaultPassword = password || (Math.random().toString(36).slice(-10) + "A1!");

    // Create Firebase Auth user
    const userRecord = await adminAuth.createUser({ email, password: defaultPassword, displayName: name });
    await adminAuth.setCustomUserClaims(userRecord.uid, { role: "customer" });

    // Create Firestore profile
    const userDoc = {
      name,
      email,
      tier: "Standard",
      role: "customer",
      dacis_flagged: false,
      createdAt: new Date().toISOString(),
    };
    await db.collection("users").doc(userRecord.uid).set(userDoc);

    // Create a unique account number
    const accountNumber = `NB${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;
    const accountData = {
      userId: userRecord.uid,
      name: `Neuro ${accountType.charAt(0).toUpperCase() + accountType.slice(1)}`,
      number: accountNumber,
      balance: Number(initialDeposit) || 0,
      type: accountType,
      createdAt: new Date().toISOString(),
    };
    const accRef = await db.collection("accounts").add(accountData);

    // Optionally create an initial deposit transaction
    if (Number(initialDeposit) > 0) {
      await db.collection("transactions").add({
        accountId: accRef.id,
        name: "Initial Deposit",
        category: "Deposit",
        amount: Number(initialDeposit),
        createdAt: new Date().toISOString(),
      });
    }

    // Try to generate a password reset link to let user set their own secure password
    let resetLink = null;
    try {
      resetLink = await adminAuth.generatePasswordResetLink(email);
    } catch (e) {
      // ignore
    }

    // Try to send email if SMTP configured
    let emailSent = false;
    try {
      const nodemailer = await import("nodemailer");
      const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL } = process.env;
      if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
        const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
        const mailOptions = {
          from: FROM_EMAIL || SMTP_USER,
          to: email,
          subject: "Your NeuroBank account details",
          text: `Welcome to NeuroBank. Your account has been created. UID: ${userRecord.uid}\nAccount Number: ${accountNumber}\n` + (resetLink ? `Set your password: ${resetLink}` : `Temporary password: ${defaultPassword}`),
        };
        await transporter.sendMail(mailOptions);
        emailSent = true;
      }
    } catch (e) {
      console.warn("Email send failed:", e.message || e);
    }

    res.status(201).json({
      uid: userRecord.uid,
      email,
      name,
      accountId: accRef.id,
      accountNumber,
      resetLink: emailSent ? null : resetLink || null,
      emailSent,
      message: "Customer created successfully.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || "Failed to create user" });
  }
});

// POST /api/admin/users/:uid/credit — admin credits user's primary account
router.post("/users/:uid/credit", async (req, res) => {
  try {
    const { amount, note } = req.body;
    const uid = req.params.uid;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ message: "amount must be > 0" });
    // Find primary checking account
    const accSnap = await db.collection("accounts").where("userId", "==", uid).orderBy("type").limit(1).get();
    if (accSnap.empty) return res.status(404).json({ message: "No account found for user." });
    const accDoc = accSnap.docs[0];
    const newBal = (accDoc.data().balance || 0) + Number(amount);
    const batch = db.batch();
    batch.update(db.collection("accounts").doc(accDoc.id), { balance: newBal });
    batch.set(db.collection("transactions").doc(), {
      accountId: accDoc.id,
      name: note || "Admin Credit",
      category: "Credit",
      amount: Number(amount),
      createdAt: new Date().toISOString(),
    });
    await batch.commit();
    res.json({ message: "Account credited.", accountId: accDoc.id, newBalance: newBal });
  } catch (err) { console.error(err); res.status(500).json({ message: "Failed to credit account" }); }
});

export default router;
