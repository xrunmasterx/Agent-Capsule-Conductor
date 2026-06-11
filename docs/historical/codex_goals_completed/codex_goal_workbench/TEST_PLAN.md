# Workbench Next Phase Test Plan

## 1. Test philosophy

All new default tests must remain hermetic.

No default test may require:

- real Codex login,
- Claude credentials,
- network,
- Conductor installation,
- browser automation unless explicitly enabled.

## 2. Phase 2A tests

### `tests/unit/test_run_index.py`

Cases:

1. Empty runs directory produces empty index.
2. Existing run directories can be indexed.
3. Corrupt run directory is skipped or marked invalid with warning.
4. RunIndex serializes to `runs/index.json`.
5. RunIndex loads from `runs/index.json`.
6. Missing index can be rebuilt by scanning.

### `tests/unit/test_node_run_summary.py`

Cases:

1. Successful node run creates `node_summary.json`.
2. Failed node run creates `node_summary.json` with error class.
3. Summary includes paths to input, prompt, output, artifacts, event log, stdout, stderr.
4. Summary does not expose secrets from env or credentials.

### `tests/unit/test_artifact_manifest_v2.py`

Cases:

1. Existing artifact manifest remains compatible.
2. v2 display fields parse correctly.
3. Unknown viewer type fails or warns consistently.
4. Required artifacts are still validated.
5. Path traversal in artifact path is rejected.

### `tests/integration/test_cli_runs.py`

Cases:

1. `acc runs list` exits 0.
2. `acc runs list --json` returns valid JSON.
3. `acc runs show <run_id>` exits 0.
4. `acc runs show <run_id> --json` returns valid JSON.
5. Missing run id returns non-zero with useful error.

### `tests/integration/test_cli_capsule_authoring.py`

Cases:

1. `acc capsule test echo-test.generic ...` succeeds.
2. `acc capsule clone echo-test.generic echo-test-copy.generic` creates new capsule.
3. `acc capsule doctor echo-test.generic` succeeds.
4. `acc capsule doctor broken-capsule` reports actionable errors.

### Regression tests

Previous MVP tests must still pass:

```bash
uv run pytest -q
uv run ruff check .
```

## 3. Phase 2B server tests

Use FastAPI TestClient.

### `tests/server/test_health.py`

Cases:

1. `GET /api/health` returns 200.
2. `GET /api/version` returns package version or fallback.

### `tests/server/test_capsules_api.py`

Cases:

1. `GET /api/capsules` returns list.
2. `GET /api/capsules/{id}` returns metadata.
3. Missing capsule returns 404.
4. Validate endpoint returns validation result.

### `tests/server/test_runs_api.py`

Cases:

1. `GET /api/runs` returns indexed runs.
2. `GET /api/runs/{id}` returns run summary.
3. Missing run returns 404.
4. Node details include artifact links.

### `tests/server/test_artifacts_api.py`

Cases:

1. Can read markdown artifact inside project root.
2. Can read JSON artifact inside project root.
3. Path traversal is rejected.
4. Secret-like files are not served.

## 4. Phase 2C UI tests

If UI is built, use lightweight component/unit tests first.

Required smoke checks:

1. Run list page renders fixture runs.
2. Run inspector shows node details.
3. Artifact viewer renders markdown and JSON fixtures.
4. Workflow viewer renders read-only nodes.
5. UI has no save/edit workflow action in read-only MVP.

Browser E2E is optional and should not be required by default unless tooling is configured.

## 5. Acceptance commands

Each phase has its own acceptance file. Do not claim completion until the relevant phase acceptance commands pass.
