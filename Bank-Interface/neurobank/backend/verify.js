import "dotenv/config";
import { adminAuth, db } from "./firebase.js";

async function verify() {
  try {
    const email = "admin@neurobank.io";
    const user = await adminAuth.getUserByEmail(email);
    console.log("Auth UID:", user.uid);

    const accounts = await db.collection("accounts").where("userId", "==", user.uid).get();
    console.log("Accounts count:", accounts.size);
    accounts.forEach(doc => console.log("Account:", doc.id, doc.data()));

    const investments = await db.collection("investments").where("userId", "==", user.uid).get();
    console.log("Investments count:", investments.size);

    const fixedDeposits = await db.collection("fixedDeposits").where("userId", "==", user.uid).get();
    console.log("Fixed Deposits count:", fixedDeposits.size);

    const txns = await db.collection("transactions").get();
    let txnMatch = 0;
    accounts.forEach(acc => {
      txns.forEach(txn => {
        if (txn.data().accountId === acc.id) txnMatch++;
      });
    });
    console.log("Transactions matched to accounts:", txnMatch);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}
verify();
