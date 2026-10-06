import { Router } from "express";
import { db } from "../firebase.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
const FINNHUB_KEY = "d93k2thr01qgqnublov0d93k2thr01qgqnublovg";
const USD_TO_INR = 83.5;

// Fetch live quote from Finnhub — returns { c: currentPrice, o: openPrice } or null
async function getQuote(symbol) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    // c = current price, o = open price. If c is 0 the symbol is invalid/not found.
    return data.c > 0 ? data : null;
  } catch {
    return null;
  }
}

// Fetch company profile for display name
async function getProfile(symbol) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.name || null;
  } catch {
    return null;
  }
}

// GET /api/investments — list holdings with live prices
router.get("/", authenticate, async (req, res) => {
  try {
    const snap = await db.collection("investments").where("userId", "==", req.user.uid).get();
    const holdings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Fetch live quotes for all unique symbols in parallel
    const symbols = [...new Set(holdings.map((h) => h.symbol))];
    const quoteMap = {};
    await Promise.all(
      symbols.map(async (sym) => {
        const q = await getQuote(sym);
        if (q) quoteMap[sym] = q.c;
      })
    );

    const enriched = holdings.map((h) => {
      const livePrice = quoteMap[h.symbol] ?? h.avgPrice;
      const shares = parseFloat(h.shares);
      const avgPrice = parseFloat(h.avgPrice);
      const valueUsd = shares * livePrice;
      const costBasisUsd = shares * avgPrice;
      const value = valueUsd * USD_TO_INR;
      const costBasis = costBasisUsd * USD_TO_INR;
      const plAbs = value - costBasis;
      const plPct = costBasis > 0 ? (plAbs / costBasis) * 100 : 0;

      return {
        ...h,
        currentPrice: (livePrice * USD_TO_INR).toFixed(2),
        value: value.toFixed(2),
        plAbs: Number(plAbs.toFixed(2)),
        plPct: Number(plPct.toFixed(2)),
        positive: plAbs >= 0,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("Error fetching investments:", err);
    res.status(500).json({ message: "Failed to fetch investments" });
  }
});

// POST /api/investments — place a buy order at live market price
router.post("/", authenticate, async (req, res) => {
  const { symbol, type, amount, category } = req.body;
  if (!symbol || !amount)
    return res.status(400).json({ message: "Symbol and amount are required." });

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount < 1)
    return res.status(400).json({ message: "Amount must be at least $1." });

  const upperSymbol = symbol.trim().toUpperCase();

  // Get live price
  const quote = await getQuote(upperSymbol);
  if (!quote)
    return res.status(404).json({ message: `Symbol "${upperSymbol}" not found or market is closed. Try a valid US stock ticker (e.g. AAPL, TSLA).` });

  const amountInr = parsedAmount;
  const amountUsd = amountInr / USD_TO_INR;
  const buyPrice = quote.c;
  const shares = amountUsd / buyPrice;

  // Get company name
  const companyName = await getProfile(upperSymbol) || upperSymbol;

  const doc = {
    userId: req.user.uid,
    symbol: upperSymbol,
    name: companyName,
    shares: shares.toFixed(6),
    avgPrice: buyPrice.toFixed(2),
    currentPrice: buyPrice.toFixed(2),
    value: amountInr.toFixed(2),
    plAbs: 0,
    plPct: 0,
    positive: true,
    category: category || "Stocks",
    orderType: type || "market",
    createdAt: new Date().toISOString(),
  };

  try {
    const docRef = await db.collection("investments").add(doc);
    res.status(201).json({ id: docRef.id, ...doc });
  } catch (err) {
    console.error("Error saving investment:", err);
    res.status(500).json({ message: "Failed to save investment." });
  }
});

export default router;
