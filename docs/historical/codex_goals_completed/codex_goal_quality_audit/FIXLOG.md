# Quality Audit Fix Log

## Summary

This hardening pass fixed all findings that were classified as `high`, and also closed the two `medium` findings that were cheap and directly related to the same hot paths.

## Fixes applied

### 1. Browser E2E capsule cleanup

- Problem:
  - `web/scripts/browser-e2e.mjs` created `browser-e2e-*.generic` capsules and left them in `capsules/`, polluting `acc list` and making browser QA stateful across runs.
- Change:
  - Track created capsule ids during Journey B.
  - Delete them in `finally`, preferring the API path and falling back to direct filesystem cleanup.
  - Remove old stale `browser-e2e-*` capsule directories from the repository worktree.
- Files:
  - [browser-e2e.mjs](/F:/Agent-Capsule-Conductor/web/scripts/browser-e2e.mjs)
- Verification:
  - Latest browser report: [browser_e2e_report.json](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/browser_e2e_report.json)
  - Cleanup assertion: [acceptance_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/acceptance_assertions.json)
  - `remaining_count` is `0`

### 2. Workflow graph hot-path simplification

- Problem:
  - `topological_levels(...)` rescanned nodes on each layer.
  - Ancestor validation rescanned edges repeatedly.
- Change:
  - Centralized control-graph structure building.
  - Rewrote level computation to queue-based incremental traversal.
  - Replaced repeated ancestor edge scans with propagated bitmasks.
- Files:
  - [workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py)
- Verification:
  - Unit regression: [test_workflow_graph_schema.py](/F:/Agent-Capsule-Conductor/tests/unit/test_workflow_graph_schema.py)
  - Perf evidence: [performance_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/performance_report.json)

### 3. Event replay JSONL streaming

- Problem:
  - `read_jsonl_events(...)` loaded the full file with `read_text(...).splitlines()`.
- Change:
  - Added line-by-line iterator.
  - Kept the public helper output shape unchanged for callers.
- Files:
  - [events.py](/F:/Agent-Capsule-Conductor/acc/events.py)
- Verification:
  - Unit regression: [test_events.py](/F:/Agent-Capsule-Conductor/tests/unit/test_events.py)
  - Perf evidence: [performance_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/performance_report.json)

### 4. Artifact directory diff memory amplification removal

- Problem:
  - Directory diff read every artifact file fully and hex-encoded it.
- Change:
  - Switched to streaming SHA-256 digests for directory fingerprints.
  - Switched binary file diff metadata to digest + size instead of full in-memory byte comparison.
- Files:
  - [debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py)
- Verification:
  - Unit regression: [test_debugger.py](/F:/Agent-Capsule-Conductor/tests/unit/test_debugger.py)

### 5. Instance-local capsule registry cache

- Problem:
  - `CapsuleRegistry.get(...)` triggered full rediscovery/parsing via `discover()` on repeated lookups.
- Change:
  - Added per-instance discovery and id-map caches.
  - Avoided global cache complexity.
- Files:
  - [registry.py](/F:/Agent-Capsule-Conductor/acc/registry.py)
- Verification:
  - Unit regression: [test_registry.py](/F:/Agent-Capsule-Conductor/tests/unit/test_registry.py)

## Regression and acceptance evidence

- Full Python test suite: `uv run pytest -q` -> `180 passed`
- Lint: `uv run ruff check .` -> pass
- Frontend tests: `npm test` -> pass
- Frontend build: `npm run build` -> pass with a chunk-size warning only
- Browser E2E: `npm run test:e2e` -> pass
- Acceptance command chain report: [final_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/final_report.json)
- Acceptance assertions: [acceptance_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/acceptance_assertions.json)
- JSON parse assertions: [json_output_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/json_output_assertions.json)
