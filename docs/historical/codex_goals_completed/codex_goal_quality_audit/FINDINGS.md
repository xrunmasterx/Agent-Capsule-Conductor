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

## 2026-05-29 Architecture Feasibility Audit Addendum

Status: completed for the user-requested architecture feasibility validation pass.

Audit scope:

- Capsule Template -> Session execution compatibility.
- WorkflowFunctionTemplate -> FunctionInvocation -> ScopeFrame runtime evidence.
- Nested workflow call input/output binding semantics.
- Store-owned inbox/outbox materialization.
- GraphOps proposal/dry-run/human approval boundary.
- CLI stdout JSON contracts.

### Finding A1: Nested workflow call contracts need child signature validation

Severity: High

Status: Resolved

Evidence to validate:

- Existing tests prove a correct explicit nested workflow binding works.
- The current architecture also needs a negative case: a parent workflow node may declare a `workflow_call_input_binding` to a child input port that the child workflow does not expose.
- If this is not rejected before child execution, the child workflow can silently run without the intended function argument, which violates the callable model.

Root cause hypothesis:

- Parent workflow validation currently sees only the parent graph.
- The child workflow template is resolved later in the app layer, and that is the first point where the parent call site can be checked against the child function signature.

First-principles violation:

- A workflow call is a function call. Function arguments and return ports must match the callee signature before execution.

Smallest safe fix:

- Add a pure contract check after resolving the child workflow template and before invoking it.
- Keep legacy fallback behavior for workflow nodes without explicit call bindings.
- Add a hermetic regression test that fails on a missing child input port.

Implemented fix:

- Added `validate_workflow_call_contract(...)` in `acc.engine` so the child workflow signature is checked as soon as the app resolves the child template.
- `execute_app_clean_node(...)` now validates explicit workflow-call input/output bindings before invoking the nested workflow.
- The compatibility fallback remains: workflow nodes without explicit call bindings can still use legacy behavior.

Regression coverage:

- `tests/unit/test_callable_engine_validation.py` now rejects bindings to missing child input and output ports.
- `tests/integration/test_nested_workflow_function_call.py` now covers the previously silent case where the child input was optional and the parent binding pointed to a nonexistent child port.
- `tests/integration/test_architecture_feasibility.py` adds a hermetic architecture journey covering capsule session execution, workflow validation/run, callable manifests, nested workflow return lineage, inspect, GraphOps dry-run, GraphOps human-approval rejection, and stdout JSON contracts.

Verification:

```text
uv run pytest -q tests/unit/test_callable_engine_validation.py tests/integration/test_nested_workflow_function_call.py tests/integration/test_architecture_feasibility.py tests/integration/test_callable_inspect.py
  PASSED, 16 passed.

uv run pytest -q
  PASSED, 314 passed.

uv run ruff check .
  PASSED.

cd web && npm run test -- --run
  PASSED, 46 passed.

cd web && npm run build
  PASSED, with the existing Vite chunk-size warning.
```

### Finding A2: Browser E2E drifted from the current Workbench UX and produced false failures

Severity: Medium

Status: Resolved

Evidence:

- `npm run test:e2e` initially failed because the browser script still looked for older Workbench labels and controls such as `工作流`, `节点库`, `图谱画布`, `搜索节点`, and `加载 Demo 并行`.
- The current Workbench UX uses `任务`, `资源`, the resource drawer, `加载示例`, and the task canvas as the primary flow.
- The browser report also recorded transient `/api/runs/<run_id>/events` 404s while live polling began before the run directory existed.

Root cause:

- The UI behavior changed in the visual Workbench refactor, but the long-running browser E2E script still encoded pre-refactor selectors and assumptions.
- Event polling treated "run exists but events not yet materialized" and "run id is invalid" as the same 404 state.

First-principles violation:

- Browser E2E should validate the product path users actually operate. A stale test journey is not evidence.
- Live event polling is a stream-style read; an empty stream is a valid initial state for a newly submitted UI run.

Implemented fix:

- Updated the browser journey to use the current `任务`/`资源` UX, `加载示例`, current run ids, and flexible debugger messages based on the selected node.
- Changed the canvas accessible name to Chinese `任务画布`.
- Adjusted Workbench unit tests to assert the Chinese canvas label.
- Updated `/api/runs/{run_id}/events` so pending UI-created run ids return an empty event stream instead of a 404, while non-UI missing runs still return 404.

Verification:

```text
npm run test:e2e
  PASSED.
  Report: runs/browser_e2e/2026-05-29T01-54-23-312Z/browser_e2e_report.json
  Journeys A-F passed.
  console_errors: []
  network_errors: []

uv run pytest -q tests/server/test_runs_api.py tests/integration/test_architecture_feasibility.py
  PASSED, 14 passed.

cd web && npm run test -- --run
  PASSED, 46 passed.
```
