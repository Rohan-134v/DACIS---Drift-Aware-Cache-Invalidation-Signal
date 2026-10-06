# DACIS Fraud Detection Engine — Panel Review Sheet

## 1. Demo Account Overview

| # | Account Holder | Email | Password | Role | DACIS Status | Flag Reason |
|---|---|---|---|---|---|---|
| 1 | **NeuroBank Admin** | `admin@neurobank.io` | `NeuroAdmin@2025` | Admin | ✅ Clean | — |
| 2 | Rahul Sharma | `rahul.sharma@neurobank.io` | `Demo@1234` | Customer (Premium) | 🚨 Flagged after demo | Money laundering ring (₹9,999 structuring) |
| 3 | Priya Patel | `priya.patel@neurobank.io` | `Demo@1234` | Customer (Standard) | ✅ Clean | — |
| 4 | Vikram Malhotra | `vikram.malhotra@neurobank.io` | `Demo@1234` | Customer (Premium) | 🚨 Pre-flagged | Anomalous ₹25,000 offshore wire |
| 5 | Anita Desai | `anita.desai@neurobank.io` | `Demo@1234` | Customer (Standard) | 🚨 Pre-flagged | Money laundering ring detected |
| 6 | Arjun Mehta | `arjun.mehta@neurobank.io` | `Demo@1234` | Customer (Standard) | 🚨 Flagged after demo | Anomalous ₹25,000 offshore wire |
| 7 | Sneha Reddy | `sneha.reddy@neurobank.io` | `Demo@1234` | Customer (Premium) | 🚨 Flagged after demo | Micro-structuring botnet (₹1.01 bursts) |

---

## 2. Transaction Summary

### Seeded Transactions (pre-loaded per account)

| Account | # of Transactions | Categories | Total Volume |
|---|---|---|---|
| NeuroBank Admin | 4 | Technology, Dining, Income, Entertainment | ~₹5,657 |
| Rahul Sharma | 8 | Income, Shopping, Dining, Entertainment, Bills, Transport, Travel, Health | ~₹1,29,368 |
| Priya Patel | 6 | Income, Shopping, Dining, Entertainment, Bills | ~₹81,577 |
| Vikram Malhotra | 6 | Income, Transfer, Shopping, Dining, Travel | ~₹2,46,400 |
| Anita Desai | 5 | Income, Transfer | ~₹39,995 |
| Arjun Mehta | 7 | Income, Dining, Shopping, Entertainment, Bills, Transport | ~₹75,347 |
| Sneha Reddy | 8 | Income, Technology, Travel, Dining, Shopping, Entertainment, Health, Bills | ~₹4,84,699 |

| **Total Seeded** | **44 transactions** across **7 accounts** |
|---|---|

### Demo-Generated Transactions (runtime)

| Phase | Transaction Type | # of Transactions | Amount Range | Sender → Receiver |
|---|---|---|---|---|
| Phase 0: Background Traffic | Normal peer-to-peer transfers | 15 | ₹15 – ₹2,000 | Cross-user (random pairs) |
| Phase 1: Baseline Build | Small legitimate transfers | 5 | ₹10 – ₹25 | Arjun → Sneha |
| Phase 2: Single-Account Fraud | Anomalous high-value wire | 1 | ₹25,000 | Arjun → Sneha |
| Phase 3: Laundering Ring | Multiple structured transfers | 3 | ₹9,999 | Rahul → Priya, Sneha, Arjun |
| Phase 4: Persistent Flag | Small post-flag transfer | 1 | ₹5 | Arjun → Sneha |
| Phase 5: Micro-Structuring | Rapid micro-transactions | 5 | ₹1.01 | Sneha → Priya |
| Phase 6: Clean Verification | Normal transfer | 1 | ₹250 | Priya → Rahul |

| **Total Demo-Generated** | **31 transactions** |
|---|---|

### Grand Total

| Metric | Count |
|---|---|
| **Total Seeded Transactions** | 44 |
| **Total Demo-Generated Transactions** | 31 |
| **Grand Total Transactions** | **75** |
| **Total Accounts** | 7 (+ 2 legacy test accounts) |

---

## 3. Fraud Detection Breakdown

### Fraud Types Detected by DACIS

| # | Fraud Type | DACIS Gate | dg_score | Trigger Condition | Demo Phase |
|---|---|---|---|---|---|
| 1 | **Single-Account Anomaly** | Gate 1 (Welford Z-score) | 0.9500 | Amount ≥ ₹10,000 | Phase 2 |
| 2 | **Money Laundering Ring** | Gate 1 + Gate 2 (Community Graph) | 0.9900 | Amount = ₹9,999 (structuring) | Phase 3 |
| 3 | **Micro-Structuring Botnet** | Gate 1 | 0.9200 | Rapid small transactions | Phase 5 |

### Fraud Incidents After Demo Run

| # | Account | Fraud Type | dg_score | Gate 1 | Gate 2 | Blocked | Security Incident |
|---|---|---|---|---|---|---|---|
| 1 | **Arjun Mehta** | Single-Account Anomaly (₹25K) | 0.9500 | ✅ Fired | ❌ | ✅ Blocked | ✅ Created |
| 2 | **Rahul Sharma** | Money Laundering Ring (₹9,999) | 0.9900 | ✅ Fired | ✅ Fired | ✅ Blocked | ✅ Created |
| 3 | **Sneha Reddy** | Micro-Structuring Botnet (₹1.01) | 0.9200 | ✅ Fired | ❌ | ✅ Blocked | ✅ Created |
| 4 | **Vikram Malhotra** | Pre-seeded: Offshore wire (₹25K) | 0.9520 | ✅ Fired | ❌ | Pre-flagged | ✅ Exists |
| 5 | **Anita Desai** | Pre-seeded: Laundering ring | 0.9900 | ✅ Fired | ✅ Fired | Pre-flagged | ✅ Exists |

| **Total Frauds Detected** | **5 accounts flagged** |
|---|---|
| **Total Transfers Blocked** | **3 blocked in real-time** + **2 pre-flagged** |
| **Total Security Incidents** | **5 open incidents** |

### Fraud vs. Legitimate Breakdown

| Category | Count | Percentage |
|---|---|---|
| ✅ Legitimate transactions | 67 | 89.3% |
| 🚨 Fraudulent (blocked) | 8 | 10.7% |
| **Total** | **75** | 100% |

---

## 4. DACIS Engine Architecture

| Component | Description |
|---|---|
| **Gate 1 — Welford Anomaly** | Online statistical z-score computation. Flags single-account anomalies when transaction amount deviates significantly from the user's historical baseline. |
| **Gate 2 — Community Graph (GraphSAGE)** | Graph neural network analyzing transaction neighborhoods. Detects coordinated laundering rings and accomplice networks. |
| **Scoring Threshold** | `dg_score > 0.70` **AND** `gate1_fired = true` → Transaction blocked |
| **Fail-Open Policy** | If DACIS backend is unreachable, transactions proceed (never block due to infra issues) |
| **Persistent Flagging** | Once flagged in Firestore (`dacis_flagged: true`), the account appears in the admin security dashboard |
| **Cache Invalidation** | Gate 2 detections invalidate the entire transaction neighborhood (accomplice accounts) |

---

## 5. How to Run the Demo

```bash
# Step 1: Start services
docker compose up -d          # DACIS ML backend (port 8000)
node server.js                # Express API (port 4000)
npm run dev                   # Next.js frontend (port 3000)

# Step 2: Reset accounts to clean state
node reset-demo.js

# Step 3: Run the fraud detection demo
node demo-transactions.js

# Step 4: Log into admin panel
# → http://localhost:3000
# → admin@neurobank.io / NeuroAdmin@2025
# → View flagged accounts & security incidents
```

---

> **Note**: All commands run from `Bank-Interface/neurobank/backend/`
