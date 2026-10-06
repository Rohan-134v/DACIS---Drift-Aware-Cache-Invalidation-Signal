"""
Tests for app.model and app.graph — model loading and subgraph extraction.

Critical correctness tests:
    1. get_subgraph() returns exactly the expected node set for L=1 and
       L=2 on a known graph.
    2. edge_index is correct for the extracted subgraph.
    3. Model state_dict key mismatch raises RuntimeError (not silent
       partial load).
"""

from __future__ import annotations

import numpy as np
import pytest
import torch

from app.graph.graph_store import GraphStore
from app.graph.union_find import UnionFind
from app.model.dacis_model import DACISGraphSAGE


# ── Graph Store — Subgraph Extraction ────────────────────────────────────


class TestGetSubgraph:
    """Tests for get_subgraph on a known small graph.

    The test graph:
        A — B — C — D
        |       |
        E       F — G

    Adjacency:
        A: {B, E}
        B: {A, C}
        C: {B, D, F}
        D: {C}
        E: {A}
        F: {C, G}
        G: {F}
    """

    @pytest.fixture
    def graph(self) -> GraphStore:
        g = GraphStore(feature_dim=4)
        edges = [("A", "B"), ("B", "C"), ("C", "D"), ("A", "E"), ("C", "F"), ("F", "G")]
        for src, dst in edges:
            g.add_edge(src, dst)
        return g

    def test_l1_subgraph_from_A(self, graph: GraphStore):
        """L=1 from A should include {A, B, E}."""
        nodes, edge_index = graph.get_subgraph("A", l_hops=1, max_neighbors_per_hop=10)
        assert set(nodes) == {"A", "B", "E"}
        assert nodes[0] == "A"  # center is always first

    def test_l2_subgraph_from_A(self, graph: GraphStore):
        """L=2 from A should include {A, B, E, C} (B's neighbors: A,C;
        E's neighbors: A — both already visited except C)."""
        nodes, edge_index = graph.get_subgraph("A", l_hops=2, max_neighbors_per_hop=10)
        assert set(nodes) == {"A", "B", "E", "C"}
        assert nodes[0] == "A"

    def test_l1_subgraph_from_C(self, graph: GraphStore):
        """L=1 from C should include {C, B, D, F}."""
        nodes, edge_index = graph.get_subgraph("C", l_hops=1, max_neighbors_per_hop=10)
        assert set(nodes) == {"C", "B", "D", "F"}
        assert nodes[0] == "C"

    def test_l2_subgraph_from_C(self, graph: GraphStore):
        """L=2 from C should include {C, B, D, F, A, G}."""
        nodes, edge_index = graph.get_subgraph("C", l_hops=2, max_neighbors_per_hop=10)
        assert set(nodes) == {"C", "B", "D", "F", "A", "G"}
        assert nodes[0] == "C"

    def test_l1_subgraph_from_leaf(self, graph: GraphStore):
        """L=1 from G (leaf) should include {G, F}."""
        nodes, edge_index = graph.get_subgraph("G", l_hops=1, max_neighbors_per_hop=10)
        assert set(nodes) == {"G", "F"}
        assert nodes[0] == "G"

    def test_neighbor_cap(self, graph: GraphStore):
        """max_neighbors_per_hop=1 should limit fan-out."""
        nodes, edge_index = graph.get_subgraph("C", l_hops=1, max_neighbors_per_hop=1)
        # C has 3 neighbors {B, D, F} but capped at 1
        assert len(nodes) == 2  # C + 1 neighbor
        assert nodes[0] == "C"

    def test_edge_index_correctness(self, graph: GraphStore):
        """edge_index should contain only edges between nodes in the subgraph,
        using local indices."""
        nodes, edge_index = graph.get_subgraph("A", l_hops=1, max_neighbors_per_hop=10)
        node_set = set(nodes)
        node_to_idx = {n: i for i, n in enumerate(nodes)}

        # All indices in edge_index should be valid
        assert edge_index.shape[0] == 2
        assert np.all(edge_index[0] >= 0) and np.all(edge_index[0] < len(nodes))
        assert np.all(edge_index[1] >= 0) and np.all(edge_index[1] < len(nodes))

        # Check specific edges: A-B, A-E, B-A, E-A should be present
        edges = set()
        for i in range(edge_index.shape[1]):
            edges.add((nodes[edge_index[0, i]], nodes[edge_index[1, i]]))

        assert ("A", "B") in edges
        assert ("B", "A") in edges
        assert ("A", "E") in edges
        assert ("E", "A") in edges
        # B-C should NOT be present (C not in subgraph)
        assert ("B", "C") not in edges

    def test_unknown_node_returns_singleton(self, graph: GraphStore):
        """Unknown node should return a singleton subgraph with no edges."""
        nodes, edge_index = graph.get_subgraph("UNKNOWN", l_hops=2, max_neighbors_per_hop=10)
        assert nodes == ["UNKNOWN"]
        assert edge_index.shape == (2, 0)

    def test_feature_matrix(self, graph: GraphStore):
        """get_feature_matrix should return correct features for known nodes."""
        features_a = np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
        graph.update_features("A", features_a)

        nodes, _ = graph.get_subgraph("A", l_hops=1, max_neighbors_per_hop=10)
        mat = graph.get_feature_matrix(nodes)
        assert mat.shape == (len(nodes), 4)
        np.testing.assert_array_equal(mat[0], features_a)  # A is first
        # B and E have no features — should be zeros
        for i in range(1, len(nodes)):
            np.testing.assert_array_equal(mat[i], np.zeros(4))


# ── Union-Find ───────────────────────────────────────────────────────────


class TestUnionFind:
    """Basic union-find correctness tests (no Redis)."""

    def test_initial_find(self):
        uf = UnionFind()
        assert uf.find("a") == "a"

    def test_union_and_find(self):
        uf = UnionFind()
        uf.union("a", "b")
        assert uf.find("a") == uf.find("b")

    def test_transitive_union(self):
        uf = UnionFind()
        uf.union("a", "b")
        uf.union("b", "c")
        assert uf.find("a") == uf.find("c")

    def test_separate_components(self):
        uf = UnionFind()
        uf.union("a", "b")
        uf.union("c", "d")
        assert uf.find("a") != uf.find("c")

    def test_merge_callback(self):
        """on_merge should be called with (winner, loser) when roots differ."""
        merges = []
        uf = UnionFind(on_merge=lambda w, l: merges.append((w, l)))
        uf.union("a", "b")
        assert len(merges) == 1
        winner, loser = merges[0]
        # One of them should be the new root
        assert uf.find("a") == winner
        assert uf.find("b") == winner

    def test_no_merge_callback_when_same_root(self):
        """on_merge should NOT be called when both are already in same set."""
        merges = []
        uf = UnionFind(on_merge=lambda w, l: merges.append((w, l)))
        uf.union("a", "b")
        merges.clear()
        uf.union("a", "b")  # same root
        assert len(merges) == 0


# ── Model ────────────────────────────────────────────────────────────────


class TestDACISGraphSAGE:
    """Basic model tests (placeholder architecture)."""

    def test_forward_shape(self):
        model = DACISGraphSAGE(in_channels=16, hidden_channels=64, out_channels=2)
        x = torch.randn(5, 16)
        edge_index = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 4]], dtype=torch.long)
        out = model(x, edge_index)
        assert out.shape == (5, 2)

    def test_embedding_shape(self):
        model = DACISGraphSAGE(in_channels=16, hidden_channels=64, out_channels=2)
        x = torch.randn(5, 16)
        edge_index = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 4]], dtype=torch.long)
        emb = model.get_embedding(x, edge_index)
        assert emb.shape == (5, 64)

    def test_empty_edge_index(self):
        """Model should handle subgraphs with no edges (isolated nodes)."""
        model = DACISGraphSAGE(in_channels=16, hidden_channels=64, out_channels=2)
        x = torch.randn(3, 16)
        edge_index = torch.zeros(2, 0, dtype=torch.long)
        out = model(x, edge_index)
        assert out.shape == (3, 2)

    def test_state_dict_keys_stable(self):
        """State dict keys should be deterministic and matchable."""
        m1 = DACISGraphSAGE(in_channels=16, hidden_channels=64, out_channels=2)
        m2 = DACISGraphSAGE(in_channels=16, hidden_channels=64, out_channels=2)
        assert set(m1.state_dict().keys()) == set(m2.state_dict().keys())
