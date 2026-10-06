"""
FastAPI application — thin route handlers delegating to ``pipeline``.

Endpoints:
    POST  /transaction             — score a single transaction
    POST  /burst/trigger           — inject synthetic fraud ring
    WS    /ws/stream               — real-time transaction stream
    GET   /cache/stats             — embedding cache occupancy
    GET   /health                  — Redis + model status

WebSocket broadcast uses an ``asyncio.Queue``-based pub/sub pattern:
one queue per connected client, so a slow client cannot block other
clients or the pipeline.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect

from app.config import settings
from app.model.registry import ModelService
from app.pipeline import (
    PipelineState,
    generate_burst,
    get_pipeline_state,
    init_pipeline,
    process_transaction,
)
from app.redis_client import close_redis, get_redis, init_redis
from app.schemas import (
    BurstRequest,
    CacheStats,
    HealthResponse,
    TransactionRequest,
    TransactionResponse,
)

logger = logging.getLogger(__name__)


# ── Lifespan ─────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Startup
    logger.info("Starting DACIS backend …")

    # Redis
    redis_client = await init_redis()
    logger.info("Redis connected.")

    # Pipeline
    state = await init_pipeline(redis_client)

    # Model
    model_svc = ModelService.instance()
    try:
        await model_svc.load()
    except Exception as exc:
        logger.error("Model load failed: %s — running without model.", exc)

    logger.info("DACIS backend ready.")
    yield

    # Shutdown
    logger.info("Shutting down DACIS backend …")
    await close_redis()


app = FastAPI(
    title="DACIS Backend",
    description=(
        "Drift-Aware Cache Invalidation Signal — streaming fraud-detection "
        "middleware with dual Welford gates and GraphSAGE inference."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


# ── Routes ───────────────────────────────────────────────────────────────


@app.post("/transaction", response_model=TransactionResponse)
async def ingest_transaction(txn: TransactionRequest) -> TransactionResponse:
    """Score a single transaction through the DACIS pipeline."""
    state = get_pipeline_state()
    return await process_transaction(txn, state)


@app.post("/burst/trigger", response_model=list[TransactionResponse])
async def trigger_burst(
    ring_size: int = Query(
        default=settings.DEFAULT_RING_SIZE,
        ge=2,
        description="Number of accounts in the fraud ring.",
    ),
    burst_length: int = Query(
        default=settings.DEFAULT_BURST_LENGTH,
        ge=1,
        description="Number of transactions in the burst.",
    ),
) -> list[TransactionResponse]:
    """Inject a synthetic coordinated fraud ring into the live stream."""
    state = get_pipeline_state()
    return await generate_burst(state, ring_size, burst_length)


@app.get("/cache/stats", response_model=CacheStats)
async def cache_stats() -> CacheStats:
    """Current embedding cache occupancy (both tiers)."""
    state = get_pipeline_state()
    return CacheStats(
        l1_size=state.cache.l1_size(),
        l1_max_size=settings.EMBEDDING_CACHE_L1_MAX_SIZE,
        l2_key_count=await state.cache.l2_key_count(),
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Redis connectivity + model load status."""
    redis_ok = False
    try:
        redis_client = get_redis()
        await redis_client.ping()
        redis_ok = True
    except Exception:
        pass

    model_ok = ModelService.instance().is_loaded
    status = "ok" if (redis_ok and model_ok) else "degraded"
    return HealthResponse(
        status=status, redis_connected=redis_ok, model_loaded=model_ok
    )


# ── WebSocket ────────────────────────────────────────────────────────────


@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket) -> None:
    """Real-time transaction stream.

    Each connected client gets its own ``asyncio.Queue``.  The pipeline
    ``broadcast()`` pushes to every client's queue without blocking; a
    slow client's queue fills up and messages are dropped for *that*
    client only — other clients and the pipeline are unaffected.
    """
    await websocket.accept()
    state = get_pipeline_state()
    client_queue = await state.register_ws_client()

    try:
        while True:
            # Wait for the next broadcast message
            message = await client_queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        await state.unregister_ws_client(client_queue)
