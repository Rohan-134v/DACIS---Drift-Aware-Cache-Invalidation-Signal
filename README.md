# DACIS: Drift-Aware Cache Invalidation Signal

DACIS is a research prototype for adaptive fraud detection in transaction networks. It combines online statistical monitoring with temporal graph learning and an adaptive cache invalidation policy. The repository also includes NeuroBank, a demonstration banking application used to exercise the detector with reproducible transaction scenarios.

> **Research and demonstration software.** NeuroBank is not a real banking product. Do not use it with production credentials, personal financial data, or live transactions.

## What the system does

- **Gate 1:** Welford online statistics detect account-level amount anomalies without requiring a full history in memory.
- **Gate 2:** GraphSAGE-based community analysis identifies suspicious relationships and coordinated laundering behavior.
- **Dual-gate invalidation:** Temporal graph cache entries are invalidated or refreshed when statistical and graph signals indicate drift.
- **Redis-backed serving:** The FastAPI service uses Redis for scalable cache management and low-latency inference state.
- **Reproducible replay:** AMLSim transaction replays inject controlled fraud bursts across defined evaluation scenarios.
- **NeuroBank demo:** A Next.js customer/admin interface and Express API visualize transactions, alerts, and DACIS decisions.

## Repository map

```text
Bank-Interface/
  neurobank/                 Next.js UI and Express API
DACIS_Backend/
  DACIS/dacis-backend/       FastAPI service, gates, graph logic, tests
Final Notebooks/             Research, training, and analysis notebooks
demo-transactions.js         Reproducible demo transaction phases
reset-demo.js                Demo data reset and seeding
start-all.bat                Windows launcher for the local stack
run-demo.bat                 Windows demo replay launcher
Panel-Review.md              Demo scenarios and expected outcomes
THEORY_TO_CODE_AUDIT.md      Mapping between the paper theory and implementation
```

Model checkpoints, dependency folders, build output, local environment files, and Firebase service-account credentials are intentionally excluded from this repository. See `.gitignore` for the full publication boundary.

## Prerequisites

- Node.js 20 or later and npm
- Python 3.10 or later
- Docker Desktop with Docker Compose
- A Firebase project for the demo API
- Redis, provided by the DACIS Docker Compose configuration

## Configuration

Create local environment files from the variables used by the services. Never commit real values:

- `Bank-Interface/neurobank/.env.local`: Firebase client settings for Next.js
- `Bank-Interface/neurobank/backend/.env`: Firebase Admin settings, API port, and DACIS URL
- `DACIS_Backend/DACIS/dacis-backend/.env`: Redis URL, model paths, gate thresholds, and server settings

The Firebase Admin private key must be supplied through a local environment variable or secret manager. The service-account JSON file must remain outside git.

## Run locally

Install JavaScript dependencies:

```powershell
cd Bank-Interface
npm run install:all
```

Start the DACIS service, API, and UI in separate terminals:

```powershell
cd DACIS_Backend/DACIS/dacis-backend
docker compose up -d

cd Bank-Interface/neurobank/backend
npm start

cd Bank-Interface/neurobank
npm run dev
```

On Windows, `start-all.bat` provides the combined launcher. The UI is normally available at `http://localhost:3000`, the Express API at `http://localhost:4000`, and the DACIS API at `http://localhost:8000`.

## Run tests and the demo

Run the DACIS backend tests:

```powershell
cd DACIS_Backend/DACIS/dacis-backend
python -m pytest
```

After configuring Firebase and starting the services, reset and replay the demonstration data:

```powershell
cd ..\..\..\..
node reset-demo.js
node demo-transactions.js
```

The replay covers baseline traffic, a high-value anomaly, structured transfers, persistent flags, micro-structuring, and a clean verification transfer. Detailed scenario counts and expected outcomes are documented in `Panel-Review.md`.

## Research status

This codebase supports an active research manuscript. Results and metrics should be reproduced from the notebooks and test suite rather than treated as production guarantees. Large datasets and model checkpoints are not versioned here because of repository size and distribution constraints.

## Contributions

| Contributor | Contributions |
|---|---|
| **Rohan** | Engineered the AMLSim replay pipeline with controllable fraud-burst injection for reproducible experiments; built the asynchronous FastAPI serving layer and migrated cache state from an in-memory dictionary to Redis; implemented all five evaluation scenarios and baseline systems; contributed to the experimental setup, baseline comparison, and ablation sections of the manuscript in preparation. |
| **Kaushik** | Derived and implemented the PyTorch dual-gate cache invalidation algorithm for temporal GNNs, achieving 99.21% precision on AMLSim; trained and debugged TGN and GraphSAGE models across Elliptic Bitcoin, AMLSim, PaySim, and IEEE-CIS; designed ablation and statistical validation protocols, including a documented negative result; authored core manuscript sections and produced architecture and results figures for the planned IEEE submission. |

To tag Kaushik correctly in GitHub, replace the display name in this table with his verified GitHub handle before publishing or open a follow-up pull request with the handle.

## License

No license has been selected for this research prototype yet. Until a license is added, all rights are reserved by the authors.
