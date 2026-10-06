import "dotenv/config";
import { db } from "./firebase.js";

/**
 * Cleans up the seed admin account:
 *  - Removes dacis_reason leftover
 *  - Ensures dacis_flagged = false
 *  - Deletes all security incidents for the admin
 *  - Also cleans up extra test accounts (isadmin@gmail.com, admin@gmail.com)
 */
async function cleanAdmin() {
  console.log("══════════════════════════════════════════════════════");
  console.log("  Cleaning Admin Account & Old Security Incidents");
  console.log("══════════════════════════════════════════════════════\n");

  // Fix admin profile — remove stale dacis_reason
  const adminSnap = await db.collection("users").where("email", "==", "admin@neurobank.io").get();
  if (!adminSnap.empty) {
    const adminDoc = adminSnap.docs[0];
    await adminDoc.ref.update({
      dacis_flagged: false,
      dacis_reason: null,  // clear the stale reason
    });
    console.log(`  ✅ Admin profile cleaned (UID: ${adminDoc.id})`);
    console.log(`     dacis_flagged → false`);
    console.log(`     dacis_reason  → removed`);

    // Delete all security incidents for admin
    const incSnap = await db.collection("security_incidents").where("userId", "==", adminDoc.id).get();
    if (!incSnap.empty) {
      const batch = db.batch();
      incSnap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`  ✅ Deleted ${incSnap.size} security incidents for admin`);
    } else {
      console.log(`  ✅ No security incidents for admin`);
    }
  } else {
    console.log("  ⚠️ Admin account not found");
  }

  // Also clean KNK / isadmin test accounts
  const testEmails = ["admin@gmail.com", "isadmin@gmail.com"];
  for (const email of testEmails) {
    const snap = await db.collection("users").where("email", "==", email).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const incSnap = await db.collection("security_incidents").where("userId", "==", doc.id).get();
      if (!incSnap.empty) {
        const batch = db.batch();
        incSnap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        console.log(`  ✅ Deleted ${incSnap.size} security incidents for ${email}`);
      }
    }
  }

  // Print final status
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Final Status — All Users");
  console.log("══════════════════════════════════════════════════════\n");

  const usersSnap = await db.collection("users").get();
  for (const doc of usersSnap.docs) {
    const u = doc.data();
    const flag = u.dacis_flagged ? "🚨 FLAGGED" : "✅ Clean  ";
    console.log(`  ${flag} | ${(u.name || "N/A").padEnd(22)} | ${(u.email || "N/A").padEnd(35)} | ${u.dacis_reason || ""}`);
  }

  const incSnap = await db.collection("security_incidents").get();
  console.log(`\n  Total security incidents remaining: ${incSnap.size}`);
  for (const doc of incSnap.docs) {
    const inc = doc.data();
    let userName = "Unknown";
    try {
      const userDoc = await db.collection("users").doc(inc.userId).get();
      if (userDoc.exists) userName = userDoc.data().name;
    } catch {}
    const status = inc.resolved ? "✅ Resolved" : "🔴 Open";
    console.log(`  ${status} | ${userName.padEnd(22)} | ${inc.reason}`);
  }

  console.log("\n✅ Cleanup complete!\n");
  process.exit(0);
}

cleanAdmin();
