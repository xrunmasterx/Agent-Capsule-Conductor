# Quality Report

Status: Complete. Final acceptance passed.

## Required final contents

The final report must include:

- baseline command results,
- what was added,
- what was deleted,
- what was renamed,
- what was preserved,
- how old Capsule/NodeSpec concepts map to callable semantics,
- exact test commands run,
- acceptance results,
- stdout JSON contract evidence,
- remaining risks.

## Baseline

Commands run before callable runtime code changes:

```text
uv run pytest -q:
  Initially FAILED, 259 passed / 1 failed.
  Root cause:
    tests expected stock-market-info-curation.codex, while capsules/ contains stock-market-info-cleaner.codex.
  Resolution:
    tests/unit/test_registry.py now checks stock-market-info-cleaner.codex.
  Current final result:
    PASSED, 297 passed.

uv run ruff check .:
  PASSED.

uv run pytest -q tests/architecture/test_import_boundaries.py:
  PASSED, 10 passed.
```

## Milestone 2 evidence

Added:

- callable domain types in `acc/domain.py`,
- callable JSON schemas under `schemas/`,
- callable domain/schema unit tests.

Preserved:

- existing `NodeSpec`, `WorkflowTemplate`, `EnvironmentFrame`, and capsule `SessionManifest` compatibility types,
- existing parser, engine, store, runtime, app, CLI, and server behavior.

Deleted:

- nothing.

Renamed:

- nothing. New callable names were added additively.

Validation:

```text
uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py
  PASSED, 14 passed.

uv run ruff check acc/domain.py tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py
  PASSED.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run python -m json.tool schemas/agent_class_template_schema.json
uv run python -m json.tool schemas/tool_class_template_schema.json
uv run python -m json.tool schemas/workflow_function_template_schema.json
uv run python -m json.tool schemas/node_invocation_spec_schema.json
uv run python -m json.tool schemas/function_invocation_schema.json
uv run python -m json.tool schemas/scope_frame_schema.json
uv run python -m json.tool schemas/session_instance_schema.json
  PASSED.
```

Current remaining risks:

- The new types are not wired into parsing/execution yet; Milestone 3 must add legacy normalization.
- Runtime manifests are not emitted yet; Milestones 4 and 5 must add store/runtime evidence.
- The pre-existing stock-market capsule naming mismatch has been fixed.

## Milestone 3 evidence

Added:

- pure legacy normalization helpers in `acc.engine`,
- capsule compatibility mapping in `acc/app/legacy_compat.py`,
- `tests/unit/test_callable_normalization.py`.

Preserved:

- existing `.accflow.json` parser behavior,
- existing `NodeSpec` compatibility fields,
- existing `CapsuleSpec` behavior,
- existing app/runtime execution path.

Deleted:

- nothing.

Renamed:

- nothing. Normalization is additive and opt-in for now.

Legacy mapping implemented:

```text
NodeSpec(kind=agent, runtime=...)       -> CallableRef(kind=agent_class, id=runtime)
NodeSpec(kind=tool, tool=...)           -> CallableRef(kind=tool_class, id=tool)
NodeSpec(kind=workflow, workflow_ref=...) -> CallableRef(kind=workflow_function, id=workflow_ref)
NodeSpec.prompt                         -> CallableOverride.prompt
NodeSpec.permission_profile             -> CallableOverride.permission_profile
NodeSpec ports                          -> NodeInvocationSpec port compatibility fields
CapsuleSpec(kind=agent_session)         -> AgentClassTemplate
CapsuleSpec(kind=agent_workflow)        -> AgentClassTemplate
CapsuleSpec(kind=atomic)                -> ToolClassTemplate
CapsuleSpec(kind=acc_workflow)          -> WorkflowFunctionTemplate compatibility wrapper
CapsuleSpec(kind=external_workflow)     -> legacy tool-class compatibility wrapper
```

Validation:

```text
uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py
  PASSED, 20 passed.

uv run pytest -q tests/unit/test_callable_normalization.py
  PASSED, 6 passed.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run ruff check .
  PASSED.

uv run pytest -q
  After Milestone 3 still failed on the pre-existing stock-market capsule naming mismatch.
```

Current remaining risks:

- Normalization is not yet wired into `acc workflow validate/run` output or manifests.
- Function invocation and scope manifests are still absent.
- Session instance manifests are still absent.
- Nested workflow execution still relies on the existing `upstream_context` compatibility path at runtime.

## Milestone 4 evidence

Added:

- `function_invocation_manifest.json` creation for clean workflow runs,
- `scope_frame_manifest.json` creation for clean workflow runs,
- parent invocation/frame propagation for nested workflow calls,
- invocation/scope references in existing environment manifest,
- `tests/integration/test_function_invocation_manifests.py`.

Preserved:

- `workflow_run_manifest.json`,
- `workflow_summary.json`,
- `workflow_run.json`,
- `environment_manifest.json`,
- existing `acc workflow run --emit-json` result shape with only additive manifest path fields,
- existing nested workflow run directory layout.

Deleted:

- nothing.

Renamed:

- nothing.

Validation:

```text
uv run pytest -q tests/integration/test_function_invocation_manifests.py
  PASSED, 2 passed.

uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_environment_kernel.py
  PASSED, 8 passed.

uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py tests/integration/test_function_invocation_manifests.py tests/architecture/test_import_boundaries.py
  PASSED, 32 passed.

uv run ruff check .
  PASSED.
```

Full baseline after Milestone 5 and fixture correction:

```text
uv run pytest -q
  PASSED, 284 passed.

uv run ruff check .
  PASSED.
```

Current remaining risks:

- Agent/tool node executions still do not emit `session_instance_manifest.json`.
- Workflow node call evidence is still not separated into a dedicated workflow-call manifest.
- Nested workflow output is still returned through the existing summary/output path, not yet explicit exposed-output return bindings.

## Milestone 5 evidence

Added:

- `nodes/<node_id>/session_instance_manifest.json` for clean agent/tool node runs,
- `session_id`, `invocation_id`, `scope_frame_id`, and `session_instance_manifest` references in agent/tool node run manifests,
- `nodes/<workflow_node>/workflow_call_manifest.json` for nested workflow calls,
- `tests/integration/test_session_instance_manifests.py`.

Preserved:

- existing `session_manifest.json` behavior for legacy capsule runs,
- existing clean workflow node outputs, outboxes, artifact bundles, events, and node run manifest fields,
- existing nested workflow result summary path.

Deleted:

- nothing.

Renamed:

- nothing.

Validation:

```text
uv run pytest -q tests/integration/test_session_instance_manifests.py tests/integration/test_function_invocation_manifests.py
  PASSED, 4 passed.

uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py tests/architecture/test_import_boundaries.py
  PASSED, 34 passed.

uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_environment_kernel.py
  PASSED, 8 passed.

uv run ruff check .
  PASSED.
```

Current remaining risks:

- Nested workflow output still needs explicit `workflow_call_input_bindings` / `workflow_call_output_bindings` runtime semantics.
- Engine still needs callable-specific recursion/depth/stateful negative tests.

## Milestone 6 evidence

Added:

- explicit nested workflow function-call input binding runtime path,
- explicit nested workflow output return path from child `workflow_outputs/<port>` to parent workflow-node outbox,
- `FileSystemWorkflowStore.apply_workflow_call_output_bindings()`,
- binding evidence in `workflow_call_manifest.json`,
- callable nested workflow examples,
- `tests/integration/test_nested_workflow_function_call.py`.

Preserved:

- existing `upstream_context` fallback for old nested workflow examples,
- existing nested workflow directory layout,
- existing parent workflow-node `output.json` summary,
- existing downstream inbox materialization through parent workflow-node outbox,
- existing `--emit-json` stdout shape as a single JSON object.

Deleted:

- nothing.

Renamed:

- nothing.

Nested function-call behavior now proven:

```text
producer.main
  -> parent subflow.brief inbox
  -> child exposed input brief
  -> child child_agent.main inbox
  -> child exposed output report
  -> parent subflow.summary outbox
  -> downstream final_merge.summary inbox
```

Validation:

```text
uv run pytest -q tests/integration/test_nested_workflow_function_call.py
  PASSED, 2 passed.

uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_environment_kernel.py tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py tests/integration/test_nested_workflow_function_call.py
  PASSED, 14 passed.

uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py tests/architecture/test_import_boundaries.py
  PASSED, 30 passed.

uv run acc workflow validate examples/workflows/callable_nested_function_demo.accflow.json --json
  PASSED.

uv run acc workflow run examples/workflows/callable_nested_function_demo.accflow.json --run-dir runs/acceptance_callable_nested --emit-json
  PASSED.

uv run ruff check .
  PASSED.
```

Current remaining risks:

- Engine still needs callable-specific recursion, call-depth, stateful nesting, and unbound parent-data validation hardening.
- Inspect/debug output still needs invocation/scope/session/call-stack/lineage visibility.

## Milestone 7 evidence

Added:

- `validate_callable_workflow_function()` in `acc.engine`,
- callable control/data edge validation,
- callable ref validation against optional known refs,
- workflow-call input boundary validation requiring parent inbox/data-edge binding,
- workflow-call output binding validation against declared parent output ports,
- recursion guard,
- max call depth policy,
- stateful-in-stateful rejection by default,
- large-DAG validation sanity test,
- `tests/unit/test_callable_engine_validation.py`.

Preserved:

- existing Clean Core validator behavior,
- existing `validate_clean_workflow_template()` public path,
- engine purity: no filesystem IO, no subprocess, no app/store/runtime imports.

Deleted:

- nothing.

Renamed:

- nothing.

Validation:

```text
uv run pytest -q tests/unit/test_callable_engine_validation.py
  PASSED, 9 passed.

uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py tests/unit/test_callable_engine_validation.py tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py tests/integration/test_nested_workflow_function_call.py tests/architecture/test_import_boundaries.py
  PASSED, 45 passed.

uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_environment_kernel.py
  PASSED, 8 passed.

uv run ruff check .
  PASSED.
```

Current remaining risks:

- App orchestration is still concentrated in `acc/app/__init__.py`.
- Inspect/debug output still needs invocation/scope/session/call-stack/lineage visibility.

## Milestone 8 Evidence

Added:

- `acc/app/workflow_call.py` for nested workflow call input binding and manifest helpers.
- `acc/app/inspect.py` for callable inspect payload, call stack, and lineage helpers.
- `acc/app/node_invocation.py` for clean node inbox materialization, input payload, and upstream-context helpers.

Already present:

- `acc/app/legacy_compat.py` for CapsuleSpec-to-callable compatibility mapping.

Preserved:

- `WorkflowAppService` public API,
- CLI behavior,
- legacy graph behavior,
- clean workflow behavior.

Residual note:

- The public app service and main workflow loop remain in `acc/app/__init__.py`.
- Callable-specific helper concerns are no longer collapsed into one unbounded runner: legacy compatibility, workflow-call binding, inspect/lineage, and node input/materialization helpers are separated.

Validation:

```text
uv run pytest -q tests/integration/test_nested_workflow_function_call.py tests/integration/test_clean_core_accflow.py
  PASSED, 6 passed.

uv run pytest -q tests/integration/test_callable_inspect.py tests/integration/test_nested_workflow_function_call.py
  PASSED, 3 passed.

uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_nested_workflow_function_call.py tests/integration/test_callable_inspect.py
  PASSED, 7 passed.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run ruff check acc/app/__init__.py acc/app/node_invocation.py acc/app/inspect.py acc/app/workflow_call.py
  PASSED.
```

## Milestone 9 Evidence

Added:

- callable runtime evidence in workflow inspect payload:
  - `function_invocation`,
  - `scope_frame`,
  - `node_sessions`,
  - `workflow_calls`,
  - `call_stack`,
  - `lineage`,
- `tests/integration/test_callable_inspect.py`.

Preserved:

- existing inspect summary and manifest fields,
- `acc workflow inspect --json` single JSON output.

Validation:

```text
uv run pytest -q tests/integration/test_callable_inspect.py
  PASSED, 1 passed.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run ruff check acc/app/__init__.py tests/integration/test_callable_inspect.py
  PASSED.
```

Current remaining risks:

- Final acceptance examples `callable_main_function_demo.accflow.json` and `callable_agent_tool_demo.accflow.json` still need to exist and pass acceptance commands.
- App execution-loop split remains partial.

## Final acceptance

Current evidence:

```text
uv run pytest -q
  PASSED, 297 passed.

uv run ruff check .
  PASSED.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py tests/unit/test_callable_engine_validation.py tests/unit/test_invocation_store.py
  PASSED, 30 passed.

uv run pytest -q tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py tests/integration/test_nested_workflow_function_call.py tests/integration/test_callable_inspect.py
  PASSED, 7 passed.

uv run pytest -q tests/unit/test_callable_engine_validation.py::test_large_dag_validation_sanity
  PASSED, 1 passed.

uv run python -m json.tool schemas/agent_class_template_schema.json
uv run python -m json.tool schemas/tool_class_template_schema.json
uv run python -m json.tool schemas/workflow_function_template_schema.json
uv run python -m json.tool schemas/node_invocation_spec_schema.json
uv run python -m json.tool schemas/function_invocation_schema.json
uv run python -m json.tool schemas/scope_frame_schema.json
uv run python -m json.tool schemas/session_instance_schema.json
  PASSED.

uv run acc workflow validate examples/workflows/callable_main_function_demo.accflow.json --json
  PASSED, stdout was a single JSON object.

uv run acc workflow validate examples/workflows/callable_nested_function_demo.accflow.json --json
  PASSED, stdout was a single JSON object.

uv run acc workflow validate examples/workflows/callable_agent_tool_demo.accflow.json --json
  PASSED, stdout was a single JSON object.

uv run acc workflow run examples/workflows/callable_main_function_demo.accflow.json --run-dir runs/acceptance_callable_main --emit-json
  PASSED, stdout was a single JSON object.

uv run acc workflow run examples/workflows/callable_nested_function_demo.accflow.json --run-dir runs/acceptance_callable_nested --emit-json
  PASSED, stdout was a single JSON object.

uv run acc workflow run examples/workflows/callable_agent_tool_demo.accflow.json --run-dir runs/acceptance_callable_agent_tool --emit-json
  PASSED, stdout was a single JSON object.

uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_callable_echo --emit-conductor-json
  PASSED, stdout was a single JSON object.

uv run acc workflow bind examples/workflows/environment_stateful_demo.accflow.json --workspace . --out runs/acceptance_callable_binding/workflow.binding.local.json --json
  PASSED, stdout was a single JSON object.

uv run acc workflow run examples/workflows/environment_stateful_demo.accflow.json --binding runs/acceptance_callable_binding/workflow.binding.local.json --run-dir runs/acceptance_callable_bound --emit-json
  PASSED, stdout was a single JSON object.
```

What was added:

- Callable domain model types.
- Callable schemas.
- Legacy normalization and capsule compatibility adapters.
- Function invocation, scope frame, session instance, and workflow-call manifests.
- Explicit nested workflow function-call input/output binding runtime.
- Callable engine validation and safety negative tests.
- Callable inspect evidence and lineage output.
- Callable acceptance examples and tests.

What was deleted:

- Nothing.

What was renamed:

- Nothing. Existing concepts remain available; callable concepts are additive and compatibility-backed.

What was preserved:

- `acc run` public behavior.
- `--emit-conductor-json` stdout contract.
- `acc workflow run --emit-json` stdout contract.
- Existing `.accflow.json` behavior.
- Existing legacy graph/capsule behavior.
- Default hermetic tests.
- Store ownership of inbox/outbox materialization.
- Runtime execution-only responsibility.
- Engine purity.

Legacy mapping:

```text
CapsuleSpec(kind=agent_session) -> AgentClassTemplate compatibility view
CapsuleSpec(kind=agent_workflow) -> AgentClassTemplate compatibility view
CapsuleSpec(kind=atomic) -> ToolClassTemplate compatibility view
CapsuleSpec(kind=acc_workflow) -> WorkflowFunctionTemplate compatibility wrapper
NodeSpec(kind=agent, runtime=...) -> NodeInvocationSpec(callable_ref=agent_class:runtime)
NodeSpec(kind=tool, tool=...) -> NodeInvocationSpec(callable_ref=tool_class:tool)
NodeSpec(kind=workflow, workflow_ref=...) -> NodeInvocationSpec(callable_ref=workflow_function:workflow_ref)
WorkflowTemplate -> WorkflowFunctionTemplate compatibility facade
EnvironmentFrame -> ScopeFrame evidence via scope_frame_manifest.json
SessionManifest -> legacy acc run session evidence; clean workflow agent/tool nodes now also emit SessionInstance
```

Remaining risks:

- `acc/app/__init__.py` still owns the high-level public workflow loop; helper responsibilities have been split, but the public service is still centralized.
- Callable validation currently exists as callable-specific engine validation and legacy clean workflow validation; future work may wire callable validation directly into every CLI validate path if stricter authoring behavior is desired.
- Existing unrelated web/UI worktree edits remain outside this goal's scope.
