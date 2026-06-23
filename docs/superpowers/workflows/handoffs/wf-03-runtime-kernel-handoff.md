# wf-03 Runtime Kernel Handoff

## Files inspected

- `AGENTS.md`
- `docs/superpowers/plans/2026-06-21-lightweight-runtime-kernel.md`
- `docs/architecture/02-runtime-kernel.md`
- `docs/implementation/2026-06-21-runtime-services-and-ports.md`
- `acc/app/__init__.py`
- `acc/app/workflow_submission.py`
- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/app/runtime/workflow_io.py`
- `acc/runtime/node_payload.py`
- `acc/result_store/filesystem.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_core_v2_workflow_run.py`
- `tests/integration/test_core_v2_workflow_bindings.py`
- `tests/integration/test_core_v2_workflow_artifacts.py`
- `tests/integration/test_supervisor_planstep_p0.py`
- `tests/integration/test_handoff_p0.py`
- `tests/test_runtime_imports.py`
- `tests/unit/test_run_lifecycle.py`

## Code paths changed

- Added explicit runtime context seams:
  - `acc/app/runtime/context.py`
    - `ProjectContext`
    - `ExecutionContext`
    - `build_execution_context(...)`
- Added immutable runtime result seams:
  - `acc/app/runtime/results.py`
    - `NodeExecutionResult`
    - `WorkflowExecutionResult`
- Added concrete filesystem ownership seams:
  - `acc/app/runtime/repository.py`
    - `RunRepository`
    - `NodeExecutionRecorder`
- Threaded `ExecutionContext` through fixed workflow execution:
  - `acc/app/__init__.py`
  - `acc/app/runtime/orchestrator.py`
  - `acc/app/runtime/scheduler.py`
  - `acc/app/runtime/executor.py`
  - `acc/app/runtime/nested_workflow.py`
- Moved fixed-workflow output aggregation out of worker node tasks:
  - `acc/app/runtime/executor.py` now returns `NodeExecutionResult` and no longer mutates a workflow-wide shared output dict.
  - `acc/app/runtime/scheduler.py` now launches `asyncio.Task[NodeExecutionResult]`, merges node outputs in the scheduler loop, and returns `WorkflowExecutionResult`.
  - `acc/app/runtime/orchestrator.py` writes workflow outputs from the scheduler aggregate result.
- Updated the compatibility resume path:
  - `acc/app/runtime/dispatch_gate.py` now consumes `NodeExecutionResult` from `execute_core_v2_node_with_fixed_ledger(...)` and updates its reconstructed compatibility output map locally.
- Preserved run-lifecycle/status compatibility while making ruff-clean import/export shape:
  - `acc/app/run_lifecycle.py`
- Formatting/ruff cleanup touched existing wf-01/wf-02-adjacent files while keeping behavior equivalent:
  - `acc/app/workflow_submission.py`
  - `acc/engine/workflow_validation.py`
  - `acc/runtime/node_payload.py`
  - `tests/integration/test_handoff_p0.py`
  - `tests/integration/test_supervisor_planstep_p0.py`
  - `tests/server/test_workflows_storage_contract.py`
  - `tests/unit/test_run_lifecycle.py`

## Compatibility paths left in place

- `acc/app/core_v2_runtime.py` remains the backward-compatible shim.
- `acc/app/runtime/dispatch_gate.py` remains active for human-gate/supervisor/handoff resume compatibility until wf-05.
- `acc/app/invocation.py` remains active; retirement belongs to wf-04/wf-05.
- `acc/adapters/codex_app_server.py` is untouched as a streaming adapter path.
- Legacy no-context project-root fallbacks remain explicit and bounded:
  - `acc/app/runtime/context.py` falls back to `Path.cwd()` only when no project root, registry project root, canonical run dir, or workflow path is supplied.
  - `acc/app/runtime/executor.py::resolve_node_workflow_binding(...)` falls back to `Path.cwd()` only for no-context/no-registry callers.
  - `acc/app/runtime/nested_workflow.py` retains `Path.cwd()` / `infer_project_root(...)` fallback only for no-context callers.
- `dispatch_gate.py` still reconstructs output maps for resumed dynamic paths; this is intentionally left for wf-05.

## Deletion targets now safe / still blocked

Now safe in the fixed-workflow path:

- Worker node execution no longer mutates `outputs[(node.id, port_id)]` in `executor.py`.
- `orchestrator.py` no longer creates and shares a mutable workflow output dict with concurrent node tasks.
- Context-aware fixed workflow paths no longer need canonical run-dir project-root inference.

Still blocked:

- Deleting `acc/app/core_v2_runtime.py` is still blocked by compatibility/import tests and existing external import contract.
- Deleting `acc/app/runtime/dispatch_gate.py` is blocked until wf-05 converges human gate, supervisor, and handoff onto common scheduler continuation.
- Removing all `Path.cwd()` fallbacks is blocked by legacy no-context callers.
- Moving callable routing behind `CallableInvocationPort` is blocked until wf-04.
- Extracting one-shot adapter process harness is blocked until wf-04.

## Tests added or updated

- `tests/integration/test_core_v2_control_ledger_runtime.py`
  - Extended max-concurrency proof to assert independent high-concurrency outputs are present in workflow outputs and result store.
- `tests/integration/test_core_v2_workflow_run.py`
  - Added `test_execution_context_keeps_two_project_roots_independent`, proving two project roots can run in one process and nested workflow resolution follows `ExecutionContext` rather than ambient cwd.
- Existing supervisor/handoff/run-lifecycle tests were kept green after ruff cleanup and result-boundary changes.

## Commands run and results

Baseline:

```powershell
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py tests/integration/test_supervisor_planstep_p0.py tests/integration/test_handoff_p0.py tests/test_runtime_imports.py tests/test_run_status.py tests/unit/test_run_lifecycle.py tests/unit/test_core_v2_loader.py tests/architecture/test_phase1_import_boundaries.py
# 154 passed in 47.73s
```

During implementation:

```powershell
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_core_v2_workflow_bindings.py
# 17 passed in 13.40s

uv run pytest -q tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py
# 51 passed in 46.37s

uv run pytest -q tests/integration/test_supervisor_planstep_p0.py tests/integration/test_handoff_p0.py tests/test_runtime_imports.py tests/test_run_status.py tests/unit/test_run_lifecycle.py tests/unit/test_core_v2_loader.py tests/architecture/test_phase1_import_boundaries.py
# 104 passed in 6.60s
```

Final verification:

```powershell
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py tests/integration/test_supervisor_planstep_p0.py tests/integration/test_handoff_p0.py tests/test_runtime_imports.py tests/test_run_status.py tests/unit/test_run_lifecycle.py tests/unit/test_core_v2_loader.py tests/architecture/test_phase1_import_boundaries.py
# 155 passed in 49.33s

uv run ruff check .
# All checks passed!
```

Static proof checks:

```powershell
rg "outputs\[\(|Path\.cwd\(|_project_root_for_canonical_run_dir|asyncio\.Task\[str\]|Task\[str\]" acc/app/runtime/*.py
```

Relevant findings:

- `executor.py` no longer mutates `outputs[(node.id, port_id)]`.
- `orchestrator.py` no longer creates/shared a workflow-wide output dict.
- `scheduler.py` owns aggregate output merge.
- Remaining `outputs[...]` in `dispatch_gate.py` are compatibility resume reconstruction for wf-05.
- Remaining `Path.cwd()` fallbacks are bounded no-context compatibility branches.

## Unresolved product decisions

- Whether to keep direct `run_core_v2_workflow_path(...)` no-context compatibility permanently or deprecate it after route/CLI callers all pass `ExecutionContext`.
- Whether `RunRepository` should later own result-store writes directly, or leave `ResultStore` as a separate wf-04/wf-06-adjacent port.
- Whether run-summary/index full rebuild behavior should be addressed before wf-06 or left entirely for wf-06 storage/projection work.

## Recommended next workflow

Proceed to **wf-04-invocation-harness**.

Recommended first wf-04 slice:

1. Introduce `NodeExecutionEnvelope` using the now-stable `ExecutionContext` + `NodeExecutionResult` shape.
2. Add a concrete `CallableInvocationPort` as a hot-path service used by `executor.py`.
3. Move existing callable routing behind the port without changing adapter protocols or evidence formats.
4. Only after that, extract one-shot `AdapterProcessHarness` for `generic_cli` and `codex_cli`; keep streaming `codex_app_server` out of the first harness extraction.
