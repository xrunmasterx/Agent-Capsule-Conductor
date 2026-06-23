# wf-01-status-submission handoff

## Status

wf-01 is finalized for this pass. The run-status canonicalization scope is implemented and verified. The `WorkflowSubmissionService` extraction was intentionally deferred behind parity-test and deletion gates so route DTOs, runner receipts, and evidence ordering remain unchanged.

## Completed work

- Added the pure canonical run-status module at `E:/ACC_new/acc/run_status.py`.
- Canonicalized the run-summary status taxonomy without renaming persisted status strings:
  - terminal: `success`, `failed`, `cancelled`, `crashed`, `timeout`
  - waiting: `waiting_interaction`, `waiting_handoff`, `waiting_timer`
  - resuming: `resuming`
  - active: `queued`, `running`, `cancel_requested`, all waiting statuses, and resuming
  - restart-interrupted: `queued`, `running`, `cancel_requested`, `resuming`
- Migrated safe run-status consumers to canonical constants and predicates:
  - `E:/ACC_new/acc/app/run_lifecycle.py` imports and re-exports canonical constants and predicates so existing runtime imports remain stable.
  - `E:/ACC_new/acc/server/run_manager.py` uses canonical predicates while remaining the queue/lifecycle boundary.
  - `E:/ACC_new/acc/server/routes/runs.py` uses canonical terminal classification for SSE terminal summaries while preserving route DTO semantics.
  - `E:/ACC_new/acc/server/routes/runner.py` uses canonical terminal classification for cancellation fallback while preserving runner-specific response and receipt behavior.
  - `E:/ACC_new/acc/cloud_sync.py` uses the canonical run terminal predicate only when interpreting a run-summary status during cancellation acknowledgement.
  - `E:/ACC_new/acc/storage_gc.py` uses canonical active/terminal run status constants while keeping GraphOps proposal statuses local.
- Added focused canonical status tests at `E:/ACC_new/tests/test_run_status.py`.
- Updated lifecycle status tests at `E:/ACC_new/tests/unit/test_run_lifecycle.py` so `timeout` is terminal and `waiting_handoff`/`waiting_timer` are active waiting states.
- Preserved route contracts and unrelated runtime/dataflow/control/projection cleanup scope.

## Changed files in wf-01 scope

- `E:/ACC_new/acc/run_status.py`
- `E:/ACC_new/acc/app/run_lifecycle.py`
- `E:/ACC_new/acc/cloud_sync.py`
- `E:/ACC_new/acc/server/routes/runs.py`
- `E:/ACC_new/acc/server/routes/runner.py`
- `E:/ACC_new/acc/server/run_manager.py`
- `E:/ACC_new/acc/storage_gc.py`
- `E:/ACC_new/tests/test_run_status.py`
- `E:/ACC_new/tests/unit/test_run_lifecycle.py`
- `E:/ACC_new/docs/superpowers/workflows/handoffs/wf-01-status-submission-handoff.md`

## Validation

Implementation validation:

- `python -m pytest E:/ACC_new/tests/test_run_status.py E:/ACC_new/tests/unit/test_run_lifecycle.py` was attempted but was not runnable because the system Python environment does not have `pytest` installed.
- `uv run pytest -q E:/ACC_new/tests/test_run_status.py E:/ACC_new/tests/unit/test_run_lifecycle.py` passed: 7 passed.
- `uv run pytest -q E:/ACC_new/tests/server/test_runs_projection_api.py E:/ACC_new/tests/server/test_runner_api.py` passed: 29 passed.
- `uv run pytest -q E:/ACC_new/tests/test_run_status.py E:/ACC_new/tests/unit/test_run_lifecycle.py E:/ACC_new/tests/server/test_runs_projection_api.py E:/ACC_new/tests/server/test_runner_api.py` passed: 36 passed.

Verification validation:

- `uv run pytest -q "E:/ACC_new/tests/test_state_machine.py" "E:/ACC_new/tests/server/test_runner_api.py" "E:/ACC_new/tests/server/test_runs_projection_api.py" "E:/ACC_new/tests/server/test_workbench_canvas_snapshots_api.py" "E:/ACC_new/tests/integration/test_core_v2_control_ledger_runtime.py" "E:/ACC_new/tests/test_run_status.py" "E:/ACC_new/tests/unit/test_run_lifecycle.py"` passed: 120 passed in 21.83s.
- Architecture consistency check passed for the wf-01 scoped files.
- No fixes were needed during verification.

## Architecture notes

- `E:/ACC_new/acc/run_status.py` is the run-summary status source of truth.
- `E:/ACC_new/acc/app/run_lifecycle.py` remains a compatibility re-export layer for existing runtime imports such as `E:/ACC_new/acc/app/runtime/dispatch_gate.py` and `E:/ACC_new/acc/app/runtime/orchestrator.py`.
- Status families remain intentionally separated:
  - run-summary statuses are canonicalized in `E:/ACC_new/acc/run_status.py`;
  - cloud job/lease/receipt statuses remain owned by their cloud modules;
  - GraphOps proposal statuses remain local to their owning modules.
- `E:/ACC_new/acc/cloud_sync.py` only applies the run terminal predicate to a run-summary status during cancellation acknowledgement.
- `E:/ACC_new/acc/server/routes/runner.py` still owns runner receipt and Workbench task-index side effects.
- `E:/ACC_new/acc/server/run_manager.py` remains the queue/lifecycle boundary.

## Blocked or deferred items

No implementation or verification blockers remain for the canonical run-status portion of wf-01.

Deferred intentionally:

- `WorkflowSubmissionService` extraction.
- Parity tests for `POST /api/workflows/run-graph/submit` and `POST /api/runner/jobs`.
- Migration of remaining legacy imports from `E:/ACC_new/acc/app/run_lifecycle.py` predicates directly to `E:/ACC_new/acc/run_status.py`, if the project later wants to remove compatibility re-exports.

The submission extraction was deferred because status canonicalization already changed cross-layer classification for `timeout`, `waiting_handoff`, and `waiting_timer`. Combining that taxonomy migration with submission orchestration extraction would mix route DTO and evidence-ordering risk into the same pass.

The current submission paths also have intentionally different public contracts:

- `POST /api/workflows/run-graph/submit` returns the `WorkbenchRunManager.submit` payload, including `run_dir`.
- `POST /api/runner/jobs` hides `run_dir`, writes runner job receipts, handles runner capability rejection receipts, and performs a best-effort Workbench task index side effect.

## Deletion gates

Do not delete or consolidate submission helpers until all of these gates are satisfied:

1. Add parity tests covering the existing public response shapes and side effects for:
   - `E:/ACC_new/acc/server/routes/workflows.py` `POST /api/workflows/run-graph/submit`
   - `E:/ACC_new/acc/server/routes/runner.py` `POST /api/runner/jobs`
2. Prove the tests preserve evidence ordering and existing rejection/receipt behavior.
3. Extract only a neutral app-layer async graph submission sequence that does not import FastAPI and does not own scheduler/executor internals.
4. Keep `E:/ACC_new/acc/server/run_manager.py` as the queue/lifecycle boundary.
5. Keep route-specific DTO wrapping and runner receipt/task-index side effects in the route or in a runner-specific wrapper.
6. Keep sync workflow routes out of the first extraction unless a separate sync use-case API is introduced.
7. Keep cloud job/lease/receipt statuses and GraphOps proposal statuses out of the run-summary status helper cleanup.
8. Delete only after consumer search proves old helpers are unused and focused route parity tests remain green.

Do not remove `E:/ACC_new/acc/app/run_lifecycle.py` compatibility re-exports until existing runtime imports are migrated and searched clean.

## Recommended next workflow

Proceed to `wf-02-explicit-dataflow` next.

Rationale:

- wf-01 run-status canonicalization is verified and stable.
- Submission extraction is safely deferred behind explicit parity and deletion gates.
- The next planned workflow, `wf-02-explicit-dataflow`, can focus on binding manifest contracts and strict dataflow migration without depending on the deferred submission-service extraction.

Expected wf-02 focus from the workflow suite:

- Inventory implicit payload paths.
- Define the binding manifest schema.
- Add negative proof tests.
- Split logical binding from runtime materialization.
- Migrate checked-in workflows and fixtures.
- Delete control-main compatibility only after strict manifest coverage passes.

Recommended wf-02 validation targets:

- `uv run pytest -q E:/ACC_new/tests/integration/test_core_v2_workflow_bindings.py`
- `uv run pytest -q E:/ACC_new/tests/integration/test_core_v2_control_ledger_runtime.py`
- `uv run pytest -q E:/ACC_new/tests/integration/test_handoff_p0.py`
