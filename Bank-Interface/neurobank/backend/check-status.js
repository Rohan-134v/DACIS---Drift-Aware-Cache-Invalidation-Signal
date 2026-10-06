import "dotenv/config";
import { adminAuth, db } from "./firebase.js";

async function checkAllUsers() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Checking ALL user accounts — DACIS flag status");
  console.log("══════════════════════════════════════════════════════════════\n");

  const usersSnap = await db.collection("users").get();

  console.log("  Status      | Name                   | Email                              | Reason");
  console.log("  ───────────+────────────────────────+────────────────────────────────────+──────────────────────────");

  for (const doc of usersSnap.docs) {
    const u = doc.data();
    const flag = u.dacis_flagged ? "🚨 FLAGGED" : "✅ Clean  ";
    const name = (u.name || "N/A").padEnd(22);
    const email = (u.email || "N/A").padEnd(34);
    const reason = u.dacis_reason || "";
    console.log(`  ${flag} | ${name} | ${email} | ${reason}`);
  }

  // Check admin specifically
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Seed Admin Account Detail");
  console.log("══════════════════════════════════════════════════════════════");

  const adminSnap = await db.collection("users").where("email", "==", "admin@neurobank.io").get();
  if (!adminSnap.empty) {
    const admin = adminSnap.docs[0].data();
    console.log(`  UID:           ${adminSnap.docs[0].id}`);
    console.log(`  Name:          ${admin.name}`);
    console.log(`  Email:         ${admin.email}`);
    console.log(`  Role:          ${admin.role}`);
    console.log(`  Tier:          ${admin.tier}`);
    console.log(`  DACIS Flagged: ${admin.dacis_flagged}`);
    console.log(`  DACIS Reason:  ${admin.dacis_reason || "None"}`);
    console.log(`  Suspended:     ${admin.suspended || false}`);
  } else {
    console.log("  ❌ Admin account not found!");
  }

  // Check security incidents
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Security Incidents (DACIS)");
  console.log("══════════════════════════════════════════════════════════════");

  const incSnap = await db.collection("security_incidents").orderBy("createdAt", "desc").limit(20).get();
  if (incSnap.empty) {
    console.log("  No security incidents found.");
  } else {
    for (const doc of incSnap.docs) {
      const inc = doc.data();
      // Resolve user name
      let userName = "Unknown";
      try {
        const userDoc = await db.collection("users").doc(inc.userId).get();
        if (userDoc.exists) userName = userDoc.data().name;
      } catch {}
      const resolved = inc.resolved ? "✅ Resolved" : "🔴 Open";
      console.log(`  ${resolved} | ${userName.padEnd(22)} | ${inc.reason}`);
    }
  }

  console.log("");
  process.exit(0);
}

checkAllUsers();
