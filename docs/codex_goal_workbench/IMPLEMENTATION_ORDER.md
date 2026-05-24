# Workbench Implementation Order

## Phase 2A: Usability Core

### Milestone A1: Run summaries

Deliver:

- RunIndex model
- RunSummary model
- NodeRunSummary model
- JSON serialization/deserialization
- tests

### Milestone A2: Run indexing commands

Deliver:

- `acc runs list`
- `acc runs list --json`
- `acc runs show <run_id>`
- `acc runs show <run_id> --json`

### Milestone A3: Inspect JSON

Deliver:

- `acc inspect --json`
- normalized inspect output
- tests preserving existing inspect behavior

### Milestone A4: ArtifactManifest v2

Deliver:

- backwards-compatible parser
- display/viewer metadata
- validation tests

### Milestone A5: Capsule authoring commands

Deliver:

- `acc capsule test`
- `acc capsule clone`
- `acc capsule doctor`

### Milestone A6: Acceptance

Run:

```bash
uv run pytest -q
uv run ruff check .
```

and all commands in `ACCEPTANCE_1_USABILITY_CORE.md`.

## Phase 2B: Local Workbench Server

Do not start until Phase 2A is accepted.

### Milestone B1: server package

Deliver:

- `acc/server/app.py`
- health/version routes
- TestClient tests

### Milestone B2: capsules and runs API

Deliver:

- capsules routes
- runs routes
- tests

### Milestone B3: artifacts and workflows API

Deliver:

- safe artifact reading
- workflow listing/read-only route
- path traversal tests

## Phase 2C: Visual Workbench Read-only MVP

Do not start until Phase 2B is accepted.

### Milestone C1: web skeleton

Deliver:

- React/TypeScript skeleton
- API client
- routing

### Milestone C2: Run Inspector

Deliver:

- run list
- run detail
- node detail
- artifact viewer

### Milestone C3: Capsule and Workflow viewers

Deliver:

- capsule browser
- workflow viewer
- no editing actions
