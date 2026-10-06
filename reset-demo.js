import "dotenv/config";
import { db } from "./firebase.js";

/**
 * Resets ALL demo accounts to clean state before a fresh demo run.
 * - Clears dacis_flagged and dacis_reason for all demo accounts
 * - Deletes all security incidents 
 * - Keeps pre-flagged accounts (Vikram, Anita) flagged as intended
 */
async function resetForDemo() {
  console.log("══════════════════════════════════════════════════════");
  console.log("  Resetting ALL accounts for fresh demo run");
  console.log("══════════════════════════════════════════════════════\n");

  // Accounts to reset (all except Vikram & Anita who should stay flagged as seeded)
  const resetEmails = [
    "admin@neurobank.io",
    "arjun.mehta@neurobank.io",
    "sneha.reddy@neurobank.io",
    "rahul.sharma@neurobank.io",
    "priya.patel@neurobank.io",
    "isadmin@gmail.com",
    "admin@gmail.com",
  ];

  for (const email of resetEmails) {
    const snap = await db.collection("users").where("email", "==", email).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      await doc.ref.update({
        dacis_flagged: false,
        dacis_reason: null,
      });

      // Delete security incidents for this user
      const incSnap = await db.collection("security_incidents").where("userId", "==", doc.id).get();
      if (!incSnap.empty) {
        const batch = db.batch();
        incSnap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        console.log(`  ✅ ${doc.data().name?.padEnd(22)} | Reset + deleted ${incSnap.size} incidents`);
      } else {
        console.log(`  ✅ ${doc.data().name?.padEnd(22)} | Reset (no incidents)`);
      }
    }
  }

  // Print final status
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Status After Reset");
  console.log("══════════════════════════════════════════════════════\n");

  const usersSnap = await db.collection("users").get();
  for (const doc of usersSnap.docs) {
    const u = doc.data();
    const flag = u.dacis_flagged ? "🚨 FLAGGED" : "✅ Clean  ";
    console.log(`  ${flag} | ${(u.name || "N/A").padEnd(22)} | ${u.email || "N/A"}`);
  }

  const incSnap = await db.collection("security_incidents").get();
  console.log(`\n  Security incidents remaining: ${incSnap.size}`);

  console.log("\n✅ Ready for fresh demo!\n");
  process.exit(0);
}

resetForDemo();
