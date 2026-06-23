# P0 Freeze and Prove Cleanup Plan

> **For workflow agents:** Follow this plan before deleting old architecture. This is a proof-first milestone, not a deletion sprint.

## Current audit status (2026-06-22)

Status: **partially complete; static proof gates improved**. Later workflow slices added meaningful proof coverage for status, dataflow, runtime, invocation, and control-mode work. The 2026-06-22 follow-up added static checks that block production imports of `core_v2_runtime`, detect duplicate run-summary status-set definitions outside the canonical module/allowed re-export, and keep route-boundary deviations executable and visible. The plan remains open because route-owned orchestration is still a known deviation and broader cleanup/deletion targets are intentionally deferred.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Make the target lightweight architecture observable through tests and static checks before removing compatibility paths. Freeze the invariants that later refactors must preserve.

## Architecture

This plan establishes proof gates for:

```text
stateless definitions
explicit dataflow
single status taxonomy
thin route boundaries
no canonical core_v2_runtime shim imports
no supervisor/handoff direct agent invocation
```

## Must Read

- `AGENTS.md`
- `docs/superpower_acc_architecture/SPEC.md`
- `docs/superpower_acc_architecture/FINDINGS.md`
- `docs/superpower_acc_architecture/SECOND_PASS_CLEANUP_AUDIT.md`
- `docs/superpower_acc_architecture/LIGHTWEIGHT_REFACTOR_PLAN_PACK.md`
- `docs/architecture/08-architecture-proof-obligations.md`
- `acc/runtime/node_payload.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/app/run_lifecycle.py`

## Global Constraints

- Do not delete `dispatch_gate.py` in this plan.
- Do not delete control-main compatibility in this plan.
- Do not create broad new services in this plan.
- Add tests/static checks first; behavior-changing deletion comes later.
- If a proof currently fails because code has a known deviation, mark it explicitly and link the follow-up plan.

## Tasks

### Task 1 — Record active deviations

Update or verify docs list these deviations:

- hidden control-edge-to-data propagation;
- `dispatch_gate.py` static_input/snapshot reconstruction;
- duplicate run status sets;
- duplicate submission surfaces;
- `core_v2_runtime` compatibility imports;
- route-owned orchestration;
- raw runtime UI/projection dependencies.

### Task 2 — Add import boundary proof

Add/extend tests so new code cannot import `acc.app.core_v2_runtime` as canonical runtime path.

Acceptance:

- Existing imports are either migrated or explicitly listed as temporary deviations.
- New imports fail architecture tests.

Status: **implemented** in `tests/architecture/test_import_boundaries.py` by scanning production `acc/**/*.py` imports and allowing only the shim module itself.

Suggested validation:

```bash
uv run pytest -q tests/architecture/test_import_boundaries.py tests/test_runtime_imports.py
```

### Task 3 — Add explicit dataflow proof tests

Add tests showing:

- a control-only predecessor does not supply payload once compatibility is disabled or when strict mode is enabled;
- binding manifest accounts for payload keys;
- supervisor/handoff cannot inject undeclared static_input after replacement exists.

If strict mode does not exist yet, add xfail or deviation-marked tests with precise file references.

### Task 4 — Add duplicate status detection

Add an architecture/static test that detects local `TERMINAL_RUN_STATUSES` / `ACTIVE_RUN_STATUSES` / waiting/resuming sets outside the canonical module once created.

For this P0, record every existing duplicate and target module.

Status: **implemented** in `tests/architecture/test_import_boundaries.py`. The guard allows `acc/run_status.py` as canonical and `acc/app/run_lifecycle.py` as a temporary re-export compatibility module, while failing new local run-summary status-set definitions elsewhere.

### Task 5 — Add route boundary proof sketch

Add or document a test/checklist that route modules must not own:

- graph compilation;
- run claiming;
- registry construction;
- manager submission;
- complex JSONL/event merge loops.

Status: **deviation guard implemented** in `tests/architecture/test_import_boundaries.py`. Current `acc/server/routes/workflows.py` route-owned orchestration markers are recorded as known deviations; if they change, the proof gate requires updating this plan/status before claiming route cleanup complete. A strict ban remains deferred until route parity cleanup lands.

## Validation

Run focused checks:

```bash
uv run pytest -q tests/unit/test_callable_schema.py tests/unit/test_callable_domain.py
uv run pytest -q tests/architecture/test_import_boundaries.py tests/test_runtime_imports.py
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_handoff_p0.py
uv run pytest -q tests/server/test_runner_api.py tests/server/test_runs_projection_api.py
```

If available:

```bash
uv run python scripts/quality_gate.py
```

## Deletion Targets

Do not delete yet unless preconditions are already proven:

- `acc/app/core_v2_runtime.py` — delete only after imports/tests/docs no longer protect the shim.
- `acc/runtime/node_payload.py` control-main compatibility — delete in explicit dataflow plan.
- `acc/app/runtime/dispatch_gate.py` — delete in control-mode convergence plan.
- duplicated submission/status helpers — delete after canonical status/submission services exist.

## Completion Criteria

- Proof obligations are represented by tests, static checks, or documented xfail deviations.
- Later plans can reference these proof gates.
- No behavior-changing cleanup was done without a proof gate.
