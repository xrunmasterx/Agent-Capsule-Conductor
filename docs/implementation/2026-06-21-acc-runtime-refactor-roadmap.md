# ACC Runtime Refactor Roadmap

生成日期: 2026-06-21

本 roadmap 是 `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md` 的 implementation companion。架构权威仍是 `docs/architecture/*`。

## Goal

把当前 ACC runtime 从文件协议散落、控制模式分裂、投影性能放大的状态，迁移为：

```text
ExecutionContext
  -> WorkflowSubmissionService
  -> Orchestrator composition
  -> Scheduler
  -> Binder
  -> CallableInvocationPort
  -> Repository/Recorder/Event/Projection ports
```

## Stage 1 — Proof and Contracts

- Add architecture proof obligation tests.
- Add stateless metadata validation.
- Add explicit dataflow negative tests.
- Add canonical status taxonomy tests.

## Stage 2 — Context and Repository Ports

- Introduce `ExecutionContext`.
- Introduce `RunRepository`.
- Introduce `NodeExecutionRecorder`.
- Move manifest writes in small behavior-preserving steps.

## Stage 3 — Binder and Dataflow

- Split pure binding from runtime materialization.
- Binding manifest covers all payload keys.
- Deprecate implicit control-main.
- Convert examples/fixtures to explicit bindings.

## Stage 4 — Scheduler and Results

- Define `NodeExecutionResult`.
- Executor returns immutable result.
- Scheduler aggregates result refs and outputs.
- Add high-concurrency regression tests.

## Stage 5 — Invocation Port

- Create one `CallableInvocationPort`.
- Route agent/tool/workflow/hermetic execution through it.
- Extract shared adapter process harness.

## Stage 6 — Control Mode Convergence

- Add `ControlModeStrategy` protocol.
- Adapt fixed workflow.
- Replace human gate resume path.
- Convert supervisor/handoff to decision/plan/input strategy only.

## Stage 7 — Server and Workbench Boundaries

- Create `WorkflowSubmissionService`.
- Thin workflow/runner routes.
- Add projection schemas.
- Migrate Workbench standard views.

## Stage 8 — Projection Performance

- Incremental storage index.
- Incremental run index.
- Event stream topology/offset cache.
- Nested event tail projection.
- ResultStore metadata-first listing.

## Stage 9 — Compatibility Deletion

- Delete shim/fallback/duplicate paths after tests prove no active dependency.
- Update `docs/problem/RESOLUTION_MATRIX.md`.
- Run full quality gate.

## Recommended Focused Checks

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_handoff_p0.py
uv run pytest -q tests/server/test_runner_api.py tests/server/test_runs_projection_api.py
uv run ruff check .
```

Full final gate:

```bash
uv run python scripts/quality_gate.py
```
