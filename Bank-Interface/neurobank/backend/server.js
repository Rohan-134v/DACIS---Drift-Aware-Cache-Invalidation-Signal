import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/accounts.js";
import transactionRoutes from "./routes/transactions.js";
import transferRoutes from "./routes/transfers.js";
import cardRoutes from "./routes/cards.js";
import adminRoutes from "./routes/admin.js";
import dacisRoutes from "./routes/dacis.js";
import dacisProxyRoutes from "./routes/dacis-proxy.js";
import investmentsRoutes from "./routes/investments.js";
import fixedDepositsRoutes from "./routes/fixed-deposits.js";
import loanRoutes from "./routes/loans.js";
import { adminAuth } from "./firebase.js";
import { db } from "./firebase.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "NeuroBank API" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dacis", dacisRoutes);
app.use("/api/dacis-engine", dacisProxyRoutes);
app.use("/api/investments", investmentsRoutes);
app.use("/api/fixed-deposits", fixedDepositsRoutes);
app.use("/api/loans", loanRoutes);

// 404 handler
app.use((_req, res) => res.status(404).json({ message: "Endpoint not found" }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

// ── Auto-seed admin account on every startup ──────────────────────────────────
const ADMIN_EMAIL    = "admin@neurobank.io";
const ADMIN_PASSWORD = "NeuroAdmin@2025";
const ADMIN_NAME     = "NeuroBank Admin";

async function seedAdmin() {
  try {
    let userRecord;
    let needsPasswordUpdate = false;
    try {
      userRecord = await adminAuth.getUserByEmail(ADMIN_EMAIL);
      needsPasswordUpdate = true;
    } catch {
      userRecord = await adminAuth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME,
      });
      console.log(`[DACIS] Admin account created: ${ADMIN_EMAIL}`);
    }

    if (needsPasswordUpdate) {
      await adminAuth.updateUser(userRecord.uid, {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME,
      });
    }

    await adminAuth.setCustomUserClaims(userRecord.uid, { role: "admin" });

    await db.collection("users").doc(userRecord.uid).set(
      { name: ADMIN_NAME, email: ADMIN_EMAIL, tier: "Admin", role: "admin", dacis_flagged: false },
      { merge: true }
    );

    console.log(`[DACIS] Admin ready — uid: ${userRecord.uid}`);
  } catch (err) {
    console.error("[DACIS] Admin seed failed:", err.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`NeuroBank API running on http://localhost:${PORT}`);
  await seedAdmin();
});
