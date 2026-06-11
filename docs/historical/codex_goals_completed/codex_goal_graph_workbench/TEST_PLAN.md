# Test Plan: Graph Workbench

## 1. Test philosophy

Default tests must be hermetic. They must not call real Codex, Claude, Gemini, Cursor, network, or paid services.

All existing MVP tests must continue to pass.

## 2. Required commands

```bash
uv run pytest -q
uv run ruff check .
```

If frontend exists:

```bash
cd web && npm install && npm run build
cd web && npm run test -- --run
```

## 3. Backend graph tests

### Graph schema tests

- Valid graph loads.
- Missing graph id fails.
- Duplicate node id fails.
- Missing capsule id fails.
- Edge referencing missing node fails.
- Self edge fails.
- Cycle fails.
- Unknown mapping expression fails.

### Topological execution tests

- Serial A -> B order is A then B.
- Fan-out A -> B and A -> C may run B/C at same level.
- Fan-in A -> B, A -> C, B/C -> D runs D after B and C.
- Failed upstream blocks dependent downstream node.

### Graph runner tests

- Runs demo serial graph with fake capsules.
- Writes workflow_run.json.
- Creates per-node run directories.
- Node summaries include status, capsule id, output path, artifact dir.
- `--emit-json` stdout is a single JSON object if implemented.

## 4. API tests

- `GET /api/capsules` returns capsules.
- `GET /api/workflows` returns graph workflows.
- `GET /api/workflows/{id}` returns graph JSON.
- `PUT /api/workflows/{id}` saves graph JSON after validation.
- `POST /api/workflows/{id}/validate` returns validation report.
- `POST /api/workflows/{id}/run` starts or performs a run.
- `GET /api/runs/{id}` returns workflow run summary.
- `GET /api/runs/{id}/nodes/{node_id}` returns node run detail.

## 5. Frontend tests

- App renders Chinese UI labels.
- Capsule palette renders at least two capsules.
- Graph canvas renders nodes.
- Graph canvas renders edges.
- User can add a node to the canvas.
- User can connect two nodes.
- Save calls workflow save API.
- Validate calls workflow validate API.
- Run calls workflow run API.
- Node inspector shows selected node data.
- Run inspector shows output/artifacts/log tabs.

## 6. Visual smoke test

A human should be able to verify:

- UI language is Chinese.
- Two nodes can be connected by dragging an edge.
- Parallel branches are visible.
- Auto layout makes dependencies readable.
- Node run statuses are visible.
