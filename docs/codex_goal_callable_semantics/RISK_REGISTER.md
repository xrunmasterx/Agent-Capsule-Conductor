# Callable Semantics Risk Register

## R1: Breaking existing CLI JSON contracts

Severity: Critical

Risk:

New manifests or logs could pollute stdout.

Mitigation:

- Keep stdout contract tests.
- Add acceptance command for `acc run --emit-conductor-json`.
- Add acceptance command for `acc workflow run --emit-json`.

## R2: Over-renaming public concepts too early

Severity: High

Risk:

Changing user-facing commands or formats before compatibility exists could break existing workflows.

Mitigation:

- Normalize old fields internally.
- Keep existing commands.
- Document migration.

## R3: App layer becomes a second monolith

Severity: High

Risk:

Moving semantic logic into app without splitting can recreate old coupling.

Mitigation:

- Split workflow service, execution loop, node invocation, workflow call, legacy compatibility.
- Add architecture tests where practical.

## R4: Nested workflow data leak

Severity: High

Risk:

Child workflow may access parent data not explicitly passed.

Mitigation:

- Engine validation for explicit input bindings.
- Store-controlled materialization.
- Negative tests.

## R5: Stateful environment pollution

Severity: High

Risk:

Stateful nested workflows can mutate user workspaces unexpectedly.

Mitigation:

- Reject stateful-in-stateful by default.
- Require explicit allow policy.
- Preserve write locks and permission profiles.

## R6: Performance regression in graph validation

Severity: Medium

Risk:

Callable and nested validation could become quadratic on large DAGs.

Mitigation:

- Keep large DAG sanity test.
- Reuse existing topological analysis.
- Avoid filesystem IO in engine.

## R7: Schema churn without runtime behavior

Severity: Medium

Risk:

Adding schemas but not wiring execution would produce documentation-only architecture.

Mitigation:

- Acceptance requires run-time manifests and nested workflow behavior.

## R8: Baseline capsule fixture drift blocks final acceptance

Severity: Resolved

Risk:

The current baseline test suite expects `stock-market-info-curation.codex`, but the repository contains `stock-market-info-cleaner.codex`. This unrelated mismatch makes `uv run pytest -q` fail before callable runtime code changes.

Mitigation:

- Fixed `tests/unit/test_registry.py` to validate the actual `stock-market-info-cleaner.codex` capsule.
- Verified with `uv run pytest -q tests/unit/test_registry.py::test_stock_market_demo_capsules_use_least_privilege_permissions`.
- Verified full baseline with `uv run pytest -q`, 284 passed.

## R9: Existing web/UI edits are unrelated dirty worktree state

Severity: Medium

Risk:

Unrelated edits in `web/src/*` could be accidentally reverted, reformatted, or mixed into callable runtime commits.

Mitigation:

- Avoid touching web files unless a callable milestone explicitly requires it.
- Use focused diffs and path-scoped status checks.
- Mention the unrelated dirty state in progress reports.
