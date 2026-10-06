import { Router } from "express";
import { adminAuth } from "../firebase.js";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// ── Preset admin credentials ──────────────────────────────────────────────────
const ADMIN_EMAIL    = "admin@neurobank.io";
const ADMIN_PASSWORD = "NeuroAdmin@2025";
const ADMIN_NAME     = "NeuroBank Admin";
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/signup
// Called AFTER Firebase Auth user is created client-side.
// Only writes the Firestore profile + seeds a default account.
router.post("/signup", authenticate, async (req, res) => {
  const { name, email } = req.body;
  const uid = req.user.uid;

  if (!name || !email)
    return res.status(400).json({ message: "name and email are required." });

  try {
    // Idempotent — if profile already exists just return it
    const existing = await db.collection("users").doc(uid).get();
    if (existing.exists) return res.json({ uid, message: "Profile already exists." });

    await db.collection("users").doc(uid).set({
      name,
      email,
      tier: "Standard",
      role: "customer",
      dacis_flagged: false,
      createdAt: new Date().toISOString(),
    });

    // Seed a default checking account with starting balance
    const checkingRef = await db.collection("accounts").add({
      userId: uid,
      name: "Neuro Checking",
      number: "****" + Math.floor(1000 + Math.random() * 9000),
      balance: 24592.40,
      type: "checking",
    });

    // Seed a savings account
    await db.collection("accounts").add({
      userId: uid,
      name: "Quantum Yield Vault",
      number: "****" + Math.floor(1000 + Math.random() * 9000),
      balance: 45000.00,
      type: "savings",
    });

    // Seed a default card
    const last4 = Math.floor(1000 + Math.random() * 9000);
    await db.collection("cards").add({
      userId: uid,
      name: "Neuro Titanium",
      number: `•••• •••• •••• ${last4}`,
      last4: String(last4),
      expiry: "12/28",
      holder: name.toUpperCase(),
      frozen: false,
      limits: { online: true, international: false, atm: true },
    });

    // Seed realistic transactions
    const now = new Date();
    const seedTxns = [
      { icon: "shopping_bag", name: "Apple Store", category: "Technology", amount: -1299.00, card: `**${last4}`, daysAgo: 0 },
      { icon: "restaurant", name: "Soma Sushi Bar", category: "Dining", amount: -85.40, card: `**${last4}`, daysAgo: 0 },
      { icon: "arrow_downward", name: "Payroll Deposit", category: "Income", amount: 4250.00, card: "ACH", daysAgo: 1 },
      { icon: "subscriptions", name: "Netflix Premium", category: "Entertainment", amount: -22.99, card: `**${last4}`, daysAgo: 2 },
      { icon: "bolt", name: "Electric Utility", category: "Bills", amount: -145.82, card: `**${last4}`, daysAgo: 3 },
      { icon: "local_gas_station", name: "Shell Station", category: "Transport", amount: -62.40, card: `**${last4}`, daysAgo: 4 },
      { icon: "arrow_downward", name: "Wire Transfer In", category: "Income", amount: 12000.00, card: "WIRE", daysAgo: 6 },
      { icon: "flight", name: "Delta Airlines", category: "Travel", amount: -680.00, card: `**${last4}`, daysAgo: 8 },
      { icon: "shopping_cart", name: "Amazon Prime", category: "Shopping", amount: -149.99, card: `**${last4}`, daysAgo: 10 },
      { icon: "fitness_center", name: "Gym Membership", category: "Health", amount: -59.99, card: `**${last4}`, daysAgo: 12 },
    ];

    const batch = db.batch();
    for (const txn of seedTxns) {
      const txnDate = new Date(now);
      txnDate.setDate(txnDate.getDate() - txn.daysAgo);
      const ref = db.collection("transactions").doc();
      batch.set(ref, {
        accountId: checkingRef.id,
        icon: txn.icon,
        name: txn.name,
        category: txn.category,
        amount: txn.amount,
        card: txn.card,
        createdAt: txnDate.toISOString(),
      });
    }
    await batch.commit();

    res.status(201).json({ uid, message: "Node registered successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Profile creation failed." });
  }
});

// GET /api/auth/me
router.get("/me", authenticate, async (req, res) => {
  const snap = await db.collection("users").doc(req.user.uid).get();
  if (!snap.exists) return res.status(404).json({ message: "User profile not found." });
  res.json({ uid: req.user.uid, ...snap.data() });
});

// PATCH /api/auth/role  — admin-only: promote/demote any user
router.patch("/role", authenticate, async (req, res) => {
  const callerSnap = await db.collection("users").doc(req.user.uid).get();
  if (callerSnap.data()?.role !== "admin")
    return res.status(403).json({ message: "Admin access required." });

  const { targetUid, role } = req.body;
  if (!targetUid || !role) return res.status(400).json({ message: "targetUid and role required." });

  await db.collection("users").doc(targetUid).update({ role });
  await adminAuth.setCustomUserClaims(targetUid, { role });
  res.json({ message: `Role updated to ${role}.` });
});

// POST /api/auth/seed-admin
// Idempotent — safe to call multiple times. Creates the preset admin account
// in Firebase Auth + Firestore and sets the "admin" custom claim.
router.post("/seed-admin", async (_req, res) => {
  try {
    let userRecord;
    let needsPasswordUpdate = false;

    try {
      // Try to fetch existing admin account
      userRecord = await adminAuth.getUserByEmail(ADMIN_EMAIL);
      needsPasswordUpdate = true;
    } catch {
      // Doesn't exist yet — create it
      userRecord = await adminAuth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME,
      });
    }

    if (needsPasswordUpdate) {
      await adminAuth.updateUser(userRecord.uid, {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME,
      });
    }

    // Set custom claim so token carries role: "admin"
    await adminAuth.setCustomUserClaims(userRecord.uid, { role: "admin" });

    // Upsert Firestore profile
    await db.collection("users").doc(userRecord.uid).set(
      {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        tier: "Admin",
        role: "admin",
        dacis_flagged: false,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.json({
      message: "Admin account ready.",
      uid: userRecord.uid,
      email: ADMIN_EMAIL,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Admin seed failed.", error: err.message });
  }
});

export default router;

// ---------------------- Password OTP flow ----------------------
// POST /api/auth/password/otp  — request OTP to reset password (sends email when SMTP configured)
router.post("/password/otp", async (req, res) => {
  try {
    const { identifier } = req.body; // email or uid
    if (!identifier) return res.status(400).json({ message: "identifier required" });
    // Resolve to user record
    let userRecord;
    try {
      if (identifier.includes("@")) userRecord = await adminAuth.getUserByEmail(identifier);
      else userRecord = await adminAuth.getUser(identifier);
    } catch (e) { return res.status(404).json({ message: "User not found" }); }

    const uid = userRecord.uid;
    const email = userRecord.email;
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 1000 * 60 * 15; // 15 minutes

    await db.collection("password_otps").add({ uid, email, otp, expiresAt, createdAt: new Date().toISOString() });

    // Try to send via SMTP
    let sent = false;
    try {
      const nodemailer = await import("nodemailer");
      const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL } = process.env;
      if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
        const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
        await transporter.sendMail({ from: FROM_EMAIL || SMTP_USER, to: email, subject: "Your NeuroBank password reset OTP", text: `Your OTP: ${otp} — valid 15 minutes.` });
        sent = true;
      }
    } catch (e) {
      console.warn("OTP email failed:", e.message || e);
    }

    res.json({ message: "OTP generated.", sent, otp: sent ? undefined : otp });
  } catch (err) { console.error(err); res.status(500).json({ message: "Failed to generate OTP" }); }
});

// POST /api/auth/password/verify — verify OTP and set new password
router.post("/password/verify", async (req, res) => {
  try {
    const { identifier, otp, newPassword } = req.body;
    if (!identifier || !otp || !newPassword) return res.status(400).json({ message: "identifier, otp and newPassword required" });
    // Resolve user
    let userRecord;
    try {
      if (identifier.includes("@")) userRecord = await adminAuth.getUserByEmail(identifier);
      else userRecord = await adminAuth.getUser(identifier);
    } catch (e) { return res.status(404).json({ message: "User not found" }); }

    const snaps = await db.collection("password_otps").where("uid", "==", userRecord.uid).orderBy("createdAt", "desc").limit(5).get();
    if (snaps.empty) return res.status(400).json({ message: "No OTP found." });
    const valid = snaps.docs.map(d => d.data()).find(d => d.otp === String(otp) && d.expiresAt > Date.now());
    if (!valid) return res.status(400).json({ message: "Invalid or expired OTP." });

    await adminAuth.updateUser(userRecord.uid, { password: newPassword });
    // Optionally delete OTPs for this uid
    const batch = db.batch();
    snaps.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    res.json({ message: "Password updated. You can now login with your new password." });
  } catch (err) { console.error(err); res.status(500).json({ message: "Failed to verify OTP" }); }
});

