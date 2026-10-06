"""
Singleton, thread-safe (asyncio.Lock-guarded) model service.

Provides:
    load()                        — initial model load at startup
    get_embedding(x, edge_index)  — subgraph → embedding vector
    predict_prob(x, edge_index)   — subgraph → fraud probability
    reload_model(path)            — hot-swap weights without restart

The ``asyncio.Lock`` ensures that a ``reload_model()`` call does not
race with concurrent inference calls.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import torch

from app.config import settings
from app.model.dacis_model import DACISGraphSAGE

logger = logging.getLogger(__name__)


class ModelService:
    """Singleton model registry.

    Use ``ModelService.instance()`` to get the global singleton.
    """

    _instance: Optional["ModelService"] = None
    _lock_cls = asyncio.Lock  # class-level; instance lock created in __init__

    def __init__(self) -> None:
        self._model: Optional[DACISGraphSAGE] = None
        self._lock = asyncio.Lock()
        self._loaded = False
        self._device = torch.device("cpu")

    @classmethod
    def instance(cls) -> "ModelService":
        """Return the global singleton, creating it on first call."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset the singleton (for testing)."""
        cls._instance = None

    # ── lifecycle ────────────────────────────────────────────────────────

    async def load(self, path: Optional[str] = None) -> None:
        """Load model weights from disk.

        Parameters
        ----------
        path : str or None
            Path to the ``.pt`` state_dict file.  Defaults to
            ``settings.MODEL_PATH``.

        Raises
        ------
        FileNotFoundError
            If the weights file does not exist.
        RuntimeError
            If the state_dict keys do not match the model architecture.
            This catches the case where the placeholder model definition
            doesn't match a real checkpoint — we fail loudly rather
            than silently loading partial weights.
        """
        async with self._lock:
            model_path = Path(path or settings.MODEL_PATH)

            # Instantiate the model architecture
            model = DACISGraphSAGE(
                in_channels=settings.MODEL_INPUT_DIM,
                hidden_channels=settings.MODEL_HIDDEN_DIM,
                out_channels=2,
            )

            if model_path.exists():
                state_dict = torch.load(
                    model_path, map_location=self._device, weights_only=True
                )
                # Validate keys match — fail loudly on mismatch
                model_keys = set(model.state_dict().keys())
                loaded_keys = set(state_dict.keys())
                if model_keys != loaded_keys:
                    missing = model_keys - loaded_keys
                    unexpected = loaded_keys - model_keys
                    raise RuntimeError(
                        f"State dict key mismatch — the model architecture "
                        f"(likely the placeholder) does not match the "
                        f"checkpoint at '{model_path}'.\n"
                        f"  Missing keys:    {missing or 'none'}\n"
                        f"  Unexpected keys: {unexpected or 'none'}\n"
                        f"Replace DACISGraphSAGE with the exact class from "
                        f"the research notebook before loading this checkpoint."
                    )
                model.load_state_dict(state_dict)
                logger.info("Model loaded from %s", model_path)
            else:
                logger.warning(
                    "No weights found at %s — using randomly initialised "
                    "placeholder model. This is expected during development "
                    "but NOT acceptable in production.",
                    model_path,
                )

            model.to(self._device)
            model.eval()
            self._model = model
            self._loaded = True

    async def reload_model(self, path: str) -> None:
        """Hot-swap model weights without restarting the service.

        The asyncio.Lock ensures no inference call is in flight during
        the swap.
        """
        await self.load(path)
        logger.info("Model hot-swapped from %s", path)

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ── inference ────────────────────────────────────────────────────────

    async def get_embedding(
        self, x: np.ndarray, edge_index: np.ndarray
    ) -> np.ndarray:
        """Run the model's embedding layers on a subgraph.

        Parameters
        ----------
        x : np.ndarray, shape (N, input_dim)
            Node feature matrix.
        edge_index : np.ndarray, shape (2, E)
            Edge index in COO format.

        Returns
        -------
        np.ndarray, shape (N, hidden_dim)
            Node embeddings.
        """
        async with self._lock:
            if self._model is None:
                raise RuntimeError("Model not loaded — call load() first.")
            with torch.no_grad():
                x_t = torch.tensor(x, dtype=torch.float32, device=self._device)
                ei_t = torch.tensor(edge_index, dtype=torch.long, device=self._device)
                emb = self._model.get_embedding(x_t, ei_t)
                return emb.cpu().numpy()

    async def predict_prob(
        self, x: np.ndarray, edge_index: np.ndarray
    ) -> np.ndarray:
        """Run full forward pass and return fraud probabilities.

        Parameters
        ----------
        x : np.ndarray, shape (N, input_dim)
        edge_index : np.ndarray, shape (2, E)

        Returns
        -------
        np.ndarray, shape (N,)
            Per-node fraud probability (class 1 probability).
        """
        async with self._lock:
            if self._model is None:
                raise RuntimeError("Model not loaded — call load() first.")
            with torch.no_grad():
                x_t = torch.tensor(x, dtype=torch.float32, device=self._device)
                ei_t = torch.tensor(edge_index, dtype=torch.long, device=self._device)
                logits = self._model(x_t, ei_t)
                probs = torch.softmax(logits, dim=1)
                # Class 1 = fraud probability
                return probs[:, 1].cpu().numpy() if probs.shape[1] > 1 else probs[:, 0].cpu().numpy()
