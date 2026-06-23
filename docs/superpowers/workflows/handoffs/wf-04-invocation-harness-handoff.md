# wf-04 Invocation Harness Handoff

Date: 2026-06-22

## Summary

Implemented the wf-04 first convergence step:

- Added a fixed-workflow callable invocation boundary via `NodeExecutionEnvelope` and `CallableInvocationPort`.
- Switched `execute_core_v2_callable(...)` to construct an envelope and invoke the port instead of directly branching across nested workflow / streaming agent / hermetic callable paths.
- Added a shared one-shot `AdapterProcessHarness` for CLI subprocess lifecycle.
- Migrated `generic_cli` and `codex_cli` to the shared one-shot harness while keeping Codex app-server streaming orchestration out of that harness.
- Added direct invocation-port tests and restored the planned `tests/unit/test_callable_normalization.py` validation target.

## Files inspected

Plan and architecture:

- `docs/superpowers/plans/2026-06-21-invocation-and-adapter-harness.md`
- `AGENTS.md`
- `docs/architecture/00-constitution.md`
- `docs/superpower_acc_architecture/SPEC.md`
- `docs/superpower_acc_architecture/FINDINGS.md`
- `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md`

Runtime and invocation paths:

- `acc/app/runtime/executor.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/context.py`
- `acc/app/runtime/results.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/app/agent_sessions.py`
- `acc/app/invocation.py`
- `acc/callable_runner.py`
- `acc/app/callable_refs.py`
- `acc/app/workflow_refs.py`
- `acc/runtime/node_payload.py`
- `acc/runner.py`

Adapters:

- `acc/adapters/base.py`
- `acc/adapters/generic_cli.py`
- `acc/adapters/codex_cli.py`
- `acc/adapters/codex_app_server.py`
- `acc/adapters/streaming.py`

Tests:

- `tests/unit/test_generic_cli_adapter.py`
- `tests/unit/test_codex_cli_adapter.py`
- `tests/unit/test_codex_app_server_adapter.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_handoff_p0.py`
- `tests/test_runtime_imports.py`

## Code paths changed

### Invocation boundary

Added:

- `acc/app/runtime/invocation_port.py`
  - `NodeExecutionEnvelope`
  - `CallableInvocationPort`
  - `project_root_for_agent_sessions(...)`

Changed:

- `acc/app/runtime/executor.py`
  - `execute_core_v2_callable(...)` now builds a `NodeExecutionEnvelope` and dispatches through `CallableInvocationPort.invoke(...)`.
  - Existing output materialization, result-store writes, artifact validation, and failure recording remain in `execute_core_v2_node(...)`.

The new port delegates to current concrete implementations:

- `workflow_function` -> `acc/app/runtime/nested_workflow.py::execute_workflow_function_callable(...)`
- registered streaming `agent_class` runtime (`codex_app_server`, `codex_cli`) -> `AgentTurnService.run_workflow_node_turn(...)`
- registered one-shot/non-streaming `agent_class` runtime -> `CallableClassRunner.run_agent_class(...)`
- hermetic / fake callable fallback -> existing `execute_hermetic_callable(...)`

### NodeExecutionResult status contract

Changed:

- `acc/app/runtime/results.py`
  - Added first-class constructors for:
    - `failed(...)`
    - `cancelled(...)`
    - `timeout(...)`
    - `waiting_handoff(...)`
    - `waiting_timer(...)`
  - Preserved existing `success(...)` and `waiting_interaction(...)` compatibility.

Changed:

- `acc/app/runtime/scheduler.py`
  - Scheduler now only treats `status == "success"` as success.
  - Waiting statuses are handled explicitly.
  - Returned `failed` / `cancelled` / `timeout` statuses are not accidentally marked successful.

### One-shot adapter harness

Added:

- `acc/adapters/process_harness.py`
  - `AdapterProcessHarness`
  - `AdapterProcessSpec`
  - `AdapterProcessOutcome`

Added:

- `acc/adapters/process_utils.py`
  - `capture_stream_bytes(...)`
  - `append_bytes(...)`
  - `terminate_process_tree(...)`

Changed:

- `acc/adapters/generic_cli.py`
  - Uses `AdapterProcessHarness` for subprocess start, stdin, timeout, stdout/stderr capture, and log writes.
  - Keeps `resolve_command(...)`, stdout JSON fallback, event naming, and `AgentRunResult` shaping protocol-specific.

- `acc/adapters/codex_cli.py`
  - Uses `AdapterProcessHarness` for one-shot streaming subprocess lifecycle, cancel marker polling, timeout, stdout/stderr capture, and process termination.
  - Keeps Codex command construction, dangerous sandbox gate, isolated `CODEX_HOME`, timeout salvage, structured stdout extraction, and Codex failure parsing protocol-specific.

- `acc/adapters/codex_app_server.py`
  - Reuses shared process utilities for stream capture and process-tree termination only.
  - Streaming JSON-RPC turn orchestration remains local to the app-server adapter.

### Tests changed/added

Added:

- `tests/unit/test_callable_invocation_port.py`
  - Covers hermetic tool routing.
  - Covers hermetic agent routing.
  - Covers registered generic agent routing to `CallableClassRunner`.
  - Covers registered streaming agent routing to `AgentTurnService`.
  - Covers workflow-function routing to nested workflow executor.
  - Covers unsupported callable failure.

Added:

- `tests/unit/test_callable_normalization.py`
  - Restores the wf-04 planned validation target.
  - Pins metadata-based Codex execution-mode parity between runner preflight and runtime normalization.
  - Documents legacy top-level Codex execution-mode fields as preflight-only compatibility.

Changed:

- `tests/integration/test_core_v2_control_ledger_runtime.py`
  - Retargeted dispatch monkeypatches from `executor.execute_core_v2_callable` to `CallableInvocationPort.invoke`.

Changed:

- `tests/unit/test_codex_cli_adapter.py`
  - Retargeted process-tree termination test to shared `acc.adapters.process_utils.terminate_process_tree`.

## Compatibility paths left in place

Still intentionally left in place for wf-05 / later phases:

- `acc/app/invocation.py`
  - Still exists as a legacy/partial app-layer invocation seam.
  - Not deleted because supervisor/handoff migration is explicitly deferred to the control-mode workflow.

- `acc/app/supervisor.py`
  - Still uses the existing supervisor invocation/resume shape.
  - wf-04 did not migrate supervisor/handoff by plan constraint.

- `acc/app/runtime/dispatch_gate.py`
  - Still active for human gate / supervisor / handoff resume paths.
  - wf-05 should converge or isolate this.

- `acc/callable_runner.py::CallableClassRunner`
  - Still owns prompt/schema/runtime.json/output validation for one-shot/non-streaming agent classes.
  - Now used behind `CallableInvocationPort` for non-streaming registered agents.

- `acc/app/runtime/executor.py::execute_hermetic_callable`
  - Still physically lives in executor, but is invoked behind the port.
  - Safe later deletion/move target after compatibility imports and tests move.

- `acc/app/runtime/executor.py::execute_core_v2_callable`
  - Still exported as a compatibility shim for import contracts, but now delegates to the port.

- `acc/adapters/codex_app_server.py`
  - Streaming lifecycle remains separate from `AdapterProcessHarness` by design.

## Deletion targets now safe / still blocked

Now safer:

- Direct callable branching inside `execute_core_v2_callable(...)` has been removed.
- Duplicate one-shot subprocess lifecycle in `generic_cli` and `codex_cli` has been reduced behind `AdapterProcessHarness`.
- Duplicate Codex process termination / stream capture helpers have a shared home in `acc/adapters/process_utils.py`.

Still blocked:

- `acc/app/invocation.py` deletion remains blocked until supervisor/handoff/common scheduler continuation are migrated in wf-05.
- `acc/app/runtime/dispatch_gate.py` deletion remains blocked until wf-05 proves zero active callers for:
  - `resume_approved_human_gate_dispatch`
  - `dispatch_ready_supervisor_plan_steps`
  - `dispatch_ready_handoff_plan_steps`
- Moving/deleting `execute_hermetic_callable(...)` remains blocked by public import compatibility and legacy tests.
- Fully demoting `CallableClassRunner` remains blocked because it still owns prompt/schema/runtime.json/output-validation behavior for one-shot agent classes.
- Folding Codex app-server into `AdapterProcessHarness` is intentionally blocked; it is a streaming JSON-RPC adapter, not a one-shot CLI lifecycle.

## Tests added or updated

Added:

- `tests/unit/test_callable_invocation_port.py`
- `tests/unit/test_callable_normalization.py`

Updated:

- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/unit/test_codex_cli_adapter.py`

## Commands run and results

```powershell
uv run pytest -q "tests/unit/test_callable_invocation_port.py" "tests/unit/test_generic_cli_adapter.py" "tests/unit/test_codex_cli_adapter.py" "tests/unit/test_codex_app_server_adapter.py"
```

Result:

```text
39 passed in 74.18s
```

```powershell
uv run pytest -q "tests/integration/test_core_v2_control_ledger_runtime.py" "tests/integration/test_handoff_p0.py"
```

Result:

```text
15 passed in 8.29s
```

Final wf-04 validation commands:

```powershell
uv run pytest -q "tests/unit/test_callable_normalization.py"; if ($?) { uv run pytest -q "tests/unit/test_generic_cli_adapter.py" "tests/unit/test_codex_cli_adapter.py" "tests/unit/test_codex_app_server_adapter.py" }; if ($?) { uv run pytest -q "tests/integration/test_core_v2_control_ledger_runtime.py" "tests/integration/test_handoff_p0.py" }
```

Result:

```text
2 passed in 0.17s
33 passed in 52.42s
15 passed in 9.24s
```

Combined targeted confidence run:

```powershell
uv run pytest -q "tests/unit/test_callable_invocation_port.py" "tests/unit/test_callable_normalization.py" "tests/unit/test_generic_cli_adapter.py" "tests/unit/test_codex_cli_adapter.py" "tests/unit/test_codex_app_server_adapter.py" "tests/integration/test_core_v2_control_ledger_runtime.py" "tests/integration/test_handoff_p0.py"
```

Result:

```text
56 passed in 64.86s
```

## Unresolved product / architecture decisions

- Whether `codex_cli` should remain routed as a streaming workflow-node runtime through `AgentTurnService` or return to one-shot `CallableClassRunner` in production is not changed here. Current behavior is preserved by `STREAMING_AGENT_RUNTIMES = {"codex_app_server", "codex_cli"}`.
- `NodeExecutionEnvelope` is intentionally concrete/minimal for fixed workflow now; the fuller envelope fields from the plan (workspace capability, environment policy, evidence handles, result sinks, cancellation context) are represented through existing scope/context/session/node fields rather than a new broad framework.
- Rich `NodeExecutionResult` statuses now exist, but supervisor/handoff/human-gate convergence still needs wf-05 to define persisted continuation semantics.
- `acc/app/invocation.py` retirement is not complete until supervisor/handoff stop directly invoking through the old seam.

## Recommended next workflow

Proceed to `wf-05-control-modes`:

- Converge human gate / supervisor / handoff onto common scheduler continuation.
- Prove no active production calls remain to:
  - `resume_approved_human_gate_dispatch`
  - `dispatch_ready_supervisor_plan_steps`
  - `dispatch_ready_handoff_plan_steps`
- Decide whether `acc/app/invocation.py` can become a thin compatibility shim over `CallableInvocationPort` after supervisor/handoff migration.
