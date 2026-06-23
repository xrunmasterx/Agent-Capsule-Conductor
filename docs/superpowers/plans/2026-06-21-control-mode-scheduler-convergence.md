# Control Mode Scheduler Convergence Plan

> **For workflow agents:** This plan converges human gate, supervisor, and handoff onto one scheduler continuation path. Delete `dispatch_gate.py` only at the end.

## Current audit status (2026-06-22)

Status: **mostly complete; compatibility/docs cleanup open**. A common persisted continuation path handles human-gate, supervisor, and handoff dispatch through Core v2 node execution, with strong integration and architecture proof coverage. The plan remains open because `dispatch_gate.py` still exists as a compatibility shim, some broader architecture docs still describe the old live dispatch-gate role, procedural supervisor execution seams remain, and continuation is not literally the initial scheduler driver.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Make fixed workflow, human gate, supervisor, and handoff control modes over one scheduler/invocation substrate.

## Architecture

Target:

```text
ControlModeStrategy
  -> validate / authorize / declare inputs / emit decisions
  -> persisted PlanStep / DecisionRecord / input refs
  -> common scheduler continuation
  -> CallableInvocationPort
```

Control modes authorize and materialize intent/evidence. They do not invoke agents directly.

## Must Read

- `AGENTS.md`
- `docs/architecture/03-control-modes.md`
- `docs/architecture/02-runtime-kernel.md`
- `docs/superpower_acc_architecture/SPEC.md`
- `acc/app/runtime/dispatch_gate.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/run_lifecycle.py`
- `acc/app/human_gate_service.py`
- `acc/app/supervisor.py`
- `acc/engine/handoff.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_handoff_p0.py`

## Constraints

- `dispatch_gate.py` is currently a compatibility shim delegating to the common persisted continuation path in `acc/app/runtime/continuation.py`; do not delete it until callers/docs and remaining supervisor seams are resolved.
- Human-gate resume comes first because it is the smallest convergence path.
- Supervisor planning can stay; bespoke execution must go.
- Handoff unsupported semantics may remain explicit rejection until shared resume exists.
- Do not create a large control-mode framework before one scheduler continuation path is working.

## Tasks

### Task 1 — Map current continuation paths

Document current paths for:

- initial fixed workflow execution;
- human gate approval resume;
- supervisor ready-step dispatch;
- handoff ready-step dispatch.

### Task 2 — Add scheduler continuation entrypoint

Create a scheduler entrypoint that can continue from persisted run state:

- load run plan;
- load plan steps;
- load invocation/scope;
- resume ready steps;
- write evidence through common path.

Do this first for human gate approval.

### Task 3 — Convert human gate resume

`answer_interaction` / human gate service should write decision/lifecycle state and enqueue/trigger common scheduler continuation rather than calling `resume_approved_human_gate_dispatch`.

### Task 4 — Introduce tiny ControlModeStrategy only as needed

If a protocol helps remove code, define small methods:

- `ready_steps(...)`;
- `materialize_decisions(...)`;
- `declare_inputs(...)`.

Avoid speculative methods.

### Task 5 — Convert supervisor

Supervisor may keep:

- planning;
- roster/prompt rendering;
- intent parsing;
- plan compilation.

Supervisor must stop before bespoke execution. It should emit:

- `DecisionRecord`;
- `PlanStep`;
- explicit input refs / snapshot refs.

Execution goes through scheduler + `CallableInvocationPort`.

### Task 6 — Convert handoff

Handoff should emit typed control decision plus explicit context/result refs.

Keep `resume_session`, acceptance, human approval, timeout/fallback explicitly unsupported unless product scope says to implement now.

### Task 7 — Delete dispatch_gate.py

Only after no path calls:

- `resume_approved_human_gate_dispatch`;
- `dispatch_ready_supervisor_plan_steps`;
- `dispatch_ready_handoff_plan_steps`.

## Validation

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_handoff_p0.py
uv run pytest -q tests/server/test_runner_api.py tests/server/test_runs_projection_api.py
uv run ruff check .
```

Add negative proof:

- no supervisor/handoff/human-gate path invokes agents directly outside scheduler/executor/`CallableInvocationPort`;
- human-gate approval resumes through same scheduler driver as initial execution.

## Deletion Targets

- `acc/app/runtime/dispatch_gate.py` after common continuation owns all required behavior and compatibility callers/docs are retired.
- direct calls from `human_gate_service.py` to dispatch gate.
- procedural supervisor execution seams.
- handoff static_input/snapshot hidden data paths.

## Completion Criteria

- One scheduler continuation path handles initial execution and resume.
- Control modes only authorize/materialize intent and evidence.
- Agent nodes are still workflow-unaware.
- `dispatch_gate.py` is gone or fully isolated as expired compatibility.
