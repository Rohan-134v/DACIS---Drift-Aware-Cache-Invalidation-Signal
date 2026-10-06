import fs from "fs";

async function run() {
  try {
    const API_KEY = "AIzaSyDeg_EgVAtM-TccADrV5cuDTqw6RfC9UK4";
    console.log("Logging in...");
    const loginRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@neurobank.io",
          password: "NeuroAdmin@2025",
          returnSecureToken: true,
        }),
      }
    );
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      console.error("Login failed:", loginData);
      return;
    }
    const token = loginData.idToken;
    console.log("Logged in successfully. Fetching accounts...");

    const accountsRes = await fetch("http://localhost:4000/api/accounts", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const accounts = await accountsRes.json();
    if (!accountsRes.ok) {
      console.error("Failed to fetch accounts:", accounts);
      return;
    }
    console.log(`Found ${accounts.length} accounts.`);
    
    if (accounts.length < 2) {
      console.error("Need at least 2 accounts to test a transfer.");
      return;
    }
    
    const fromAcc = accounts[0].id;
    const toAcc = accounts[1].id;
    console.log(`Will transfer from ${fromAcc} to ${toAcc}`);

    console.log("\n--- TEST 1: Small Transfer ($100) ---");
    const tx1Res = await fetch("http://localhost:4000/api/transfers", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({
        fromAccountId: fromAcc,
        toAccountId: toAcc,
        amount: 100,
        note: "Small test transfer"
      })
    });
    const tx1Data = await tx1Res.json();
    console.log("Response:", tx1Res.status, tx1Data);

    console.log("\n--- TEST 2: Large Transfer ($15000) ---");
    const tx2Res = await fetch("http://localhost:4000/api/transfers", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({
        fromAccountId: fromAcc,
        toAccountId: toAcc,
        amount: 15000,
        note: "Large test transfer (fraud check)"
      })
    });
    const tx2Data = await tx2Res.json();
    console.log("Response:", tx2Res.status, tx2Data);

  } catch (err) {
    console.error("Test script failed:", err);
  }
}

run();
