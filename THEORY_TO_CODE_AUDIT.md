# THEORY_TO_CODE_AUDIT.md: DACIS Forensic Implementation Blueprint

This document represents an exhaustive, line-by-line forensic audit of the DACIS (Drift-Aware Cache Invalidation Signal) inference modules, specifically analyzing `dacis-nb3-final-final.ipynb`. It maps theoretical formulations directly to their programmatic execution, providing the exact blueprints needed for paper revision.

## 1. EXACT MATHEMATICAL FORMULATIONS & TRACKING PRIMITIVES

### Welford’s Algorithm Implementation
Welford's algorithm is implemented in the `WelfordTracker` class. The exact programmatic equations for maintaining online statistics are:
* **Sample Count Update:**
  ```python
  self.count[entity_idx] += 1
  n = self.count[entity_idx].float()
  ```
* **Running Mean Update:**
  ```python
  delta = z - self.mean[entity_idx]
  self.mean[entity_idx] += delta / n
  ```
* **Sum-of-Squared-Deviations ($M_2$) Update:**
  ```python
  delta2 = z - self.mean[entity_idx]
  self.M2[entity_idx] += delta * delta2
  ```

### Anomaly Scoring (Z-Score vs. Euclidean Delta)
The system calculates a **mean dimension-wise absolute z-score** across raw hidden embedding channels, *not* a scalar Euclidean distance delta against a cached state. 
This is implemented in `WelfordTracker.z_score()`:
```python
variance = self.M2[entity_idx] / max(n - 1, 1)
std = torch.sqrt(variance + 1e-8)
return ((z - self.mean[entity_idx]).abs() / std).mean().item()
```
*Mathematical form:* $Z = \frac{1}{d} \sum_{i=1}^{d} \frac{|z_i - \mu_i|}{\sigma_i}$

### Burn-In & Exclusions
* **Hyperparameters:**
  * `BURN_IN_MIN_NEIGHBORS = 5` (Controls both `LocalEMATracker` and Gate 1's `WelfordTracker`).
  * `COMMUNITY_WELFORD_BURN_IN = 5` (Controls Gate 2's community baseline).
* **Causal Read-then-Update Ordering:** The pipeline reads/scores the node *before* committing an update. Furthermore, flagged observations are explicitly excluded from updating their respective baselines to prevent drifting entities from normalizing their own escalation:
  ```python
  if sender_account_idx is not None and not gate1_flag:
      welford_tracker.update(sender_account_idx, z_v)
  if not gate2_flag:
      community_tracker.update(community_id[idx].item(), z_v)
  ```

## 2. ENTITY SPACES & STRUCTURAL TOPOLOGY CONSTRUCTION

### Gate 1 Keying (Account vs. Transaction)
Entities are keyed by **account node index**, isolating persistent accounts from one-shot transaction nodes. The adjacency lookup logic identifies a transaction originating from an account by checking for an in-degree of exactly 1:
```python
in_nbrs = in_adj_csr[idx].indices
if len(in_nbrs) == 1:
    sender_account_idx = int(in_nbrs[0])
```

### Gate 2 Keying (Community Generation)
Community grouping is handled by `build_communities()`:
1. **Algorithm:** Nodes are grouped into weakly-connected components using `scipy.sparse.csgraph.connected_components(..., directed=False)`.
2. **Capping/Chunking:** Components larger than `max_component_size = 500` are chunked using Breadth-First Search (`scipy.sparse.csgraph.breadth_first_order`).
3. **Fallback:** The script verifies BFS locality. If the BFS visited set disagrees with the component members (`set(order.tolist()) == members_set` is false), it falls back to standard sorted-index chunking (`chunk_source = members`).

### Adjacency Directionality & Receptive Fields
* **Directionality:** To correctly align with `SAGEConv`'s in-neighbor message flow (source -> target), the adjacency matrix explicitly flips the edge index via `data.edge_index.flip(0)` in `build_in_neighbor_csr()`.
* **L-Hop Subgraph:** Constructed using BFS in `l_hop_in_neighbors()`.
* **Hyperparameters:** Depth defaults to `L_HOPS = 2`. Out-degree is capped via `MAX_NEIGHBORS_PER_HOP = 500` (nodes exceeding this have their neighbors subsampled without replacement).

## 3. SEQUENTIAL CONTROL FLOW & TIERED GATING LOGIC

### Gate Execution Hierarchy
Gate 1 (`gate1_flag`) and Gate 2 (`gate2_flag`) are executed **sequentially**. 
Gate 2 is no longer AND-gated in parallel; it acts purely as a conditional confirmation tier evaluated strictly inside the `if gate1_flag:` block. 

### Score Boosting & Confidence Tiering
Downstream multipliers are applied as follows:
* **Gate 1 Trigger:** `dg_score = min(1.0, dg_score * 1.5)`
* **Gate 2 Confirmation** (requires Gate 1): `dg_score = min(1.0, dg_score * 1.2)`
* **Confidence Tiers:**
  * `HIGH` is assigned if Gate 2 confirms the Gate 1 anomaly.
  * `MODERATE` is assigned if Gate 1 fires but Gate 2 does not confirm.

### Cache Invalidation Guard
The EMA embedding cache (`local_tracker`) is actually updated **unconditionally** for all nodes in the streaming loop:
```python
local_tracker.update(torch.tensor([idx], device=device), z_v.unsqueeze(0))
```
However, the Welford trackers (representing statistical baselines) have explicit caching invalidation guards:
* Gate 1 uniquely guards the Account Welford tracker: `if not gate1_flag: welford_tracker.update(...)`
* Gate 2 uniquely guards the Community Welford tracker: `if not gate2_flag: community_tracker.update(...)`

## 4. RUNTIME PIPELINE: HOT-PATH VS. REPLAY SIMULATION

### Execution Mechanics
The streaming pipeline **does not** perform live, synchronous L-hop subgraph re-embeddings (`GraphSAGE.embed`) on cache misses. 
Instead, base embeddings and base probabilities are **precomputed offline** via a full-graph forward pass prior to chronological streaming:
```python
with torch.no_grad():
    all_embeddings = model.get_embedding(data.x, data.edge_index)
    all_logits = model.linear(all_embeddings)
    all_probs = F.softmax(all_logits, dim=1)[:, 1]
```
The streaming loop sequentially reads from `all_embeddings[idx]`.

### Latency & Cost Accounting
There is **no programmatic cost accounting or latency modeling** in the streaming loop. Overhead is not tracked (e.g., via `time.time()` tracking or FLOP counters); the loop purely utilizes `tqdm` for progression.

## 5. EMPIRICAL DIAGNOSTICS, CANARIES & DATASET ARTIFACTS

### Topological Canaries
* Function `report_isolation_diagnostic` measures the fraction of test nodes with zero in-neighbors.
* **Findings:** On the Elliptic dataset, exactly **36.23%** of test nodes exhibit an in-degree of 0.
* **Impact:** For highly isolated test populations, Gate 2 (and the neighbor-based half of Gate 1) becomes structurally meaningless, rendering the topological baseline non-functional.

### Community Separation Diagnostics
* Function `diagnose_community_welford_by_label` measures effect sizes of community separation.
* It reports specific verdicts such as `POSSIBLE SIGNAL` (effect size > 0.5), `NO MEANINGFUL SEPARATION`, or `INVERTED` (effect size < -0.5, meaning fraud z-scores run *lower* than legit). On datasets with poor structural connectivity, it actively states `NO SEPARATION — treat Gate 2 as non-functional`.

## 6. PAPER REVISION MAPPING TABLE

| Code Module / Function | Current Code Behavior | Target Paper Section to Revise | Required LaTeX / Prose Update |
| :--- | :--- | :--- | :--- |
| `WelfordTracker.z_score` | Computes mean dimension-wise absolute z-score ($Z = \frac{1}{d} \sum \frac{\|z_i - \mu_i\|}{\sigma_i}$) | Mathematical Formulation (Anomaly Scoring) | Replace Euclidean distance $\Delta$ with absolute dimension-wise z-score formula. |
| `build_in_neighbor_csr` | Transposes edge index `flip(0)` to map source $\rightarrow$ target for `SAGEConv` in-neighbor flow | Experimental Setup (Graph Topology) | Explicitly document adjacency transposition aligning structural BFS with message-passing directionality. |
| `execute_streaming_pipeline` | Embeddings (`all_embeddings`) are precomputed entirely offline before streaming | Methodology (Streaming Inference) | Clarify that the implementation is a replay simulation utilizing offline precomputed embeddings, not synchronous live subgraph GNN execution. |
| `execute_streaming_pipeline` | Gate 2 only evaluates if Gate 1 fires; assigns `MODERATE`/`HIGH` confidence tiers | Architecture (Dual-Gate Fusion) | Update fusion equation: Gate 2 is a tiered sequential confirmation, not an AND-gated parallel check. |
| `execute_streaming_pipeline` | Score boosting: `* 1.5` on Gate 1 trigger, `* 1.2` on Gate 2 confirmation | Architecture (Dual-Gate Fusion) | Document the exact 1.5x and 1.2x scalar multipliers and `min(1.0, x)` bounds applied to baseline probabilities. |
| `local_tracker.update` | EMA cache updates unconditionally, bypassing Gate flags | Architecture (Cache Invalidation) | Note that structural cache invalidation guards only the statistical Welford moments, while raw EMA embeddings update unconditionally. |
| `report_isolation_diagnostic` | 36.23% of Elliptic test nodes have 0 in-neighbors | Results (Ablation / Dataset Artifacts) | Add a section discussing dataset topological sparsity; acknowledge that 36% of Elliptic is structurally immune to Gate 2. |
