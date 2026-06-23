# wf-01b Submission Parity and Service Extraction Handoff

## Files inspected

- `docs/superpowers/plans/2026-06-21-status-and-submission-canonicalization.md`
- `acc/run_status.py`
- `tests/test_run_status.py`
- `acc/server/routes/workflows.py`
- `acc/server/routes/runner.py`
- `acc/server/routes/runs.py`
- `acc/server/run_manager.py`
- `acc/server/context.py`
- `acc/runner.py`
- `acc/storage.py`
- `acc/app/__init__.py`
- `acc/app/workbench_adapter.py`
- `acc/app/workflow_refs.py`
- `tests/server/test_runner_api.py`
- `tests/server/test_workflows_storage_contract.py`
- `tests/server/test_runs_projection_api.py`
- `tests/architecture/test_import_boundaries.py`

## Code paths changed

- Added `acc/app/workflow_submission.py` as the route-neutral submission use case.
  - Owns async `/api/workflows/run-graph/submit` orchestration through `WorkflowSubmissionService.submit_workflow_graph()`.
  - Owns `/api/runner/jobs` orchestration through `WorkflowSubmissionService.submit_runner_job()`.
  - Preserves pre-evidence validation, run claiming, runtime graph materialization, `WorkbenchRunJob` submission, runner job receipt writing, and best-effort workbench task run indexing.
  - Uses `SubmissionError` / `RunnerSubmissionRejected` for route-level HTTP mapping without importing FastAPI.
- Thinned `acc/server/routes/workflows.py::submit_run_graph_endpoint()` to request DTO -> `WorkflowSubmissionService` -> HTTP exception mapping.
- Thinned `acc/server/routes/runner.py::submit_runner_job()` to request DTO -> `WorkflowSubmissionService` -> HTTP exception mapping.
- Removed runner route ownership of direct workflow route helper calls, direct run claiming, direct `WorkbenchRunJob` construction, and direct rejected receipt construction.

## Compatibility paths left in place

- Sync workflow routes remain route-owned for now:
  - `POST /api/workflows/run-graph`
  - `POST /api/workflows/{workflow_id}/run`
- `acc/server/routes/workflows.py` still contains existing runtime graph helper functions for compatibility with sync routes and other route-level callers.
- `WorkflowSubmissionService` still depends on the current `WorkbenchRunManager` / `WorkbenchRunJob` seam; it does not inspect manager private queue/active internals.
- Cloud sync submission behavior was intentionally not migrated in wf-01b.
- Existing response DTOs were preserved:
  - `/api/workflows/run-graph/submit` still returns the manager submit payload including `run_id`, `task_id`, `status`, and `run_dir`.
  - `/api/runner/jobs` still returns projected runner job receipts without `run_dir` or absolute project paths.

## Deletion targets now safe / still blocked

Now safer:

- Route-level async submission orchestration in `runner.py` and `workflows.py` can continue shrinking around `WorkflowSubmissionService`.
- Runner submit no longer needs route-level direct calls to `workflow_routes.preflight_runtime_graph()`, `workflow_routes.prepare_runtime_graph()`, `claim_run()`, or `WorkbenchRunJob`.

Still blocked:

- Deleting `workflows.py` runtime graph helper functions is blocked by sync route compatibility and any remaining direct callers.
- Deleting route-local run id / claim helpers is blocked by sync workflow routes.
- Moving the manager seam out of `acc.server.run_manager` is deferred to wf-03 runtime-kernel / repository work.
- Cloud sync migration remains out of scope until product scope is clarified.

## Tests added or updated

- `tests/architecture/test_import_boundaries.py`
  - Added `test_app_workflow_submission_is_route_neutral()` to prevent `acc/app/workflow_submission.py` from importing `fastapi` or `acc.server.routes.*`.
- `tests/server/test_runner_api.py`
  - Strengthened `/api/runner/jobs` success receipt parity: schema version, workflow id, task id, status, rejection, stream URL, no `run_dir`, no absolute project path, and persisted `/api/runner/jobs/{job_id}` parity.
- `tests/server/test_workflows_storage_contract.py`
  - Strengthened `/api/workflows/run-graph/submit` parity around `task_id`, active submit status, and existing `run_dir` payload behavior.

## Commands run and results

- `uv run pytest -q tests/server/test_runner_api.py tests/server/test_workflows_storage_contract.py tests/architecture/test_import_boundaries.py`
  - Result: failed from `docs/` working directory because paths were repo-root-relative (`file or directory not found`).
- `uv run --project .. pytest -q ../tests/server/test_runner_api.py ../tests/server/test_workflows_storage_contract.py ../tests/architecture/test_import_boundaries.py`
  - Result: passed, `29 passed` before parity test strengthening.
- `uv run --project .. pytest -q ../tests/server/test_runner_api.py ../tests/server/test_workflows_storage_contract.py ../tests/architecture/test_import_boundaries.py`
  - Result: passed, `30 passed` after parity test strengthening.
- `uv run --project .. pytest -q ../tests/test_run_status.py; if ($?) { uv run --project .. pytest -q ../tests/server/test_runner_api.py ../tests/server/test_runs_projection_api.py ../tests/server/test_workbench_canvas_snapshots_api.py }; if ($?) { uv run --project .. pytest -q ../tests/integration/test_core_v2_control_ledger_runtime.py }`
  - Result: passed, `4 passed`, `36 passed`, `11 passed`.
- `uv run --project .. pytest -q ../tests/test_run_status.py; if ($?) { uv run --project .. pytest -q ../tests/server/test_runner_api.py ../tests/server/test_runs_projection_api.py ../tests/server/test_workbench_canvas_snapshots_api.py }; if ($?) { uv run --project .. pytest -q ../tests/integration/test_core_v2_control_ledger_runtime.py }; if ($?) { uv run --project .. pytest -q ../tests/architecture/test_import_boundaries.py ../tests/server/test_workflows_storage_contract.py }`
  - Result: passed, `4 passed`, `36 passed`, `11 passed`, `15 passed`.

## Unresolved product decisions

- Whether cloud sync submission should use `WorkflowSubmissionService` or remain a separate product/archive path is still unresolved.
- Whether `acc.app.workflow_submission` depending on `acc.server.run_manager` is acceptable long-term or should be replaced by a runtime-kernel submission port in wf-03.
- Whether the remaining sync workflow routes should be migrated to `WorkflowSubmissionService` or retired after async submit becomes canonical.

## Recommended next workflow

Proceed to `wf-02-explicit-dataflow` only after reviewing this extraction boundary. The next cleanup inside wf-01 would be to migrate or retire remaining sync route helper ownership, but the six-phase plan points next to explicit dataflow/evidence once wf-01 submission parity is accepted.
