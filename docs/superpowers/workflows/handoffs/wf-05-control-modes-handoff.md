# wf-05 Control Modes Handoff

Date: 2026-06-22

## Summary

Implemented the wf-05 first convergence step:

- Added a common persisted scheduler continuation entrypoint for resumed/dynamic control-mode execution.
- Converted human-gate approval resume away from direct `dispatch_gate.py` execution.
- Converted supervisor and handoff integration coverage to call the common continuation entrypoint.
- Reduced `dispatch_gate.py` to deprecated forwarding shims only.
- Removed legacy dispatch-gate exports from `acc/app/core_v2_runtime.py`.
- Added architecture proof that production code no longer references legacy dispatch-gate symbols outside the shim file.

## Files inspected

Plan and architecture:

- `docs/superpowers/plans/2026-06-21-control-mode-scheduler-convergence.md`
- `docs/architecture/02-runtime-kernel.md`
- `docs/architecture/03-control-modes.md`
- `docs/superpower_acc_architecture/SPEC.md`
- `docs/superpower_acc_architecture/FINDINGS.md`
- `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md`

Runtime/control mode paths:

- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/app/runtime/continuation.py`
- `acc/app/run_lifecycle.py`
- `acc/app/human_gate_service.py`
- `acc/app/scheduler.py`
- `acc/app/supervisor.py`
- `acc/engine/supervisor.py`
- `acc/app/handoff.py`
- `acc/engine/handoff.py`
- `acc/ledger_writer.py`
- `acc/store/control_ledger.py`

Tests:

- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_supervisor_planstep_p0.py`
- `tests/integration/test_handoff_p0.py`
- `tests/unit/test_wakeup_queue.py`
- `tests/server/test_runner_api.py`
- `tests/server/test_runs_projection_api.py`
- `tests/test_runtime_imports.py`
- `tests/architecture/test_import_boundaries.py`

## Code paths changed

### Common scheduler continuation

Added:

- `acc/app/runtime/continuation.py`
  - `continue_persisted_run(...)`
  - persisted run context loaders for template/invocation/scope/run plan/steps
  - generic ready-step promotion/selection
  - dynamic supervisor/handoff node reconstruction from typed snapshot refs
  - prior success output loading
  - common final run state writing

The continuation path dispatches through:

- `acc/app/runtime/scheduler.py::execute_core_v2_node_with_fixed_ledger(...)`

That means resumed human-gate, supervisor, and handoff execution now use the same fixed-ledger node execution substrate and, via wf-04, the same `CallableInvocationPort` callable boundary.

### Human gate resume

Changed:

- `acc/app/human_gate_service.py`
  - Replaced `_dispatch_approved_gate_if_possible(...)` with `_continue_approved_gate_if_possible(...)`.
  - Human approval still writes decision evidence, enqueues wakeup, and calls `resume_waiting_run(...)`.
  - Approval now triggers `continue_persisted_run(..., reason="human", interaction_id=...)` rather than `resume_approved_human_gate_dispatch(...)`.

Changed:

- `acc/app/scheduler.py`
  - `claim_next_human_wakeup_for_resume(...)` now optionally triggers `continue_persisted_run(..., reason="human_wakeup", ...)` after lifecycle resume when persisted workflow evidence exists.
  - Existing simple/unit wakeup behavior remains compatible for tests without workflow snapshots.

### Supervisor continuation

Changed:

- `tests/integration/test_supervisor_planstep_p0.py`
  - Tests now materialize supervisor plan/evidence and call `continue_persisted_run(..., reason="supervisor")`.
  - Tests no longer import/call `dispatch_ready_supervisor_plan_steps(...)`.

Preserved:

- `acc/app/supervisor.py::materialize_supervisor_plan_steps(...)`
- `acc/engine/supervisor.py::compile_supervisor_plan_to_steps(...)`

Supervisor planning/materialization still writes:

- `DecisionRecord`
- `PlanStep`
- intent snapshots
- `typed_input_refs` with kind `supervisor_intent_snapshot`

### Handoff continuation

Changed:

- `tests/integration/test_handoff_p0.py`
  - Tests now materialize handoff evidence and call `continue_persisted_run(..., reason="handoff")`.
  - Tests no longer import/call `dispatch_ready_handoff_plan_steps(...)`.

Preserved:

- `acc/app/handoff.py::materialize_handoff_plan_step(...)`
- `acc/engine/handoff.py::compile_handoff_to_plan_step(...)`

Handoff materialization still writes:

- payload snapshots
- `DecisionRecord`
- `PlanStep`
- `typed_input_refs` with kind `handoff_payload_snapshot`

Unsupported P0 semantics remain explicit rejection:

- `resume_session`
- acceptance-required handoff
- human-approval-required handoff

### Dispatch gate isolation

Changed:

- `acc/app/runtime/dispatch_gate.py`
  - Reduced to deprecated compatibility shims only.
  - The three legacy functions now forward to `continue_persisted_run(...)`.
  - Independent `_dispatch_steps` execution loop and duplicated persisted-state logic were removed from this file.

Changed:

- `acc/app/core_v2_runtime.py`
  - Removed re-exports of:
    - `resume_approved_human_gate_dispatch`
    - `dispatch_ready_supervisor_plan_steps`
    - `dispatch_ready_handoff_plan_steps`

Changed:

- `tests/test_runtime_imports.py`
  - Removed legacy dispatch-gate symbols from the core-v2 runtime compatibility export contract.
  - Added negative assertion that `acc.app.core_v2_runtime` does not expose those retired symbols.

Changed:

- `tests/architecture/test_import_boundaries.py`
  - Added static proof that production code does not reference legacy dispatch-gate symbols outside `acc/app/runtime/dispatch_gate.py`.

## Compatibility paths left in place

Still intentionally left in place:

- `acc/app/runtime/dispatch_gate.py`
  - Kept as a deprecated shim file for compatibility.
  - It no longer owns execution logic.
  - Final deletion is now safer but still deferred until any external/import compatibility concern is explicitly accepted.

- `acc/app/supervisor.py::SupervisorRouter.invoke_from_intent(...)`
- `acc/app/supervisor.py::execute_supervisor_plan(...)`
  - Still present as legacy procedural supervisor seams.
  - No new tests or migrated runtime paths use them.
  - They remain deletion/deprecation targets.

- `acc/app/invocation.py`
  - Still present from pre-wf-04/wf-05 compatibility.
  - Further retirement depends on supervisor procedural seam cleanup.

## Deletion targets now safe / still blocked

Now safer:

- `acc/app/runtime/dispatch_gate.py` can be deleted after compatibility decision; no production callers outside the shim remain.
- `acc/app/core_v2_runtime.py` no longer re-exports dispatch-gate symbols.
- Tests for supervisor/handoff now prove common continuation rather than legacy wrapper execution.

Still blocked:

- Full deletion of `acc/app/runtime/dispatch_gate.py` is blocked only by conservative compatibility concerns; the static architecture proof now allows only the shim itself to reference legacy symbols.
- Deleting `SupervisorRouter.invoke_from_intent(...)` / `execute_supervisor_plan(...)` is blocked by checking any external imports or non-covered product use.
- Deleting `acc/app/invocation.py` remains blocked until the procedural supervisor seam is removed or converted.
- A richer `ControlModeStrategy` abstraction was intentionally not introduced; the common continuation entrypoint was enough for this phase.

## Tests added or updated

Updated:

- `tests/integration/test_supervisor_planstep_p0.py`
- `tests/integration/test_handoff_p0.py`
- `tests/unit/test_wakeup_queue.py`
- `tests/test_runtime_imports.py`
- `tests/architecture/test_import_boundaries.py`

Added production code:

- `acc/app/runtime/continuation.py`

## Commands run and results

Targeted continuation tests:

```powershell
uv run pytest -q "tests/integration/test_core_v2_control_ledger_runtime.py" "tests/integration/test_supervisor_planstep_p0.py" "tests/integration/test_handoff_p0.py" "tests/unit/test_wakeup_queue.py"
```

Result:

```text
27 passed in 11.17s
```

Continuation/import tests after dispatch-gate re-export removal:

```powershell
uv run pytest -q "tests/test_runtime_imports.py" "tests/integration/test_core_v2_control_ledger_runtime.py" "tests/integration/test_supervisor_planstep_p0.py" "tests/integration/test_handoff_p0.py" "tests/unit/test_wakeup_queue.py"
```

Result:

```text
90 passed in 12.71s
```

Server validation:

```powershell
uv run pytest -q "tests/server/test_runner_api.py" "tests/server/test_runs_projection_api.py"
```

Result:

```text
29 passed in 8.65s
```

Architecture/import proof:

```powershell
uv run pytest -q "tests/architecture/test_import_boundaries.py" "tests/test_runtime_imports.py"
```

Result:

```text
74 passed in 0.52s
```

Full ruff validation:

```powershell
uv run ruff check .
```

Result:

```text
All checks passed!
```

Final combined wf-04/wf-05 validation:

```powershell
uv run pytest -q "tests/unit/test_callable_normalization.py"; if ($?) { uv run pytest -q "tests/unit/test_callable_invocation_port.py" "tests/unit/test_generic_cli_adapter.py" "tests/unit/test_codex_cli_adapter.py" "tests/unit/test_codex_app_server_adapter.py" }; if ($?) { uv run pytest -q "tests/integration/test_core_v2_control_ledger_runtime.py" "tests/integration/test_supervisor_planstep_p0.py" "tests/integration/test_handoff_p0.py" }; if ($?) { uv run pytest -q "tests/server/test_runner_api.py" "tests/server/test_runs_projection_api.py" }; if ($?) { uv run pytest -q "tests/architecture/test_import_boundaries.py" "tests/test_runtime_imports.py" }; if ($?) { uv run ruff check . }
```

Result:

```text
2 passed in 0.18s
39 passed in 51.94s
22 passed in 10.00s
29 passed in 9.11s
74 passed in 0.52s
All checks passed!
```

Static caller check:

```powershell
rg -n "resume_approved_human_gate_dispatch|dispatch_ready_supervisor_plan_steps|dispatch_ready_handoff_plan_steps|_dispatch_approved_gate_if_possible|acc\.app\.runtime\.dispatch_gate|from acc\.app\.runtime import dispatch_gate|import acc\.app\.runtime\.dispatch_gate" "E:\ACC_new" --glob "**/*.py"
```

Remaining expected hits:

- definitions in `acc/app/runtime/dispatch_gate.py`
- negative/static-test string literals in `tests/test_runtime_imports.py`

No production callers outside the compatibility shim remain.

## Unresolved product / architecture decisions

- Whether to delete `acc/app/runtime/dispatch_gate.py` immediately or keep the deprecated shim for one more compatibility window.
- Whether to delete or hard-deprecate `SupervisorRouter.invoke_from_intent(...)` and `execute_supervisor_plan(...)` now that tests use materialization + common continuation.
- Whether to introduce a formal `ControlModeStrategy` protocol later; wf-05 avoided speculative framework because `continue_persisted_run(...)` removed the active duplication.
- Whether wakeup processing should stay synchronous when claimed or move to an async worker queue. Current behavior preserves synchronous dispatch when persisted workflow evidence exists.

## Recommended next workflow

Proceed to `wf-06-workbench-projection-storage`:

- Migrate Workbench standard views to projection endpoints.
- Add live-event cursor/replay/gap semantics.
- Convert storage/index hot paths to incremental upsert/delete.
- Retire legacy GraphOps patch helpers only after proposal API parity is proven.
