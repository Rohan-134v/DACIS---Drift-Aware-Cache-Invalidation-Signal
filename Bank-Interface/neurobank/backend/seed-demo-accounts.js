import "dotenv/config";
import { adminAuth, db } from "./firebase.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DACIS Panel Demo — Account Seeder
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Creates 6 customer accounts with:
 *    • Unique checking + savings accounts
 *    • Realistic transaction histories
 *    • Cards (physical + virtual)
 *    • 2 accounts PRE-FLAGGED by DACIS (for demo)
 *    • 1 account with suspicious-but-not-yet-flagged activity
 *
 *  Run:  node seed-demo-accounts.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── Demo Customers ──────────────────────────────────────────────────────────
const DEMO_CUSTOMERS = [
  {
    email: "rahul.sharma@neurobank.io",
    password: "Demo@1234",
    name: "Rahul Sharma",
    tier: "Premium",
    checkingBalance: 87450.60,
    savingsBalance: 120000.00,
    dacis_flagged: false,
    transactions: [
      { icon: "arrow_downward", name: "TCS Salary Credit", category: "Income", amount: 95000.00, card: "ACH", daysAgo: 1 },
      { icon: "shopping_bag", name: "Flipkart Electronics", category: "Shopping", amount: -15999.00, daysAgo: 2 },
      { icon: "restaurant", name: "Zomato Order", category: "Dining", amount: -750.00, daysAgo: 2 },
      { icon: "subscriptions", name: "Spotify Premium", category: "Entertainment", amount: -119.00, daysAgo: 5 },
      { icon: "bolt", name: "Tata Power Bill", category: "Bills", amount: -3200.00, daysAgo: 7 },
      { icon: "local_gas_station", name: "Indian Oil", category: "Transport", amount: -2800.00, daysAgo: 8 },
      { icon: "flight", name: "IndiGo Airlines", category: "Travel", amount: -8500.00, daysAgo: 12 },
      { icon: "fitness_center", name: "Cult.fit Annual", category: "Health", amount: -7999.00, daysAgo: 15 },
    ],
  },
  {
    email: "priya.patel@neurobank.io",
    password: "Demo@1234",
    name: "Priya Patel",
    tier: "Standard",
    checkingBalance: 34200.80,
    savingsBalance: 65000.00,
    dacis_flagged: false,
    transactions: [
      { icon: "arrow_downward", name: "Infosys Salary", category: "Income", amount: 72000.00, card: "ACH", daysAgo: 1 },
      { icon: "shopping_bag", name: "Myntra Fashion", category: "Shopping", amount: -4599.00, daysAgo: 3 },
      { icon: "restaurant", name: "Starbucks", category: "Dining", amount: -480.00, daysAgo: 3 },
      { icon: "subscriptions", name: "Netflix Premium", category: "Entertainment", amount: -649.00, daysAgo: 6 },
      { icon: "shopping_cart", name: "Amazon Pantry", category: "Shopping", amount: -2350.00, daysAgo: 9 },
      { icon: "bolt", name: "Airtel Broadband", category: "Bills", amount: -1499.00, daysAgo: 10 },
    ],
  },
  {
    // ── 🚨 PRE-FLAGGED: Suspicious high-value transfers ──
    email: "vikram.malhotra@neurobank.io",
    password: "Demo@1234",
    name: "Vikram Malhotra",
    tier: "Premium",
    checkingBalance: 5230.15,
    savingsBalance: 8000.00,
    dacis_flagged: true,
    dacis_reason: "DACIS auto-flag: dg_score=0.9520, gate1_fired=true — Anomalous ₹25,000 offshore wire transfer",
    transactions: [
      { icon: "arrow_downward", name: "Freelance Payment", category: "Income", amount: 45000.00, card: "WIRE", daysAgo: 2 },
      { icon: "sync_alt", name: "Offshore Wire Transfer", category: "Transfer", amount: -25000.00, card: "INTERNAL", daysAgo: 1, flagged: true },
      { icon: "sync_alt", name: "Shell Corp Transfer", category: "Transfer", amount: -15000.00, card: "INTERNAL", daysAgo: 1, flagged: true },
      { icon: "shopping_bag", name: "Luxury Watch Co.", category: "Shopping", amount: -12500.00, daysAgo: 3 },
      { icon: "restaurant", name: "The Oberoi", category: "Dining", amount: -8900.00, daysAgo: 4 },
      { icon: "flight", name: "Emirates First Class", category: "Travel", amount: -185000.00, daysAgo: 7 },
    ],
  },
  {
    // ── 🚨 PRE-FLAGGED: Money laundering ring participant ──
    email: "anita.desai@neurobank.io",
    password: "Demo@1234",
    name: "Anita Desai",
    tier: "Standard",
    checkingBalance: 1200.00,
    savingsBalance: 500.00,
    dacis_flagged: true,
    dacis_reason: "DACIS auto-flag: dg_score=0.9900, gate1_fired=true, gate2_confirmed=true — Money laundering ring detected",
    transactions: [
      { icon: "arrow_downward", name: "Unknown Deposit", category: "Income", amount: 9999.00, card: "WIRE", daysAgo: 1, flagged: true },
      { icon: "sync_alt", name: "Rapid Transfer Out", category: "Transfer", amount: -9999.00, card: "INTERNAL", daysAgo: 1, flagged: true },
      { icon: "arrow_downward", name: "Unknown Deposit 2", category: "Income", amount: 9999.00, card: "WIRE", daysAgo: 2, flagged: true },
      { icon: "sync_alt", name: "Rapid Transfer Out 2", category: "Transfer", amount: -9999.00, card: "INTERNAL", daysAgo: 2, flagged: true },
      { icon: "arrow_downward", name: "Structured Deposit", category: "Income", amount: 9998.00, card: "WIRE", daysAgo: 3, flagged: true },
    ],
  },
  {
    // ── ⚠️ Suspicious but NOT yet flagged — good for live demo ──
    email: "arjun.mehta@neurobank.io",
    password: "Demo@1234",
    name: "Arjun Mehta",
    tier: "Standard",
    checkingBalance: 52000.00,
    savingsBalance: 30000.00,
    dacis_flagged: false,
    transactions: [
      { icon: "arrow_downward", name: "Consulting Income", category: "Income", amount: 60000.00, card: "WIRE", daysAgo: 1 },
      { icon: "restaurant", name: "McDonald's", category: "Dining", amount: -350.00, daysAgo: 2 },
      { icon: "shopping_bag", name: "Reliance Digital", category: "Shopping", amount: -8999.00, daysAgo: 4 },
      { icon: "subscriptions", name: "Hotstar Premium", category: "Entertainment", amount: -299.00, daysAgo: 5 },
      { icon: "bolt", name: "Jio Fiber", category: "Bills", amount: -999.00, daysAgo: 8 },
      { icon: "local_gas_station", name: "HP Petrol Pump", category: "Transport", amount: -1500.00, daysAgo: 10 },
      { icon: "shopping_cart", name: "BigBasket Grocery", category: "Shopping", amount: -3200.00, daysAgo: 14 },
    ],
  },
  {
    email: "sneha.reddy@neurobank.io",
    password: "Demo@1234",
    name: "Sneha Reddy",
    tier: "Premium",
    checkingBalance: 145000.00,
    savingsBalance: 250000.00,
    dacis_flagged: false,
    transactions: [
      { icon: "arrow_downward", name: "Google Salary", category: "Income", amount: 250000.00, card: "ACH", daysAgo: 1 },
      { icon: "shopping_bag", name: "Apple Store India", category: "Technology", amount: -134900.00, daysAgo: 2 },
      { icon: "flight", name: "Air India Business", category: "Travel", amount: -45000.00, daysAgo: 5 },
      { icon: "restaurant", name: "Taj Lands End", category: "Dining", amount: -12500.00, daysAgo: 6 },
      { icon: "shopping_cart", name: "Nykaa Beauty", category: "Shopping", amount: -3800.00, daysAgo: 8 },
      { icon: "subscriptions", name: "Adobe Creative Cloud", category: "Entertainment", amount: -4999.00, daysAgo: 10 },
      { icon: "fitness_center", name: "Gold's Gym Annual", category: "Health", amount: -25000.00, daysAgo: 20 },
      { icon: "bolt", name: "Society Maintenance", category: "Bills", amount: -8500.00, daysAgo: 22 },
    ],
  },
  {
    email: "isadmin@gmail.com",
    password: "Demo@1234",
    name: "Admin User",
    tier: "Premium",
    checkingBalance: 120000.00,
    savingsBalance: 500000.00,
    dacis_flagged: false,
    transactions: [
      { icon: "arrow_downward", name: "Salary Credit", category: "Income", amount: 150000.00, card: "ACH", daysAgo: 1 },
      { icon: "shopping_bag", name: "Amazon", category: "Shopping", amount: -4500.00, daysAgo: 2 }
    ],
  },
  {
    email: "admin@gmail.com",
    password: "Demo@1234",
    name: "KNK",
    tier: "Standard",
    checkingBalance: 45000.00,
    savingsBalance: 12000.00,
    dacis_flagged: false,
    transactions: [
      { icon: "arrow_downward", name: "Transfer In", category: "Income", amount: 5000.00, card: "ACH", daysAgo: 1 },
      { icon: "restaurant", name: "Cafe", category: "Dining", amount: -250.00, daysAgo: 3 }
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function randomLast4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
function randomFullCardNumber() {
  return `4${Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("")}`;
}
function randomCvv() {
  return String(Math.floor(100 + Math.random() * 900));
}
function cardExpiry(yearsAhead = 3) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearsAhead);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

// ── Main Seed ───────────────────────────────────────────────────────────────
async function seedDemoAccounts() {
  console.log("══════════════════════════════════════════════════════");
  console.log("  DACIS Demo — Seeding Customer Accounts");
  console.log("══════════════════════════════════════════════════════\n");

  let created = 0;
  let skipped = 0;

  for (const customer of DEMO_CUSTOMERS) {
    const tag = customer.dacis_flagged ? "🚨 FLAGGED" : "✅ CLEAN";
    console.log(`\n── [${tag}] ${customer.name} (${customer.email}) ──`);

    let userRecord;
    try {
      // Check if user already exists
      try {
        userRecord = await adminAuth.getUserByEmail(customer.email);
        console.log(`  ↳ User already exists (UID: ${userRecord.uid}) — updating...`);
        await adminAuth.updateUser(userRecord.uid, {
          password: customer.password,
          displayName: customer.name,
        });
      } catch {
        // User doesn't exist — create
        userRecord = await adminAuth.createUser({
          email: customer.email,
          password: customer.password,
          displayName: customer.name,
        });
        console.log(`  ↳ Created Firebase Auth user (UID: ${userRecord.uid})`);
      }

      const uid = userRecord.uid;

      // Set custom claims
      await adminAuth.setCustomUserClaims(uid, { role: "customer" });

      // Upsert Firestore user profile
      const userDoc = {
        name: customer.name,
        email: customer.email,
        tier: customer.tier,
        role: "customer",
        dacis_flagged: customer.dacis_flagged,
        createdAt: new Date().toISOString(),
      };
      if (customer.dacis_reason) {
        userDoc.dacis_reason = customer.dacis_reason;
      }
      await db.collection("users").doc(uid).set(userDoc, { merge: true });

      const batch = db.batch();

      // ── Clear old data for this user ──
      const collections = ["accounts", "cards", "transactions", "investments", "fixedDeposits"];
      for (const col of collections) {
        let snap;
        if (col === "transactions") {
          // Transactions are linked by accountId, we'll handle after accounts
          continue;
        }
        snap = await db.collection(col).where("userId", "==", uid).get();
        snap.forEach((doc) => batch.delete(doc.ref));
      }

      // ── Create Accounts ──
      const checkingRef = db.collection("accounts").doc();
      const savingsRef = db.collection("accounts").doc();
      const checkingLast4 = randomLast4();
      const savingsLast4 = randomLast4();

      batch.set(checkingRef, {
        userId: uid,
        name: "Neuro Checking",
        number: `****${checkingLast4}`,
        balance: customer.checkingBalance,
        type: "checking",
        createdAt: new Date().toISOString(),
      });
      batch.set(savingsRef, {
        userId: uid,
        name: "Quantum Yield Vault",
        number: `****${savingsLast4}`,
        balance: customer.savingsBalance,
        type: "savings",
        createdAt: new Date().toISOString(),
      });
      console.log(`  ↳ Checking: ****${checkingLast4} (₹${customer.checkingBalance.toLocaleString()})`);
      console.log(`  ↳ Savings:  ****${savingsLast4} (₹${customer.savingsBalance.toLocaleString()})`);

      // ── Delete old transactions linked to old accounts ──
      const oldAccSnap = await db.collection("accounts").where("userId", "==", uid).get();
      for (const accDoc of oldAccSnap.docs) {
        const txSnap = await db.collection("transactions").where("accountId", "==", accDoc.id).get();
        txSnap.forEach((doc) => batch.delete(doc.ref));
      }

      // ── Create Card ──
      const cardLast4 = randomLast4();
      batch.set(db.collection("cards").doc(), {
        userId: uid,
        accountId: checkingRef.id,
        name: customer.tier === "Premium" ? "Neuro Titanium" : "Neuro Classic",
        number: `•••• •••• •••• ${cardLast4}`,
        fullNumber: randomFullCardNumber(),
        last4: cardLast4,
        cvv: randomCvv(),
        expiry: cardExpiry(),
        holder: customer.name.toUpperCase(),
        cardType: "physical",
        frozen: false,
        hasPin: false,
        spendingLimit: null,
        limits: { online: true, international: customer.tier === "Premium", atm: true },
        autopays: [],
        createdAt: new Date().toISOString(),
      });
      console.log(`  ↳ Card:     •••• ${cardLast4} (${customer.tier === "Premium" ? "Titanium" : "Classic"})`);

      // ── Create Transactions ──
      const now = new Date();
      for (const txn of customer.transactions) {
        const txnDate = new Date(now);
        txnDate.setDate(txnDate.getDate() - txn.daysAgo);
        batch.set(db.collection("transactions").doc(), {
          accountId: checkingRef.id,
          icon: txn.icon,
          name: txn.name,
          category: txn.category,
          amount: txn.amount,
          card: txn.card || `**${cardLast4}`,
          createdAt: txnDate.toISOString(),
          ...(txn.flagged ? { dacis_flagged: true } : {}),
        });
      }
      console.log(`  ↳ Transactions: ${customer.transactions.length} seeded`);

      // ── Create Security Incidents for flagged accounts ──
      if (customer.dacis_flagged && customer.dacis_reason) {
        batch.set(db.collection("security_incidents").doc(), {
          userId: uid,
          reason: customer.dacis_reason,
          triggeredBy: "dacis_engine",
          resolved: false,
          createdAt: new Date().toISOString(),
          dacis_details: {
            sender_id: checkingRef.id,
            dg_score: customer.dacis_reason.includes("0.99") ? 0.99 : 0.952,
            gate1_fired: true,
            gate2_confirmed: customer.dacis_reason.includes("gate2"),
          },
        });
        console.log(`  ↳ Security Incident: created`);
      }

      await batch.commit();
      created++;
      console.log(`  ✅ Done!`);
    } catch (error) {
      console.error(`  ❌ Failed: ${error.message}`);
      skipped++;
    }
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`  ✅ Seed complete! Created: ${created}, Skipped: ${skipped}`);
  console.log("══════════════════════════════════════════════════════");
  console.log("\n📋 All demo accounts use password: Demo@1234");
  console.log("──────────────────────────────────────────────────────");

  // Print summary table
  console.log("\n  Email                              | Status      | Checking      | Password");
  console.log("  ───────────────────────────────────+─────────────+───────────────+────────────");
  for (const c of DEMO_CUSTOMERS) {
    const flag = c.dacis_flagged ? "🚨 FLAGGED" : "✅ Clean  ";
    const bal = `₹${c.checkingBalance.toLocaleString()}`.padEnd(13);
    console.log(`  ${c.email.padEnd(36)}| ${flag}  | ${bal} | ${c.password}`);
  }
  console.log("");

  process.exit(0);
}

seedDemoAccounts();
