import http from "http";

// Keep track of accounts that have been flagged for fraud
const flaggedAccounts = new Set();

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/transaction") {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      const data = JSON.parse(body);
      const amount = data.amount;
      const senderId = data.sender_id;

      // Mock logic:
      // Amount >= 10000 => Single-account Fraud (Gate 1 Fired)
      // Amount == 9999 => Money Laundering Ring Detected (Gate 1 & Gate 2 Fired)
      // Once an account commits fraud, ALL their future transactions are flagged.
      
      let isFraud = false;
      let isLaunderingRing = false;

      if (amount === 9999) {
        isFraud = true;
        isLaunderingRing = true;
        flaggedAccounts.add(senderId);
      } else if (amount >= 10000 || flaggedAccounts.has(senderId)) {
        isFraud = true;
        flaggedAccounts.add(senderId); // permanently flag this account
      }

      let responsePayload;

      if (isLaunderingRing) {
        // Graph Neighborhood / Money Laundering Anomaly
        responsePayload = {
          transaction_id: data.transaction_id,
          sender_id: data.sender_id,
          receiver_id: data.receiver_id,
          amount: data.amount,
          dg_score: 0.99,
          prob_base: 0.95,
          gate1_fired: true,
          gate2_confirmed: true, // Community flag!
          z_score_account: 5.2,
          z_score_community: 4.8, // High community anomaly
          community_root: "mock_laundering_ring_root",
          // Invalidates the sender, receiver, and their neighborhood
          cache_invalidated_accounts: [data.sender_id, data.receiver_id, "accomplice_1", "accomplice_2"]
        };
      } else if (isFraud) {
        // Standard single-account fraud
        responsePayload = {
          transaction_id: data.transaction_id,
          sender_id: data.sender_id,
          receiver_id: data.receiver_id,
          amount: data.amount,
          dg_score: 0.95,
          prob_base: 0.85,
          gate1_fired: true,
          gate2_confirmed: false,
          z_score_account: 4.5,
          z_score_community: 0.8,
          community_root: "mock_root",
          cache_invalidated_accounts: [data.sender_id]
        };
      } else {
        // Legit
        responsePayload = {
          transaction_id: data.transaction_id,
          sender_id: data.sender_id,
          receiver_id: data.receiver_id,
          amount: data.amount,
          dg_score: 0.15,
          prob_base: 0.10,
          gate1_fired: false,
          gate2_confirmed: false,
          z_score_account: 0.5,
          z_score_community: 0.2,
          community_root: "mock_root",
          cache_invalidated_accounts: []
        };
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responsePayload));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8000, () => {
  console.log("Mock DACIS server running on http://localhost:8000");
});
