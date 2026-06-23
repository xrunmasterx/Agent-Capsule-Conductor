# Invocation and Adapter Harness Plan

> **For workflow agents:** This plan unifies callable invocation and adapter subprocess plumbing after NodeExecutionResult ownership is clear.

## Current audit status (2026-06-22)

Status: **mostly complete for fixed-workflow invocation; broader cleanup open**. `NodeExecutionEnvelope`, `CallableInvocationPort`, fixed-workflow dispatch through the port, invocation-port tests, and one-shot `AdapterProcessHarness` are implemented. The plan remains open for legacy `CallableInvocationService`, supervisor procedural seams, direct adapter-selection edges, and fuller envelope/harness responsibilities.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Create one callable execution boundary and remove duplicated adapter lifecycle code, without forcing all protocols into a premature god adapter.

## Architecture

Target:

```text
NodeExecutionEnvelope
  -> CallableInvocationPort.invoke(...)
       -> agent class
       -> tool class
       -> child workflow
       -> hermetic fake
       -> adapter protocol
  -> NodeExecutionResult
```

Adapter lifecycle target:

```text
AdapterProcessHarness
  -> start process
  -> timeout/cancel
  -> stdout/stderr capture
  -> output file validation
  -> failure shaping
  -> event hooks
```

Protocol-specific parsing remains in individual adapters.

## Must Read

- `AGENTS.md`
- `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md`
- `docs/superpower_acc_architecture/MIGRATION_PLAN.md`
- `acc/app/runtime/executor.py`
- `acc/callable_runner.py`
- `acc/app/invocation.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/adapters/generic_cli.py`
- `acc/adapters/codex_cli.py`
- `acc/adapters/codex_app_server.py`
- `tests/unit/test_generic_cli_adapter.py`
- `tests/unit/test_codex_app_server_adapter.py`

## Constraints

- Do not start until `NodeExecutionResult` shape is at least drafted.
- Do not force streaming app-server into first one-shot process harness unless explicitly chosen.
- Preserve adapter protocol behavior.
- Do not expose raw ACC topology to adapters as a permanent contract.

## Tasks

### Task 1 — Define NodeExecutionEnvelope

Envelope should include:

- callable ref;
- resolved input refs / payload handle;
- execution policy;
- workspace capability;
- environment policy;
- evidence handles;
- result sinks;
- cancellation context.

It should not include full workflow topology or control-mode internals.

### Task 2 — Introduce CallableInvocationPort

Start as a concrete service, not a framework.

It should route:

- hermetic fake;
- agent class;
- tool class;
- child workflow function;
- external adapter protocol.

### Task 3 — Migrate fixed workflow node execution

Change executor to call `CallableInvocationPort` instead of branching across runner/agent-session/nested-workflow logic directly.

### Task 4 — Migrate supervisor/handoff later

Do not migrate supervisor/handoff until control-mode plan is ready. Their goal is to call the same port through the common scheduler.

### Task 5 — Extract AdapterProcessHarness for one-shot adapters

Start with common lifecycle between:

- generic CLI;
- Codex CLI if still active;
- any similar one-shot adapter.

Do not force Codex app-server streaming lifecycle unless the first harness proves useful.

### Task 6 — Retire dead/partial invocation seams

After all runtime callers use the new port, delete or reduce:

- `acc/app/invocation.py`;
- duplicated callable runner paths;
- hermetic dispatch duplication;
- direct adapter selection scattered outside invocation boundary.

## Validation

```bash
uv run pytest -q tests/unit/test_generic_cli_adapter.py tests/unit/test_codex_app_server_adapter.py
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_handoff_p0.py
uv run pytest -q tests/unit/test_callable_normalization.py
```

Acceptance checks:

- adding a new one-shot CLI adapter requires protocol code only;
- fixed workflow and supervisor eventually use same invocation port;
- adapters receive explicit capability envelope, not raw workflow internals;
- no duplicate timeout/cancel/log/output plumbing in converged one-shot adapters.

## Deletion Targets

- `acc/app/invocation.py` after no consumers remain.
- duplicated subprocess lifecycle in one-shot adapters.
- duplicated hermetic fake dispatch and fake ref ownership.
- direct callable dispatch seams outside `CallableInvocationPort`.

## Completion Criteria

- One invocation boundary exists for callable execution.
- Protocol-specific code remains protocol-specific.
- Adapter lifecycle duplication is reduced without creating a new god adapter.
