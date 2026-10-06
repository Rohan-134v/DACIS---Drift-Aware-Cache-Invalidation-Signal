import "dotenv/config";
import { adminAuth, db } from "./firebase.js";

const TARGET_EMAIL = "admin@neurobank.io";

async function seedData() {
  try {
    let userRecord;
    try {
      userRecord = await adminAuth.getUserByEmail(TARGET_EMAIL);
      console.log(`Found user: ${TARGET_EMAIL} (UID: ${userRecord.uid})`);
      await adminAuth.updateUser(userRecord.uid, {
        email: TARGET_EMAIL,
        password: "NeuroAdmin@2025",
        displayName: "NeuroBank Admin",
      });
    } catch (e) {
      console.log(`User ${TARGET_EMAIL} not found. Creating...`);
      userRecord = await adminAuth.createUser({
        email: TARGET_EMAIL,
        password: "NeuroAdmin@2025",
        displayName: "NeuroBank Admin",
      });
      await db.collection("users").doc(userRecord.uid).set({
        name: "NeuroBank Admin",
        email: TARGET_EMAIL,
        tier: "Admin",
        role: "admin",
        dacis_flagged: false,
        createdAt: new Date().toISOString(),
      });
    }

    await adminAuth.setCustomUserClaims(userRecord.uid, { role: "admin" });
    await db.collection("users").doc(userRecord.uid).set({
      name: "NeuroBank Admin",
      email: TARGET_EMAIL,
      tier: "Admin",
      role: "admin",
      dacis_flagged: false,
      createdAt: new Date().toISOString(),
    }, { merge: true });

    const uid = userRecord.uid;

    console.log("Seeding Investments...");
    const investments = [
      { userId: uid, symbol: "NVDA", name: "NVIDIA Corp", shares: "120", avgPrice: "480.20", currentPrice: "520.80", value: "62496.00", pl: "+$4,872", positive: true, category: "Stocks" },
      { userId: uid, symbol: "AAPL", name: "Apple Inc.", shares: "200", avgPrice: "176.50", currentPrice: "192.40", value: "38480.00", pl: "+$3,180", positive: true, category: "Stocks" },
      { userId: uid, symbol: "MSFT", name: "Microsoft", shares: "85", avgPrice: "378.10", currentPrice: "415.30", value: "35300.00", pl: "+$3,162", positive: true, category: "Stocks" },
      { userId: uid, symbol: "TSLA", name: "Tesla Inc.", shares: "50", avgPrice: "255.00", currentPrice: "238.60", value: "11930.00", pl: "-$820", positive: false, category: "Stocks" },
      { userId: uid, symbol: "VOO", name: "Vanguard S&P 500", shares: "50", avgPrice: "420.30", currentPrice: "445.10", value: "22255.00", pl: "+$1,240", positive: true, category: "ETFs" },
      { userId: uid, symbol: "QQQ", name: "Invesco QQQ", shares: "30", avgPrice: "380.50", currentPrice: "410.20", value: "12306.00", pl: "+$891", positive: true, category: "ETFs" },
      { userId: uid, symbol: "BND", name: "Vanguard Total Bond", shares: "100", avgPrice: "72.40", currentPrice: "73.10", value: "7310.00", pl: "+$70", positive: true, category: "Bonds" },
      { userId: uid, symbol: "TLT", name: "iShares 20+ Year", shares: "80", avgPrice: "95.20", currentPrice: "92.80", value: "7424.00", pl: "-$192", positive: false, category: "Bonds" },
    ];

    // Clear existing investments for this user
    const invSnap = await db.collection("investments").where("userId", "==", uid).get();
    const batch = db.batch();
    invSnap.forEach(doc => batch.delete(doc.ref));

    // Add new ones
    for (const inv of investments) {
      batch.set(db.collection("investments").doc(), { ...inv, createdAt: new Date().toISOString() });
    }

    console.log("Seeding Fixed Deposits...");
    const fds = [
      { userId: uid, name: "Shield Tier I", maturity: "Mar 15, 2024", rate: "5.25%", principal: 50000, interest: 2625.00, status: "Active" },
      { userId: uid, name: "Quantum Yield", maturity: "Jan 30, 2025", rate: "5.50%", principal: 75000, interest: 4125.00, status: "Active" },
      { userId: uid, name: "Deep Vault Secure", maturity: "Jun 01, 2024", rate: "4.75%", principal: 30000, interest: 1425.00, status: "Maturing" },
    ];
    
    const fdSnap = await db.collection("fixedDeposits").where("userId", "==", uid).get();
    fdSnap.forEach(doc => batch.delete(doc.ref));

    for (const fd of fds) {
      batch.set(db.collection("fixedDeposits").doc(), { ...fd, createdAt: new Date().toISOString() });
    }

    // Always re-seed cards with full details
    console.log("Seeding Card...");
    const cardSnap = await db.collection("cards").where("userId", "==", uid).get();
    cardSnap.forEach(doc => batch.delete(doc.ref));

    const accSnap = await db.collection("accounts").where("userId", "==", uid).get();
    let checkingId = null;

    if (accSnap.empty) {
      console.log("Seeding Accounts & Transactions...");
      const checkingRef = db.collection("accounts").doc();
      checkingId = checkingRef.id;
      batch.set(checkingRef, { userId: uid, name: "Neuro Checking", number: "****1234", balance: 24592.40, type: "checking" });
      const savingsRef = db.collection("accounts").doc();
      batch.set(savingsRef, { userId: uid, name: "Quantum Yield Vault", number: "****5678", balance: 45000.00, type: "savings" });
      const last4 = 4321;
      const now = new Date();
      const seedTxns = [
        { icon: "shopping_bag", name: "Apple Store", category: "Technology", amount: -1299.00, card: `**${last4}`, daysAgo: 0 },
        { icon: "restaurant", name: "Soma Sushi Bar", category: "Dining", amount: -85.40, card: `**${last4}`, daysAgo: 0 },
        { icon: "arrow_downward", name: "Payroll Deposit", category: "Income", amount: 4250.00, card: "ACH", daysAgo: 1 },
        { icon: "subscriptions", name: "Netflix Premium", category: "Entertainment", amount: -22.99, card: `**${last4}`, daysAgo: 2 },
      ];
      for (const txn of seedTxns) {
        const txnDate = new Date(now);
        txnDate.setDate(txnDate.getDate() - txn.daysAgo);
        batch.set(db.collection("transactions").doc(), {
          accountId: checkingRef.id,
          icon: txn.icon, name: txn.name, category: txn.category, amount: txn.amount, card: txn.card,
          createdAt: txnDate.toISOString(),
        });
      }
    } else {
      checkingId = accSnap.docs.find(d => d.data().type === "checking")?.id || accSnap.docs[0].id;
    }

    const last4 = 4321;
    const fullNumber = `4${Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("")}`;
    const cvv = String(Math.floor(100 + Math.random() * 900));
    batch.set(db.collection("cards").doc(), {
      userId: uid,
      accountId: checkingId,
      name: "Neuro Titanium",
      number: `•••• •••• •••• ${last4}`,
      fullNumber,
      last4: String(last4),
      cvv,
      expiry: "12/28",
      holder: "NEUROBANK ADMIN",
      cardType: "physical",
      frozen: false,
      hasPin: false,
      spendingLimit: null,
      limits: { online: true, international: false, atm: true },
      autopays: [],
      createdAt: new Date().toISOString(),
    });

    await batch.commit();
    console.log("✅ Seed complete!");
    process.exit(0);

  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seedData();
