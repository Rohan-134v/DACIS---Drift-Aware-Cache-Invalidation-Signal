"""
In-process graph store — adjacency lists and per-node feature vectors.

Provides ``get_subgraph(center, l_hops, max_neighbors_per_hop)`` which
performs BFS capped at *max_neighbors_per_hop* per level and returns:
  - the exact set of nodes reachable within *l_hops*,
  - a local ``edge_index`` (2 × E int tensor) suitable for an inductive
    GraphSAGE forward pass on just that subgraph.

This is the literal implementation of DACIS's "partial re-embedding" —
only the sender's L-hop neighbourhood is touched; the full graph is
never recomputed.

Memory note (from README): adjacency grows with unique accounts seen;
no eviction by default (bounded by demo pool size).  For long-running
deployments, add an LRU account eviction policy keyed on last-seen
timestamp.
"""

from __future__ import annotations

import random
from collections import defaultdict, deque
from typing import Dict, List, Optional, Set, Tuple

import numpy as np


class GraphStore:
    """In-process graph holding adjacency and node features.

    Not thread-safe — intended for use within a single asyncio event
    loop (one writer at a time via the pipeline's sequential processing).
    """

    def __init__(self, feature_dim: int) -> None:
        self.feature_dim = feature_dim
        # adjacency: node → set of neighbours (undirected)
        self._adj: Dict[str, Set[str]] = defaultdict(set)
        # features: node → np.ndarray of shape (feature_dim,)
        self._features: Dict[str, np.ndarray] = {}

    # ── mutations ────────────────────────────────────────────────────────

    def add_edge(self, src: str, dst: str) -> None:
        """Add an undirected edge.  Idempotent."""
        self._adj[src].add(dst)
        self._adj[dst].add(src)

    def update_features(self, account_id: str, features: np.ndarray) -> None:
        """Set or overwrite the feature vector for *account_id*."""
        self._features[account_id] = np.asarray(features, dtype=np.float32)

    def ensure_node(self, account_id: str) -> None:
        """Ensure *account_id* exists in adjacency (no edges added)."""
        if account_id not in self._adj:
            self._adj[account_id] = set()

    # ── queries ──────────────────────────────────────────────────────────

    def neighbors(self, account_id: str) -> Set[str]:
        """Return the neighbour set for *account_id*."""
        return self._adj.get(account_id, set())

    def has_node(self, account_id: str) -> bool:
        return account_id in self._adj

    def get_features(self, account_id: str) -> Optional[np.ndarray]:
        return self._features.get(account_id)

    def node_count(self) -> int:
        return len(self._adj)

    # ── subgraph extraction ──────────────────────────────────────────────

    def get_subgraph(
        self,
        center_account: str,
        l_hops: int,
        max_neighbors_per_hop: int,
    ) -> Tuple[List[str], np.ndarray]:
        """Extract the *l_hops*-hop subgraph around *center_account*.

        BFS with per-hop neighbour cap: at each level, for each frontier
        node we sample at most *max_neighbors_per_hop* of its neighbours
        that have not already been visited.

        Returns
        -------
        nodes : list[str]
            Ordered list of node IDs in the subgraph.  ``nodes[0]`` is
            always *center_account*.
        edge_index : np.ndarray, shape (2, E)
            Local edge index (indices into *nodes*) for the subgraph,
            suitable for a GraphSAGE forward pass.
        """
        if not self.has_node(center_account):
            # Unknown node — return singleton subgraph with no edges
            return [center_account], np.zeros((2, 0), dtype=np.int64)

        visited: Set[str] = {center_account}
        node_order: List[str] = [center_account]
        frontier: Set[str] = {center_account}

        for _ in range(l_hops):
            next_frontier: Set[str] = set()
            for node in frontier:
                nbrs = self._adj.get(node, set()) - visited
                if len(nbrs) > max_neighbors_per_hop:
                    nbrs = set(random.sample(sorted(nbrs), max_neighbors_per_hop))
                next_frontier |= nbrs
                visited |= nbrs
            node_order.extend(sorted(next_frontier))  # deterministic order
            frontier = next_frontier

        # Build local edge_index
        node_to_idx = {n: i for i, n in enumerate(node_order)}
        src_list: List[int] = []
        dst_list: List[int] = []
        for node in node_order:
            idx_src = node_to_idx[node]
            for nbr in self._adj.get(node, set()):
                if nbr in node_to_idx:
                    src_list.append(idx_src)
                    dst_list.append(node_to_idx[nbr])

        edge_index = np.array([src_list, dst_list], dtype=np.int64)
        return node_order, edge_index

    def get_feature_matrix(self, nodes: List[str]) -> np.ndarray:
        """Return a (N, feature_dim) matrix for the given node list.

        Missing features are filled with zeros.
        """
        mat = np.zeros((len(nodes), self.feature_dim), dtype=np.float32)
        for i, n in enumerate(nodes):
            feat = self._features.get(n)
            if feat is not None:
                mat[i] = feat
        return mat
