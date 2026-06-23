# ACC Superpower Architecture IMPLEMENTATION_ORDER

生成日期: 2026-06-21

## Philosophy

不要一次性大爆炸重构。每一阶段只修一个架构维度：先证明，再端口化，再收敛控制模式，再删除兼容债。每阶段必须可验证、可回滚、行为差异可解释。

## Milestone 0 — Documentation and Authority Stabilization

Deliver:

- 生成/更新 `docs/superpower_acc_architecture/*`。
- 补齐 `docs/architecture/03-control-modes.md` 到 `08-architecture-proof-obligations.md`。
- 更新 `docs/README.md`，确保 active docs 引用存在。

Validation:

```bash
uv run pytest -q tests/test_runtime_imports.py
```

Manual check:

- `AGENTS.md` / `README.md` / `docs/CURRENT_ARCHITECTURE.md` 中 active architecture refs 全部存在。

## Milestone 1 — Freeze Invariants with Tests

Deliver:

- stateless definition validation tests；
- forbidden metadata/runtime key tests；
- explicit dataflow negative tests；
- single run status taxonomy tests；
- import boundary/static checks skeleton。

Suggested tests:

```bash
uv run pytest -q tests/unit/test_callable_schema.py tests/unit/test_callable_domain.py
uv run pytest -q tests/architecture/test_import_boundaries.py
```

Acceptance:

- runtime/session/workspace/provider/conversation keys in template metadata fail validation or are documented known deviations with failing proof-obligation tests.

## Milestone 2 — Typed Metadata and Status Taxonomy

Deliver:

- Split open metadata into typed structures:
  - descriptive metadata；
  - runtime policy；
  - adapter policy；
  - artifact contract；
  - control policy；
  - migration-only legacy fields。
- Create canonical run-status module.
- Separate adapter/provider/agent-turn/run/interaction/supervisor status domains.

Validation:

```bash
uv run pytest -q tests/unit/test_control_ledger_domain.py tests/test_state_machine.py
uv run pytest -q tests/server/test_runs_projection_api.py
```

Acceptance:

- No duplicate local `TERMINAL_RUN_STATUSES` sets remain outside the canonical module.
- `timeout` terminal semantics are consistent.

## Milestone 3 — Make Dataflow Explicit

Deliver:

- Split `acc/runtime/node_payload.py` into pure binder + runtime evidence adapter.
- Add explicit binding manifests for all inputs.
- Mark implicit control-main forwarding deprecated and emit warnings.
- Add supervisor/handoff explicit snapshot input object.

Validation:

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_handoff_p0.py
```

Acceptance:

- A downstream node without data edge/input binding/result ref does not receive predecessor output.
- Binding manifest explains every key in node payload.

## Milestone 4 — Introduce Runtime Ports Beside Existing Code

Deliver:

- `ExecutionContext` / `ProjectContext`.
- `RunRepository` interface and filesystem implementation.
- `NodeExecutionRecorder`.
- `ControlLedgerPort`.
- `ResultStorePort`.
- `EventSink`.
- `ProjectionInvalidator`.

Rules:

- Add beside existing functions first; do not immediately delete hot path.
- Preserve fixed workflow behavior.

Validation:

```bash
uv run pytest -q tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py
```

Acceptance:

- Orchestrator can delegate manifest writes through repository/recorder in tests.

## Milestone 5 — Scheduler-Owned Result Aggregation

Deliver:

- Introduce immutable `NodeExecutionResult`.
- Change node execution task to return result rather than mutate shared `outputs` dict.
- Scheduler aggregates outputs and updates result store/projections.

Validation:

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
```

New test:

- high-concurrency workflow with independent nodes proves no shared output mutation path.

Acceptance:

- `execute_core_v2_node` no longer mutates workflow-wide output dict directly.

## Milestone 6 — Unify Callable Invocation

Deliver:

- `CallableInvocationPort.invoke(envelope) -> NodeExecutionResult`.
- Route agent/tool/workflow/hermetic execution through one port.
- Move prompt/schema/permission/adapter selection into one service.
- Keep protocol-specific adapters thin.

Validation:

```bash
uv run pytest -q tests/unit/test_codex_app_server_adapter.py tests/unit/test_callable_normalization.py
```

Acceptance:

- Supervisor and fixed workflow callables use the same invocation port.
- Adding an adapter does not duplicate subprocess lifecycle.

## Milestone 7 — Shared AdapterProcessHarness

Deliver:

- Extract subprocess lifecycle, timeout, cancellation, stdout/stderr, output presence into shared harness.
- Keep `generic_cli`、`codex_cli`、`codex_app_server` protocol-specific.

Validation:

```bash
uv run pytest -q tests/unit/test_codex_app_server_adapter.py
```

Acceptance:

- common timeout/cancel/log behavior is tested once and reused.

## Milestone 8 — Converge Resume and Human Gate

Deliver:

- Replace `dispatch_gate` ad hoc rehydrate/replay for human gate with repository-loaded scheduler resume.
- Lifecycle transition rules become pure functions; persistence goes through repository/ledger port.

Validation:

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/server/test_runner_api.py
```

Acceptance:

- human gate approval resumes through same scheduler driver as initial execution.

## Milestone 9 — Converge Supervisor and Handoff

Deliver:

- `ControlModeStrategy` protocol.
- Fixed strategy adapter first.
- Supervisor strategy outputs PlanSteps/DecisionRecords/explicit inputs only.
- Handoff strategy outputs typed handoff decisions/explicit context refs.
- Delete direct procedural agent invocation in supervisor/handoff paths.

Validation:

```bash
uv run pytest -q tests/integration/test_handoff_p0.py
```

Acceptance:

- Tests fail if supervisor/handoff create node dirs or invoke agents outside common executor/port.

## Milestone 10 — Thin Server Transport

Deliver:

- `WorkflowSubmissionService` used by workflow and runner routes.
- Remove route-level graph compilation, CallableRegistry construction, manager wiring, run claiming duplication.

Validation:

```bash
uv run pytest -q tests/server/test_runner_api.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py
```

Acceptance:

- Routes are request/response wrappers around app services.

## Milestone 11 — Projection-First Workbench

Deliver:

- Define `NodeInspectorProjection` and related projection types.
- Migrate Workbench standard views to projection endpoints.
- Raw runtime manifests moved behind debug/evidence disclosure.
- Live events expose projection vocabulary.

Validation:

```bash
cd web
npm run test -- --run
npm run build
```

Acceptance:

- UI components do not parse `runtime.json` / `binding_manifest.json` directly for standard views.

## Milestone 12 — Projection Performance

Deliver:

- Incremental storage index upsert/delete.
- Incremental run index updates.
- Event stream topology/offset cache.
- Nested event tail index/fan-in.
- ResultStore metadata-first projection.

Validation:

- Add micro-benchmark or regression tests around:
  - storage refresh for one run；
  - run SSE idle tick；
  - nested event tail query；
  - result projection list nodes。

Acceptance:

- ordinary run summary write does not trigger full repo storage rebuild.
- run stream idle loop does not scan entire run tree per 500ms per client.

## Milestone 13 — Delete Compatibility Debt

Delete after callers/tests migrated:

- `acc/app/core_v2_runtime.py` shim；
- legacy graph/YAML UI hydration fallback；
- `graph.edges` fallback in active Workbench open/run path；
- callable YAML schema aliases from active loader；
- duplicated submission surfaces；
- duplicate status sets；
- implicit control-main dataflow；
- dispatch_gate mini-orchestrator；
- route-level runtime graph assembly。

Validation:

```bash
uv run python scripts/quality_gate.py
```

Acceptance:

- Full quality gate passes.
- `docs/problem/RESOLUTION_MATRIX.md` marks affected findings fixed/stale/deferred with evidence.
