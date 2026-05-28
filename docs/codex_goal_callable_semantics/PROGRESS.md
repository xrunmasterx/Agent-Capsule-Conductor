# Progress

Status: Complete. Milestones 1-10 and final acceptance passed.

## Milestones

- [x] Baseline audit
- [x] Domain types and schemas
- [x] Legacy normalization
- [x] Invocation and scope store
- [x] Session instance manifests
- [x] Nested workflow function call
- [x] Engine validation hardening
- [x] App layer cleanup
- [x] Inspect/debug evidence
- [x] Final acceptance

## Notes

2026-05-28:

- Updated `FINDINGS.md` with current architecture evidence and baseline test results.
- Updated `RISK_REGISTER.md` with baseline capsule fixture drift and dirty web worktree risks.
- Added callable domain dataclasses in `acc/domain.py`:
  - `CallableRef`
  - `AgentClassTemplate`
  - `ToolClassTemplate`
  - `WorkflowFunctionTemplate`
  - `NodeInvocationSpec`
  - `FunctionInvocation`
  - `ScopeFrame`
  - `SessionInstance`
  - workflow call binding and policy types
- Added required Milestone 2 schemas:
  - `schemas/agent_class_template_schema.json`
  - `schemas/tool_class_template_schema.json`
  - `schemas/workflow_function_template_schema.json`
  - `schemas/node_invocation_spec_schema.json`
  - `schemas/function_invocation_schema.json`
  - `schemas/scope_frame_schema.json`
  - `schemas/session_instance_schema.json`
- Added Milestone 2 tests:
  - `tests/unit/test_callable_domain.py`
  - `tests/unit/test_callable_schema.py`

Validation evidence:

```text
uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py
  PASSED, 14 passed.

uv run ruff check acc/domain.py tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py
  PASSED.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run python -m json.tool <all seven callable schemas>
  PASSED.
```

Baseline fixture correction:

```text
tests/unit/test_registry.py originally referenced stock-market-info-curation.codex.
The repository contains stock-market-info-cleaner.codex.
The test fixture was updated to the actual capsule id.
```

Milestone 3:

- Added pure legacy normalization helpers in `acc.engine`:
  - `normalize_workflow_function_template()`
  - `normalize_node_invocation_spec()`
  - `callable_ref_from_node_spec()`
  - workflow-call input/output binding parsers
- Added capsule compatibility mapping in `acc/app/legacy_compat.py`:
  - `capsule_spec_to_callable_ref()`
  - `capsule_spec_to_class_template()`
  - `permission_profile_from_capsule()`
- Added `tests/unit/test_callable_normalization.py`.

Validation evidence:

```text
uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py tests/unit/test_callable_normalization.py
  PASSED, 20 passed.

uv run pytest -q tests/unit/test_callable_normalization.py
  PASSED, 6 passed.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run ruff check .
  PASSED.
```

Milestone 7:

- Added callable engine validation:
  - callable ref validation,
  - workflow function control/data edge validation,
  - workflow-call parent inbox binding validation,
  - workflow-call parent output port validation,
  - recursion guard,
  - max call depth policy,
  - stateful-in-stateful rejection by default,
  - large DAG validation sanity.
- Added `tests/unit/test_callable_engine_validation.py`.

Validation evidence:

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

Milestone 8:

- Split nested workflow call binding and manifest helpers into `acc/app/workflow_call.py`.
- Split workflow inspect/callable lineage helpers into `acc/app/inspect.py`.
- Split clean node inbox/input/upstream-context helpers into `acc/app/node_invocation.py`.
- Existing legacy capsule compatibility mapping remains in `acc/app/legacy_compat.py`.
- Public imports and CLI behavior are preserved.

Validation evidence:

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

Residual note:

- `acc/app/__init__.py` still exposes the public app service and main workflow loop, but callable-specific helper concerns are separated into `legacy_compat`, `workflow_call`, `node_invocation`, and `inspect`.

Milestone 9:

- `acc workflow inspect --json` now includes callable runtime evidence:
  - `function_invocation`,
  - `scope_frame`,
  - `node_sessions`,
  - `workflow_calls`,
  - `call_stack`,
  - inbox/outbox/artifact lineage.
- Added `tests/integration/test_callable_inspect.py`.

Validation evidence:

```text
uv run pytest -q tests/integration/test_callable_inspect.py
  PASSED, 1 passed.

uv run pytest -q tests/architecture/test_import_boundaries.py
  PASSED, 10 passed.

uv run ruff check acc/app/__init__.py tests/integration/test_callable_inspect.py
  PASSED.
```

Full baseline after Milestone 5 and fixture correction:

```text
uv run pytest -q
  PASSED, 297 passed.

uv run ruff check .
  PASSED.
```

Milestone 5:

- Added `session_instance_manifest.json` for every clean agent/tool node run.
- Added `session_id`, `invocation_id`, `scope_frame_id`, and `session_instance_manifest` references to node run manifests for agent/tool nodes.
- Added `workflow_call_manifest.json` for workflow nodes that call nested workflows.
- Preserved existing node output, outbox, artifact bundle, and event files.
- Added `tests/integration/test_session_instance_manifests.py`.

Validation evidence:

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

Milestone 4:

- Extended `FileSystemWorkflowStore` with additive invocation/scope state:
  - `create_function_invocation()`
  - `write_function_invocation_manifest()`
  - `write_scope_frame_manifest()`
- Each clean workflow run now writes:
  - `function_invocation_manifest.json`
  - `scope_frame_manifest.json`
- Nested workflow calls now pass:
  - `parent_invocation_id`
  - `parent_scope_frame_id`
  - incremented `call_depth`
- Existing `workflow_run_manifest.json`, `environment_manifest.json`, and CLI JSON behavior are preserved.
- Added `tests/integration/test_function_invocation_manifests.py`.

Validation evidence:

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

Milestone 6:

- Added explicit nested workflow function-call runtime behavior:
  - parent workflow-node inbox/control data can be bound into child workflow `exposed_inputs`,
  - child workflow `exposed_outputs` can be returned into parent workflow-node outboxes,
  - downstream nodes consume from the parent workflow-node outbox.
- Added `FileSystemWorkflowStore.apply_workflow_call_output_bindings()`.
- Updated nested workflow call manifest with explicit input/output binding evidence.
- Added examples:
  - `examples/workflows/callable_child_function.accflow.json`
  - `examples/workflows/callable_nested_function_demo.accflow.json`
- Added tests:
  - `tests/integration/test_nested_workflow_function_call.py`

Validation evidence:

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

Final acceptance:

- All required callable domain, schema, normalization, engine, store, session, nested workflow, inspect, architecture, ruff, and full pytest commands passed.
- Callable workflow validate/run examples passed with single JSON object stdout.
- Legacy `acc run ... --emit-conductor-json` passed with single JSON object stdout.
- Explicit workspace binding run passed without storing mutable workspace state in the workflow template.
- Key callable runtime evidence exists on disk:
  - root `function_invocation_manifest.json`,
  - root `scope_frame_manifest.json`,
  - nested workflow child `function_invocation_manifest.json`,
  - workflow-call manifest,
  - agent/tool `session_instance_manifest.json`,
  - parent workflow-node outbox from child exposed output,
  - downstream inbox from parent workflow-node outbox.
