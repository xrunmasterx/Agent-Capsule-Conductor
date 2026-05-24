# Acceptance: Phase 2B Local Workbench Server

Phase 2B is complete only after Phase 2A is complete.

## 1. Server starts

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

The command should start a local server without importing UI code.

## 2. API tests pass

```bash
uv run pytest -q tests/server
uv run ruff check .
```

## 3. Required endpoints exist

Using TestClient or curl, these endpoints must work:

```text
GET /api/health
GET /api/version
GET /api/capsules
GET /api/capsules/{capsule_id}
GET /api/runs
GET /api/runs/{run_id}
GET /api/runs/{run_id}/nodes/{node_id}
GET /api/runs/{run_id}/nodes/{node_id}/artifacts
GET /api/workflows
```

## 4. Artifact API is safe

Acceptance:

- artifacts inside project root can be read,
- path traversal is rejected,
- missing files return 404,
- secret-like files are not exposed.

## 5. Core remains decoupled

`acc.core` must not import FastAPI.
