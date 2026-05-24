# Goal 2: Local Workbench Server

## Objective

Expose the existing `acc` core through a local FastAPI server so a future UI can inspect capsules, runs, workflows, and artifacts without directly parsing filesystem internals.

## Precondition

Goal 1 Usability Core should be complete.

## Required deliverables

1. Server package:
   - `acc/server/app.py`
   - `acc/server/routes/capsules.py`
   - `acc/server/routes/runs.py`
   - `acc/server/routes/artifacts.py`
   - `acc/server/routes/workflows.py`
   - `acc/server/routes/health.py`

2. CLI command:
   - `acc server --host 127.0.0.1 --port 8765`

3. API endpoints:
   - `GET /api/health`
   - `GET /api/version`
   - `GET /api/capsules`
   - `GET /api/capsules/{capsule_id}`
   - `POST /api/capsules/{capsule_id}/validate`
   - `POST /api/capsules/{capsule_id}/test`
   - `GET /api/runs`
   - `GET /api/runs/{run_id}`
   - `GET /api/runs/{run_id}/nodes/{node_id}`
   - `GET /api/runs/{run_id}/nodes/{node_id}/artifacts`
   - `GET /api/artifacts/read?path=...`
   - `GET /api/workflows`
   - `GET /api/workflows/{workflow_id}`

4. Security constraints:
   - only serve files inside configured project root,
   - reject path traversal,
   - do not expose secrets,
   - server is local-only by default.

## Must preserve

- `acc.core` must not depend on FastAPI.
- CLI tests must remain hermetic.
- Server tests must use TestClient and local fixtures.

## Completion condition

Complete only when API tests pass and previous acceptance commands still pass.
