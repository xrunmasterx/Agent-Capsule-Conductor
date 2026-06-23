# Status and Submission Canonicalization Plan

> **For workflow agents:** This plan centralizes run status and workflow submission before route-level duplication is deleted.

## Current audit status (2026-06-22)

Status: **partially complete; duplicate-status guard implemented**. Canonical run-summary status lives in `acc/run_status.py`, async workflow/runner submission has been extracted through `acc/app/workflow_submission.py`, and `tests/architecture/test_import_boundaries.py` now guards against new duplicate run-summary status-set definitions. Remaining work includes sync route/helper cleanup, broader parity/failure/terminal response coverage, and a decision on cloud sync submission scope.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Create one canonical run-status taxonomy and one workflow submission entrypoint, so route handlers become thin adapters and status semantics stop drifting.

## Architecture

Target shape:

```text
HTTP / CLI / Workbench transport
  -> WorkflowSubmissionService
       -> claim run
       -> prepare canonical runtime bundle
       -> submit / run
       -> create receipt
  -> projection response
```

Status target:

```text
acc.run_status
  -> terminal / active / waiting / resuming / cancelled / failed / timeout helpers
  -> explicit translation from plan-step, adapter, provider, and agent-turn statuses
```

## Must Read

- `AGENTS.md`
- `docs/superpower_acc_architecture/SPEC.md`
- `docs/superpower_acc_architecture/SECOND_PASS_CLEANUP_AUDIT.md`
- `acc/app/run_lifecycle.py`
- `acc/cloud_sync.py`
- `acc/storage_gc.py`
- `acc/server/routes/runs.py`
- `acc/server/routes/workflows.py`
- `acc/server/routes/runner.py`

## Constraints

- Preserve existing route response semantics until route parity tests prove differences.
- Do not delete runner/workflow routes in this plan.
- Do not mix status canonicalization with dataflow or adapter refactor.
- If `cloud_sync.py` is out of product scope, do not delete it here; mark as extension/archive decision.

## Tasks

### Task 1 — Build status inventory

List every local status set and status literal family:

- run lifecycle status;
- plan-step status;
- dispatch status;
- interaction status;
- adapter status;
- provider event status;
- agent-turn status;
- storage GC/cloud sync terminal states.

### Task 2 — Create canonical run-status module

Create a focused module, e.g.:

```text
acc/run_status.py
```

It should expose:

- `TERMINAL_RUN_STATUSES`;
- `ACTIVE_RUN_STATUSES`;
- `WAITING_RUN_STATUSES`;
- `RESUMING_RUN_STATUSES`;
- `is_terminal_run_status(status)`;
- `is_active_run_status(status)`;
- `is_waiting_run_status(status)`;
- explicit handling for `timeout`, `crashed`, `failed`, `cancelled`, `success`.

### Task 3 — Replace local status sets incrementally

Migrate one caller at a time:

- `acc/app/run_lifecycle.py`;
- `acc/server/routes/runs.py`;
- `acc/cloud_sync.py`;
- `acc/storage_gc.py`;
- route/projection tests.

### Task 4 — Add duplicate status test

Add architecture/static test that fails if route/storage/sync modules define new local terminal/active/waiting sets.

Status: **implemented** in `tests/architecture/test_import_boundaries.py`. The guard keeps `acc/run_status.py` canonical, allows the temporary `acc/app/run_lifecycle.py` compatibility re-export, and fails new local run-summary status-set definitions elsewhere.

### Task 5 — Extract WorkflowSubmissionService

Create a small app-layer use case that owns:

- run claiming;
- runtime graph preparation;
- callable registry/context construction;
- queue or manager submission;
- receipt creation;
- route-neutral result DTO.

Keep it small. Do not turn it into a general runtime kernel.

### Task 6 — Migrate transports to submission service

Migrate:

- workflow async submit;
- runner submit;
- any remaining sync compatibility route if it must stay.

Preserve route DTOs initially.

## Validation

```bash
uv run pytest -q tests/server/test_runner_api.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/test_state_machine.py
```

Add parity tests for:

- successful submit;
- claim failure;
- validation failure;
- manager submission failure;
- cancellation;
- timeout / terminal state response.

## Deletion Targets

Delete after migration:

- duplicated terminal/active/waiting/resuming sets in server/storage/sync modules;
- route-level graph preparation helpers duplicated across workflow/runner routes;
- route-level run claiming and receipt creation duplicated across endpoints.

## Completion Criteria

- One run-status taxonomy is imported by runtime/server/storage/sync paths.
- Submission routes use the same app-layer service.
- Route handlers are closer to request -> service -> response.
- Tests prove response parity or intentionally documented response changes.
