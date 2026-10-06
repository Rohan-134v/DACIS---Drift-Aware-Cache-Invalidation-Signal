/**
 * DACIS Engine Proxy Routes
 *
 * Bridges the Express backend to the DACIS FastAPI fraud-detection
 * microservice.  The frontend never talks to port 8000 directly —
 * everything goes through these proxy endpoints on /api/dacis-engine/*.
 */

import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

const DACIS_URL = process.env.DACIS_BACKEND_URL || "http://localhost:8000";

// ── Helper: forward a request to the DACIS backend ─────────────────────────
async function dacisFetch(path, options = {}) {
  const url = `${DACIS_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 503, data: { error: "DACIS backend unreachable", detail: err.message } };
  } finally {
    clearTimeout(timeout);
  }
}

// ── GET /api/dacis-engine/health ────────────────────────────────────────────
// Returns DACIS backend health (Redis + model status)
router.get("/health", authenticate, async (_req, res) => {
  const result = await dacisFetch("/health");
  res.status(result.status).json(result.data);
});

// ── GET /api/dacis-engine/cache-stats ───────────────────────────────────────
// Returns embedding cache occupancy (L1 LRU + L2 Redis)
router.get("/cache-stats", authenticate, async (_req, res) => {
  const result = await dacisFetch("/cache/stats");
  res.status(result.status).json(result.data);
});

// ── POST /api/dacis-engine/score ────────────────────────────────────────────
// Score a single transaction through the DACIS pipeline.
// Used internally by the transfer route; also available for direct calls.
router.post("/score", authenticate, async (req, res) => {
  const result = await dacisFetch("/transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });
  res.status(result.status).json(result.data);
});

// ── POST /api/dacis-engine/burst ────────────────────────────────────────────
// Inject a synthetic fraud ring (admin only)
router.post("/burst", authenticate, requireAdmin, async (req, res) => {
  const { ring_size = 6, burst_length = 40 } = req.body;
  const qs = `?ring_size=${ring_size}&burst_length=${burst_length}`;
  const result = await dacisFetch(`/burst/trigger${qs}`, { method: "POST" });
  res.status(result.status).json(result.data);
});

// ── GET /api/dacis-engine/ws-url ────────────────────────────────────────────
// Returns the WebSocket URL the frontend should connect to for live stream.
// The frontend connects directly to the DACIS backend WS (not proxied
// through Express, since Express doesn't natively proxy WebSockets).
router.get("/ws-url", authenticate, (_req, res) => {
  const wsUrl = DACIS_URL.replace(/^http/, "ws") + "/ws/stream";
  res.json({ url: wsUrl });
});

export default router;
