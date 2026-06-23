# Lightweight Runtime Kernel Plan

> **For workflow agents:** This plan simplifies the runtime kernel with concrete seams first. Do not create a large abstract framework.

## Current audit status (2026-06-22)

Status: **partially complete**. `ExecutionContext`, `RunRepository`, `NodeExecutionRecorder`, `NodeExecutionResult`, and fixed-workflow scheduler aggregation exist. Remaining work includes fuller context ownership, removal or explicit fencing of ambient `Path.cwd()` fallbacks, reducing continuation/compatibility duplicate ownership, and retiring or further isolating the `core_v2_runtime` shim.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Make runtime ownership explicit while keeping ACC lightweight. Move filesystem evidence and result aggregation behind narrow concrete collaborators only where doing so removes responsibility from hot-path scripts.

## Architecture

Target:

```text
ExecutionContext
  -> Orchestrator composition
       -> Scheduler
       -> Binder
       -> RunRepository
       -> NodeExecutionRecorder
       -> CallableInvocationPort
```

Do not introduce every possible port at once. Add a seam only when there is a caller and a deletion/unification target.

## Must Read

- `AGENTS.md`
- `docs/architecture/02-runtime-kernel.md`
- `docs/architecture/04-data-plane-and-evidence.md`
- `docs/implementation/2026-06-21-runtime-services-and-ports.md`
- `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md`
- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/callable_runner.py`

## Constraints

- No big-bang rewrite.
- Do not introduce abstract ports with no immediate responsibility migration.
- Preserve fixed workflow behavior first.
- Keep local-first filesystem evidence as truth.
- Do not hide broken semantics behind a service wrapper.

## Tasks

### Task 1 — Introduce ExecutionContext / ProjectContext

Carry explicitly:

- project root;
- runs root;
- callable registry;
- workspace policy;
- environment policy;
- projection invalidator or refresh handle;
- request identity when relevant.

Thread it from CLI/server submission into runtime and nested workflow.

### Task 2 — Remove ambient project-root guessing

Replace `Path.cwd()` and canonical-run-dir inference where ExecutionContext is available.

Add a two-project in-process test proving context controls registry/storage/workspace lookup.

### Task 3 — Add concrete RunRepository / NodeExecutionRecorder

Start with concrete filesystem classes. Wrap existing writes for:

- function invocation manifest;
- scope frame manifest;
- run record;
- session manifest;
- binding manifest;
- failure record;
- event append;
- run summary update.

### Task 4 — Introduce NodeExecutionResult

Change node execution to return immutable result:

- status;
- output refs;
- artifact refs;
- binding/evidence handles;
- failure diagnostics;
- timings;
- waiting/cancellation info.

### Task 5 — Move aggregation into scheduler

Scheduler should:

- await node results;
- merge outputs;
- publish result-store refs;
- decide failure/waiting/cancel terminal behavior.

Node tasks must not mutate workflow-wide shared output dict directly.

### Task 6 — Shrink orchestrator/executor only after responsibility moves

After repository/recorder/result aggregation is live, remove duplicate inline writes from orchestrator/executor.

## Validation

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py
uv run pytest -q tests/test_runtime_imports.py tests/unit/test_codex_app_server_adapter.py
uv run ruff check .
```

Add tests for:

- two project roots in one process;
- high-concurrency independent nodes;
- failure aggregation;
- waiting/human gate status;
- cancellation behavior.

## Deletion Targets

After migration:

- shared output dict mutation paths;
- inline evidence writes duplicated between orchestrator/executor/lifecycle;
- ambient cwd fallback branches where context exists;
- `acc/app/core_v2_runtime.py` if import migration is complete.

## Completion Criteria

- Runtime hot path is shorter because ownership moved, not because code was wrapped.
- Scheduler owns result aggregation.
- Evidence writes go through concrete repository/recorder seams.
- Fixed workflow behavior remains equivalent.
