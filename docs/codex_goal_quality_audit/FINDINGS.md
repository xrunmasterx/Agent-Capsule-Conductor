# ACC Quality Audit Findings

Status: Baseline audit before code changes for the quality-hardening goal.

## Baseline evidence

- Baseline command report: [baseline_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/baseline_report.json)
- Core regression report: [regression_baseline_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/regression_baseline_report.json)
- Browser baseline report: [browser_e2e_report.json](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T14-47-13-330Z/browser_e2e_report.json)

Baseline facts confirmed:

- `uv run pytest -q` passed: `175 passed`
- `uv run ruff check .` passed
- `uv run acc list` passed
- `uv run acc validate echo-test.generic` passed
- `uv run acc validate fake-agent.generic` passed
- `uv run acc run echo-test.generic --emit-conductor-json` passed and stdout was a single JSON object
- `uv run acc run fake-agent.generic --emit-conductor-json` passed
- `uv run acc workflow validate/run ...demo_serial.graph.json` passed
- `uv run acc workflow validate/run ...demo_parallel.graph.json` passed
- Browser journeys A-F passed in the latest Playwright report

The baseline is functionally green, but the audit found several structural defects that violate the quality-audit performance, hermeticity, and maintainability requirements.

## Severity-ranked findings

### High 1: Browser E2E mutates repository state and leaves test capsules behind

- Evidence:
  - [web/scripts/browser-e2e.mjs](/F:/Agent-Capsule-Conductor/web/scripts/browser-e2e.mjs:256) creates a new capsule id with `browser-e2e-${Date.now()}.generic`
  - [web/scripts/browser-e2e.mjs](/F:/Agent-Capsule-Conductor/web/scripts/browser-e2e.mjs:377) writes the final report and kills child processes, but does not delete the created capsule
  - Baseline `acc list` output already includes multiple `browser-e2e-*.generic` capsules in [acc_list.stdout.log](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/acc_list.stdout.log)
- Why this is a real defect:
  - Browser QA is supposed to validate usability, not permanently grow the capsule registry.
  - Re-running browser E2E changes the repository state and pollutes `acc list`, which weakens repeatability and makes audit evidence noisier.
  - This is a testability/usability defect, not a new feature request.
- Root cause:
  - The browser script uses the real scaffold path but has no cleanup phase for the created capsule.
- Smallest safe fix:
  - Track the created E2E capsule id and delete it at the end of the browser run, even on failure.
  - Add a regression check that browser E2E cleanup does not leave `browser-e2e-*` directories behind.
- Current status: Resolved
  - The browser runner now tracks created capsule ids and deletes them in `finally`; see [web/scripts/browser-e2e.mjs](/F:/Agent-Capsule-Conductor/web/scripts/browser-e2e.mjs:258) and [web/scripts/browser-e2e.mjs](/F:/Agent-Capsule-Conductor/web/scripts/browser-e2e.mjs:379).
  - Latest browser regression created a capsule during Journey B and left `0` residual `browser-e2e-*` capsule directories; see [browser_e2e_report.json](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/browser_e2e_report.json) and [acceptance_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/acceptance_assertions.json).

### High 2: Workflow graph validation does not meet the required O(V+E) complexity target

- Evidence:
  - [acc/workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py:274) `topological_levels(...)` recomputes `ready` by scanning all nodes on every layer
  - [acc/workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py:299) `graph_ancestors(...)` iterates all control edges for every ordered node
- Why this is a real defect:
  - The audit performance budget explicitly requires graph validation, cycle detection, and topological scheduling to be O(V+E).
  - Current logic is effectively O(V^2 + V*E)` in the common path that powers validation, control plane inspection, and browser workflow operations.
  - The current repo is green on small demo graphs, but the algorithmic shape is already wrong for larger graphs.
- Root cause:
  - The implementation recomputes derived graph structure repeatedly instead of carrying forward adjacency and indegree data.
- Smallest safe fix:
  - Precompute adjacency lists once.
  - Rewrite level construction and ancestor propagation to use queue-based Kahn traversal plus incremental set propagation.
  - Add a lightweight regression/perf test around synthetic graphs to guard the intended complexity class.
- Current status: Resolved
  - The hot-path graph helpers now precompute control-graph structures once and build levels incrementally; see [acc/workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py:236), [acc/workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py:253), and [acc/workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py:274).
  - Ancestor checks now use propagated bitmasks instead of repeatedly scanning all edges for every node; see [acc/workflow_graph.py](/F:/Agent-Capsule-Conductor/acc/workflow_graph.py:292).
  - Regression coverage was added for larger synthetic graphs in [tests/unit/test_workflow_graph_schema.py](/F:/Agent-Capsule-Conductor/tests/unit/test_workflow_graph_schema.py:185), and benchmark evidence is recorded in [performance_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/performance_report.json).

### High 3: Event replay loads entire JSONL logs into memory instead of streaming

- Evidence:
  - [acc/events.py](/F:/Agent-Capsule-Conductor/acc/events.py:70) `read_jsonl_events(...)` returns a list
  - [acc/events.py](/F:/Agent-Capsule-Conductor/acc/events.py:74) reads the full file with `read_text(...).splitlines()`
  - [acc/debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py:51) `replay_workflow_events(...)` calls `read_jsonl_events(...)` for workflow and node logs, then builds a full in-memory timeline
- Why this is a real defect:
  - The quality goal explicitly requires event replay to be streaming or bounded-memory.
  - Current behavior scales with total event-log bytes, not with the amount of replay data the caller actually needs.
  - The implementation also duplicates memory by first loading all events into Python lists and then building a second timeline list.
- Root cause:
  - The event reader was written for small files and was never hardened for the debugger/control-plane paths that now depend on it.
- Smallest safe fix:
  - Replace the eager `read_text().splitlines()` helper with a streaming iterator.
  - Keep replay behavior the same for callers, but make the parsing path line-by-line and bounded where possible.
  - Add a regression test that exercises replay on a larger synthetic event log without requiring a real browser or external tools.
- Current status: Resolved
  - The JSONL reader now iterates line-by-line instead of calling `Path.read_text`; see [acc/events.py](/F:/Agent-Capsule-Conductor/acc/events.py:71).
  - Regression coverage verifies that `read_text` is no longer used in this path; see [tests/unit/test_events.py](/F:/Agent-Capsule-Conductor/tests/unit/test_events.py:8).
  - The parser path now handles `10000` events without bulk `read_text` loading; see [performance_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/performance_report.json).

### Medium 1: Artifact directory diff reads every file fully and hex-encodes it

- Evidence:
  - [acc/debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py:828) `directory_fingerprint(...)`
  - [acc/debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py:834) uses `child.read_bytes().hex()` for every artifact file
- Why this matters:
  - This creates roughly a 2x expansion of file bytes just for fingerprint strings, before diff bookkeeping.
  - It is not on the hottest path today, but it violates the same bounded-memory principle the audit asks for on artifact-related inspection paths.
- Root cause:
  - The diff code fingerprints by full content string rather than by bounded digest.
- Smallest safe fix:
  - Replace full-byte hex fingerprints with a streaming hash digest.
  - Preserve diff semantics while removing byte-for-byte memory amplification.
- Current status: Resolved
  - Directory diff now fingerprints files with streaming SHA-256 digests; see [acc/debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py:828) and [acc/debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py:839).
  - Regression coverage verifies the directory path no longer depends on `Path.read_bytes`; see [tests/unit/test_debugger.py](/F:/Agent-Capsule-Conductor/tests/unit/test_debugger.py:79).

### Medium 2: Capsule registry repeatedly rescans and reparses the full capsule tree on hot paths

- Evidence:
  - [acc/registry.py](/F:/Agent-Capsule-Conductor/acc/registry.py:57) `discover(...)` reparses every `*/capsule.yaml`
  - [acc/registry.py](/F:/Agent-Capsule-Conductor/acc/registry.py:74) `get(...)` calls `discover(...)` again
  - The CLI, control plane, and server repeatedly construct fresh registries, for example [acc/control_plane.py](/F:/Agent-Capsule-Conductor/acc/control_plane.py:40) and [acc/server/routes/capsules.py](/F:/Agent-Capsule-Conductor/acc/server/routes/capsules.py:66)
- Why this matters:
  - The performance budget explicitly says to avoid repeated full scans in hot paths.
  - This is currently masked by the small repo size, but browser/control-plane operations pay the full scan cost over and over.
- Root cause:
  - `CapsuleRegistry` is stateless and does not cache a single discovery pass even within one request or command.
- Smallest safe fix:
  - Add an instance-local discovery cache and invalidate only when explicitly needed.
  - Keep behavior deterministic and avoid introducing a global cache.
- Current status: Resolved
  - `CapsuleRegistry` now caches one discovery pass per instance and serves `get(...)` from the cached map; see [acc/registry.py](/F:/Agent-Capsule-Conductor/acc/registry.py:48) and [acc/registry.py](/F:/Agent-Capsule-Conductor/acc/registry.py:77).
  - Regression coverage was added in [tests/unit/test_registry.py](/F:/Agent-Capsule-Conductor/tests/unit/test_registry.py:87).

## Findings summary by severity

- Critical: 0 identified in the baseline audit
- High: 3, all resolved in the current hardening pass
- Medium: 2, all resolved in the current hardening pass
- Low: 0 recorded yet

Next action:

1. Fix High 1, High 2, and High 3 first.
2. Add regression coverage for each high-severity fix.
3. Re-run baseline and browser evidence after fixes.
