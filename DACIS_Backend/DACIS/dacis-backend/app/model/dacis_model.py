"""
DACISGraphSAGE model definition.

Ground-truth copy of the model architecture from Notebook 3 Cell 3,
augmented with get_embedding() for Gate 2's re-embedding step
(identical to Notebook 1/2 otherwise).

On startup, ``registry.py`` validates that the loaded state_dict keys
match the model architecture.  If they don't, a clear error is raised
rather than silently loading partial weights.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from torch_geometric.nn import SAGEConv


# ─────────────────────────────────────────────────────────────────────
# EXACT CLASS FROM NOTEBOOK 3 CELL 3
# ─────────────────────────────────────────────────────────────────────


class DACISGraphSAGE(nn.Module):
    """Ground-truth DACIS GraphSAGE model.

    Two-layer SAGEConv (max aggregation) with BatchNorm, dropout, and
    a linear classification head.

    Parameters
    ----------
    in_channels : int
        Number of input node features.
    hidden_channels : int
        Hidden / embedding dimension.
    out_channels : int
        Number of output classes (2 for binary fraud detection).
    dropout : float
        Dropout probability applied before the classifier.
    """

    def __init__(
        self,
        in_channels: int,
        hidden_channels: int,
        out_channels: int,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        self.conv1 = SAGEConv(in_channels, hidden_channels, aggr="max")
        self.bn1 = nn.BatchNorm1d(hidden_channels)
        self.conv2 = SAGEConv(hidden_channels, hidden_channels, aggr="max")
        self.bn2 = nn.BatchNorm1d(hidden_channels)
        self.head = nn.Linear(hidden_channels, out_channels)
        self.dropout = dropout

    def get_embedding(
        self, x: torch.Tensor, edge_index: torch.Tensor
    ) -> torch.Tensor:
        """Forward pass through convolution layers only — returns embeddings.

        Parameters
        ----------
        x : Tensor, shape (N, in_channels)
            Node feature matrix for the subgraph.
        edge_index : Tensor, shape (2, E)
            Edge index in COO format.

        Returns
        -------
        Tensor, shape (N, hidden_channels)
        """
        x = self.conv1(x, edge_index)
        x = self.bn1(x)
        x = F.relu(x)
        x = self.conv2(x, edge_index)
        x = self.bn2(x)
        x = F.relu(x)
        return x

    def forward(
        self, x: torch.Tensor, edge_index: torch.Tensor
    ) -> torch.Tensor:
        """Full forward pass — embeddings → dropout → classifier.

        Returns
        -------
        Tensor, shape (N, out_channels)
            Raw logits per class.
        """
        emb = self.get_embedding(x, edge_index)
        emb_drop = F.dropout(emb, p=self.dropout, training=self.training)
        return self.head(emb_drop)
