# Implementation Tasks

Source spec: `docs/codex_goal_ideal_layering/*.md` and `docs/human/ACC_IDEAL_LAYERING_PLAIN_LANGUAGE.md`.

Task count: 7

## Task List

### Task 1: [x] Baseline Audit And Reports
- Files: `docs/codex_goal_ideal_layering/FINDINGS.md`, `DECISIONS.md`, `MIGRATION_NOTES.md`, `RISK_REGISTER.md`, `QUALITY_REPORT.md`
- Scope: Record current behavior, architecture debt, risks, initial decisions, and acceptance gaps before code refactoring.
- Acceptance: Baseline pytest/ruff evidence and current ideal-layering command failures are documented.

### Task 2: [x] Domain And Ports
- Files: `acc/domain.py`, `acc/ports/`
- Scope: Expand pure domain objects and protocol boundaries for workflow templates, permissions, runtime result, store, event sink, runner, clock, id generation, and path resolution.
- Acceptance: Domain objects remain IO/process/UI-free; protocols depend only on domain and standard typing.

### Task 3: [x] Pure Engine
- Files: `acc/engine/`, `tests/architecture/test_import_boundaries.py`, engine/domain tests
- Scope: Move graph normalization, validation, topological level computation, failure policy, and retry planning into pure engine code.
- Acceptance: Engine imports no store/runtime/cli and performs no filesystem writes, subprocess calls, env reads, or printing.

### Task 4: [x] Filesystem Store
- Files: `acc/store/`, store tests
- Scope: Move run directory creation, environment manifests, events, node output, artifact bundles, inbox/outbox materialization, retry cleanup, and path traversal defense into store.
- Acceptance: Store contract evidence exists in run dirs; path traversal and retry cleanup tests pass.

### Task 5: [x] Runtime Contracts
- Files: `acc/runtime/`, runtime/security tests
- Scope: Implement fake/tool/agent runner boundary, `ExecutionContext`, permission enforcement, env whitelist, timeout handling, workspace write lock checks, and no full host env inheritance.
- Acceptance: Security negative tests pass without real external agents.

### Task 6: [x] App Service And CLI Migration
- Files: `acc/app/`, `acc/clean_workflow.py`, `acc/cli.py`, workflow examples, CLI tests
- Scope: Orchestrate engine/store/runtime through app services, shrink clean_workflow to compatibility facade, and keep CLI stdout JSON clean.
- Acceptance: Ideal serial/parallel `.accflow.json` validation and run commands pass; old `acc run --emit-conductor-json` contract still passes.

### Task 7: [x] Final Acceptance And Quality Report
- Files: docs reports and tests
- Scope: Run all commands in `ACCEPTANCE.md`, record dependency-boundary, unit, CLI, security, performance, pytest, and ruff evidence.
- Acceptance: `QUALITY_REPORT.md` explains moved/deleted/kept/renamed responsibilities, test results, remaining risks, and next step recommendation.
