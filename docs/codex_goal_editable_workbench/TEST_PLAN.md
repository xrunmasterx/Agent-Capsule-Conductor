# Editable Workbench MVP Test Plan

## 1. Test philosophy

Keep all previous tests passing.

Default tests must remain hermetic:

- no real Codex login;
- no Claude credentials;
- no network dependency;
- no real Conductor dependency;
- no browser e2e dependency unless explicitly configured.

## 2. Required commands

Core:

```bash
uv run pytest -q
uv run ruff check .
```

Workbench:

```bash
uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force
uv run acc validate demo-research.generic
uv run acc workflow validate examples/workflows/demo_two_node.graph.json
uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json
```

If web exists:

```bash
cd web && npm install && npm run build
```

If server exists:

```bash
uv run pytest -q tests/server
```

## 3. Unit tests

### Capsule scaffold

File: `tests/unit/test_capsule_scaffold.py`

Cases:

1. Valid blueprint generates all required files.
2. Generated capsule validates.
3. Duplicate capsule id fails unless `--force` is set.
4. Invalid runtime fails.
5. Invalid field type fails.
6. Path traversal in capsule id fails.
7. Generated example input matches input schema.
8. Generated output schema includes required output fields.

### Workflow graph schema

File: `tests/unit/test_workflow_graph_schema.py`

Cases:

1. Valid graph loads.
2. Missing graph id fails.
3. Duplicate node id fails.
4. Duplicate edge id fails.
5. Edge source missing fails.
6. Edge target missing fails.
7. Missing capsule id fails.
8. Cycle detection works.
9. Position field is optional.
10. Node input must be object.

### Workflow graph runner

File: `tests/integration/test_workflow_graph_runner.py`

Cases:

1. Runs demo two-node graph successfully.
2. Creates workflow_run.json.
3. Creates per-node run dirs.
4. Passes previous node output into next node through template mapping.
5. Emits exactly one JSON object when `--emit-json` is set.
6. Failed node marks workflow failed.
7. Failed node still writes workflow_run.json.

### API tests

File: `tests/server/test_capsule_api.py`

Cases:

1. GET /api/health returns ok.
2. GET /api/capsules returns list.
3. POST /api/capsules/scaffold creates capsule.
4. GET capsule file reads allowed file.
5. PUT capsule file writes allowed file.
6. Path traversal is rejected.
7. Validate endpoint returns detailed errors.

File: `tests/server/test_workflow_api.py`

Cases:

1. GET /api/workflows returns list.
2. POST /api/workflows saves graph.
3. PUT /api/workflows/{id} updates graph.
4. Validate graph endpoint catches invalid edges.
5. Run graph endpoint creates run.

## 4. UI build tests

If `web/` exists or is created:

```bash
cd web && npm run build
```

Optional if a test runner exists:

```bash
cd web && npm test
```

Minimal expected UI compile coverage:

- Capsule Library compiles.
- Capsule Editor compiles.
- Workflow Builder compiles.
- Run Inspector compiles.

## 5. Acceptance smoke tests

### Smoke 1: Scaffold and run capsule

```bash
uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force
uv run acc validate demo-research.generic
uv run acc run demo-research.generic --input capsules/demo-research.generic/examples/input.json --run-dir runs/acceptance_demo_capsule --emit-conductor-json
```

### Smoke 2: Validate and run workflow graph

```bash
uv run acc workflow validate examples/workflows/demo_two_node.graph.json
uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json
```

### Smoke 3: API health

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

Then API tests should pass with TestClient or equivalent.

### Smoke 4: Web build

```bash
cd web && npm run build
```
