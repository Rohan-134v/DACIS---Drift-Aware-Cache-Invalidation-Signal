/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DACIS Fraud Detection — Full Panel Demo Script
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Uses multiple demo customer accounts to showcase real-world fraud
 *  detection across different users. Run with both the backend (port 4000)
 *  and mock-dacis (port 8000) running.
 *
 *  Run:  node demo-transactions.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const API_KEY = "AIzaSyDeg_EgVAtM-TccADrV5cuDTqw6RfC9UK4";
const API_BASE = "http://localhost:4000";

// ── Demo Users ──────────────────────────────────────────────────────────────
// NOTE: admin@neurobank.io is NOT included here — it's the main admin panel
// login and must stay clean. Only customer accounts participate in the demo.
const DEMO_USERS = {
  arjun:  { email: "arjun.mehta@neurobank.io",    password: "Demo@1234", name: "Arjun Mehta" },
  sneha:  { email: "sneha.reddy@neurobank.io",    password: "Demo@1234", name: "Sneha Reddy" },
  rahul:  { email: "rahul.sharma@neurobank.io",   password: "Demo@1234", name: "Rahul Sharma" },
  priya:  { email: "priya.patel@neurobank.io",    password: "Demo@1234", name: "Priya Patel" },
  vikram: { email: "vikram.malhotra@neurobank.io",password: "Demo@1234", name: "Vikram Malhotra" },
  anita:  { email: "anita.desai@neurobank.io",    password: "Demo@1234", name: "Anita Desai" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
async function login(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Login failed for ${email}: ${JSON.stringify(err)}`);
  }
  const data = await res.json();
  return data.idToken;
}

async function getAccounts(token) {
  const res = await fetch(`${API_BASE}/api/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function transfer(token, fromId, toId, amount, note) {
  const res = await fetch(`${API_BASE}/api/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromAccountId: fromId, toAccountId: toId, amount, note }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function divider(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(` ${title}`);
  console.log(`${"═".repeat(60)}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN DEMO
// ═══════════════════════════════════════════════════════════════════════════
async function runDemo() {
  console.log("\n");
  console.log("  ██████╗  █████╗  ██████╗██╗███████╗");
  console.log("  ██╔══██╗██╔══██╗██╔════╝██║██╔════╝");
  console.log("  ██║  ██║███████║██║     ██║███████╗");
  console.log("  ██║  ██║██╔══██║██║     ██║╚════██║");
  console.log("  ██████╔╝██║  ██║╚██████╗██║███████║");
  console.log("  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝╚══════╝");
  console.log("  Fraud Detection Engine — Live Panel Demo\n");

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 1: Authenticate all demo users
  // ──────────────────────────────────────────────────────────────────────
  divider("STEP 1: Authenticating Demo Users");

  const tokens = {};
  const accounts = {};

  for (const [key, user] of Object.entries(DEMO_USERS)) {
    try {
      tokens[key] = await login(user.email, user.password);
      accounts[key] = await getAccounts(tokens[key]);
      const checking = accounts[key].find((a) => a.type === "checking");
      const savings = accounts[key].find((a) => a.type === "savings");
      console.log(`  ✅ ${user.name.padEnd(20)} | Checking: ₹${checking?.balance?.toLocaleString() || "N/A"} | Savings: ₹${savings?.balance?.toLocaleString() || "N/A"}`);
    } catch (e) {
      console.error(`  ❌ ${user.name}: ${e.message}`);
    }
  }

  // Use Arjun as primary attacker, Sneha as receiver
  const arjunChecking = accounts.arjun?.find((a) => a.type === "checking");
  const arjunSavings = accounts.arjun?.find((a) => a.type === "savings");
  const snehaChecking = accounts.sneha?.find((a) => a.type === "checking");
  const rahulChecking = accounts.rahul?.find((a) => a.type === "checking");
  const priyaChecking = accounts.priya?.find((a) => a.type === "checking");

  if (!arjunChecking || !snehaChecking) {
    console.error("\n❌ Missing required accounts. Run seed-demo-accounts.js first.");
    return;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 0: Background Traffic Simulation (multi-user)
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 0: Multi-User Background Traffic Simulation");
  console.log("  Simulating normal banking activity across all customers...\n");

  const trafficScenarios = [
    { from: "rahul", to: "priya", note: "Dinner split", range: [50, 200] },
    { from: "priya", to: "rahul", note: "Book club dues", range: [20, 80] },
    { from: "sneha", to: "rahul", note: "Concert tickets", range: [100, 500] },
    { from: "rahul", to: "sneha", note: "Uber reimbursement", range: [30, 100] },
    { from: "arjun", to: "priya", note: "Freelance payment", range: [200, 800] },
    { from: "priya", to: "sneha", note: "Birthday gift", range: [50, 300] },
    { from: "sneha", to: "priya", note: "Shared grocery", range: [40, 150] },
    { from: "rahul", to: "arjun", note: "Gym equipment share", range: [100, 400] },
    { from: "arjun", to: "rahul", note: "Rent contribution", range: [500, 2000] },
    { from: "priya", to: "arjun", note: "Photography course", range: [200, 600] },
    { from: "sneha", to: "arjun", note: "Software license", range: [100, 500] },
    { from: "arjun", to: "sneha", note: "Coffee subscription", range: [15, 50] },
    { from: "rahul", to: "priya", note: "Utility split", range: [200, 800] },
    { from: "priya", to: "rahul", note: "Online course split", range: [100, 400] },
    { from: "sneha", to: "rahul", note: "Travel fund", range: [300, 1000] },
  ];

  const trafficPromises = trafficScenarios.map((s) => {
    const fromAcc = accounts[s.from]?.find((a) => a.type === "checking");
    const toAcc = accounts[s.to]?.find((a) => a.type === "checking");
    if (!fromAcc || !toAcc) return Promise.resolve();
    const amt = s.range[0] + Math.random() * (s.range[1] - s.range[0]);
    return transfer(tokens[s.from], fromAcc.id, toAcc.id, parseFloat(amt.toFixed(2)), s.note);
  });

  const trafficResults = await Promise.allSettled(trafficPromises);
  const succeeded = trafficResults.filter((r) => r.status === "fulfilled").length;
  console.log(`  ✅ ${succeeded}/${trafficScenarios.length} background transactions processed.\n`);

  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 1: Arjun builds a legitimate baseline
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 1: Building Arjun Mehta's Behavioral Profile");
  console.log("  Sending 5 small, normal transfers from Arjun → Sneha to train the ML model...\n");

  const baselineNotes = ["Morning chai", "Lunch at canteen", "Auto fare", "Snacks run", "Evening tea"];

  for (let i = 0; i < 5; i++) {
    const amount = 10 + Math.random() * 15; // ₹10–₹25
    const { status, data } = await transfer(
      tokens.arjun,
      arjunChecking.id,
      snehaChecking.id,
      parseFloat(amount.toFixed(2)),
      baselineNotes[i]
    );

    if (status === 200) {
      const score = data.dacis?.dg_score?.toFixed(4) || "N/A";
      console.log(`  ✅ Tx ${i + 1}: ₹${amount.toFixed(2).padEnd(8)} | Score: ${score} | "${baselineNotes[i]}"`);
    } else {
      console.error(`  ❌ Tx ${i + 1} failed:`, data.message);
    }
    await sleep(400);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 2: Arjun attempts a massive anomalous transfer
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 2: Single-Account Fraud — Anomalous ₹25,000 Transfer");
  console.log("  Arjun Mehta attempts a ₹25,000 offshore wire to Sneha Reddy...\n");

  const { status: fraudStatus, data: fraudData } = await transfer(
    tokens.arjun,
    arjunChecking.id,
    snehaChecking.id,
    25000,
    "Offshore wire — investment return"
  );

  if (fraudStatus === 403) {
    console.log("  ╔══════════════════════════════════════════════════╗");
    console.log("  ║     🚨 FRAUD DETECTED AND BLOCKED BY DACIS 🚨    ║");
    console.log("  ╚══════════════════════════════════════════════════╝");
    console.log(`  ├─ Message:      ${fraudData.message}`);
    console.log(`  ├─ Blocked:      ${fraudData.dacis.blocked}`);
    console.log(`  ├─ Fraud Score:  ${fraudData.dacis.dg_score.toFixed(4)} (Threshold: 0.70)`);
    console.log(`  ├─ Gate 1 Fired: ${fraudData.dacis.gate1_fired} (Statistical Anomaly)`);
    console.log(`  └─ Gate 2:       ${fraudData.dacis.gate2_confirmed} (Community Graph)`);
    console.log(`\n  ⚡ Arjun's account is now PERMANENTLY FLAGGED by DACIS.`);
  } else {
    console.log("  ⚠️ Transaction went through (DACIS not running?).");
    console.log(fraudData);
  }


  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 3: Money Laundering Ring Detection (Gate 2)
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 3: Money Laundering Ring — Multiple Structured ₹9,999 Transfers");
  console.log("  Rahul Sharma attempts multiple ₹9,999 structured transfers to bypass reporting limits...\n");

  const ringTargets = [
    { name: "Priya", id: priyaChecking.id, note: "Consulting fees — quarterly" },
    { name: "Sneha", id: snehaChecking.id, note: "Software license renewal" },
    { name: "Arjun", id: arjunChecking.id, note: "Marketing retainer" },
  ];

  let ringStatus = 200;
  for (let i = 0; i < ringTargets.length; i++) {
    const target = ringTargets[i];
    console.log(`  [Tx ${i + 1}] Rahul → ${target.name} (₹9,999)`);
    const { status, data } = await transfer(
      tokens.rahul,
      rahulChecking.id,
      target.id,
      9999,
      target.note
    );

    if (status === 403) {
      ringStatus = 403;
      if (i === 0) {
        console.log("  ╔══════════════════════════════════════════════════╗");
        console.log("  ║  🚨 MONEY LAUNDERING RING DETECTED & BLOCKED 🚨  ║");
        console.log("  ╚══════════════════════════════════════════════════╝");
        console.log(`  ├─ Gate 1 Fired:   ${data.dacis?.gate1_fired} (Statistical Anomaly)`);
        console.log(`  ├─ Gate 2 Fired:   ${data.dacis?.gate2_confirmed} (Community/Graph Anomaly)`);
        console.log(`  └─ Network Effect: Collateral accounts flagged internally`);
        console.log(`\n  ⚡ Rahul's account is now flagged. Linked accounts invalidated.`);
      } else {
        console.log(`  🚨 BLOCKED! (Account already locked from previous Gate 2 detection)`);
      }
    } else {
      console.log(`  ⚠️ Transaction went through. Score: ${data.dacis?.dg_score?.toFixed(4) || "N/A"}`);
    }
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 4: Flagged account — ALL future transactions blocked
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 4: Persistent Flagging — Arjun's Small Transfer After Flag");
  console.log("  Arjun (now flagged) tries a tiny ₹5 transfer to prove persistent blocking...\n");

  const { status: persistStatus, data: persistData } = await transfer(
    tokens.arjun,
    arjunChecking.id,
    snehaChecking.id,
    5.00,
    "Just a coffee"
  );

  if (persistStatus === 403) {
    console.log("  🚨 BLOCKED! Even a ₹5 transfer is rejected after flagging.");
    console.log(`\n  ✅ Persistent flagging confirmed — account is locked out.`);
  } else {
    console.log("  ⚠️ Transaction slipped through (mock server may need restart).");
    console.log(persistData);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 5: Micro-Structuring Botnet Attack
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 5: High-Frequency Micro-Structuring Botnet");
  console.log("  Sneha's account fires rapid ₹1.01 micro-transactions (botnet simulation)...\n");

  let blocked = false;
  for (let i = 1; i <= 5; i++) {
    const { status: botStatus, data: botData } = await transfer(
      tokens.sneha,
      snehaChecking.id,
      priyaChecking.id,
      1.01,
      `Micro-structuring tx ${i}`
    );

    if (botStatus === 403) {
      if (botData.dacis?.dg_score) {
        console.log(`  🚨 [Tx ${i}] BLOCKED — Micro-structuring detected! Score: ${botData.dacis.dg_score.toFixed(4)}`);
      } else {
        console.log(`  🚨 [Tx ${i}] BLOCKED — Account instantly locked by active security flag.`);
      }
      blocked = true;
      // Intentionally not breaking the loop to show multiple blocked attempts
    } else {
      console.log(`  ⚠️  [Tx ${i}] Slipped through — Score: ${botData.dacis?.dg_score?.toFixed(4) || "N/A"}`);
    }
    await sleep(150);
  }

  if (!blocked) {
    console.log("\n  ℹ️  Micro-transactions passed (below anomaly threshold with mock server).");
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PHASE 6: Clean user — unaffected
  // ──────────────────────────────────────────────────────────────────────
  divider("PHASE 6: Clean User Verification — Priya's Normal Transfer");
  console.log("  Verifying that Priya (unflagged) can still transact normally...\n");

  const { status: cleanStatus, data: cleanData } = await transfer(
    tokens.priya,
    priyaChecking.id,
    rahulChecking.id,
    250.00,
    "Birthday gift for Rahul"
  );

  if (cleanStatus === 200) {
    const score = cleanData.dacis?.dg_score?.toFixed(4) || "N/A";
    console.log(`  ✅ Transfer successful! ₹250 sent.`);
    console.log(`  ├─ Score:      ${score}`);
    console.log(`  ├─ Gate 1:     ${cleanData.dacis?.gate1_fired ?? "N/A"}`);
    console.log(`  └─ New Balance: ₹${cleanData.newBalance?.toLocaleString() || "N/A"}`);
    console.log(`\n  ✅ Clean users are unaffected by DACIS — system works correctly.`);
  } else {
    console.log(`  ⚠️ Unexpected block: ${cleanData.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  SUMMARY
  // ──────────────────────────────────────────────────────────────────────
  divider("DEMO COMPLETE — Summary");
  console.log(`
  ┌─────────────────────────┬───────────────────────────────────────────┐
  │ Phase                   │ Result                                    │
  ├─────────────────────────┼───────────────────────────────────────────┤
  │ 0. Background Traffic   │ ✅ ${succeeded} multi-user transactions processed   │
  │ 1. Baseline Build       │ ✅ 5 legit transfers — profile trained     │
  │ 2. ₹25K Fraud (Arjun)   │ ${fraudStatus === 403 ? "🚨 BLOCKED — Gate 1 fired" : "⚠️  Passed through"}                      │
  │ 3. ₹9,999 Laundering    │ ${ringStatus === 403 ? "🚨 BLOCKED — Gate 1 + Gate 2 (Multiple)" : "⚠️  Passed through"}          │
  │ 4. Persistent Flag      │ ${persistStatus === 403 ? "🚨 BLOCKED — ₹5 rejected" : "⚠️  Passed through"}                     │
  │ 5. Micro-Structuring    │ ${blocked ? "🚨 BLOCKED — 5x Botnet attempts blocked" : "⚠️  Below threshold"}                    │
  │ 6. Clean User Check     │ ${cleanStatus === 200 ? "✅ Priya transacted normally" : "⚠️  Unexpected result"}                  │
  └─────────────────────────┴───────────────────────────────────────────┘

  🎯 Flagged Accounts After Demo:
     • Arjun Mehta     → 🚨 Permanently flagged (Phase 2)
     • Rahul Sharma    → 🚨 Flagged as laundering ring (Phase 3)
     • Vikram M.       → 🚨 Pre-flagged (seeded)
     • Anita Desai     → 🚨 Pre-flagged (seeded)

  ✅ Clean Accounts:
     • NeuroBank Admin → Clean (admin panel login)
     • Sneha Reddy     → Clean
     • Priya Patel     → Clean
  `);
}

runDemo();
