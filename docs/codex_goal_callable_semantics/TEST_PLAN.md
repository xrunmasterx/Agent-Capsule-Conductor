# Callable Semantics Test Plan

## Philosophy

Default tests must be hermetic. They must not require real Codex, Claude, Cursor, Gemini, Hermes, Conductor, browser cloud services, network, or paid credentials.

## Baseline commands

```bash
uv run pytest -q
uv run ruff check .
uv run pytest -q tests/architecture/test_import_boundaries.py
```

## New unit tests

### `tests/unit/test_callable_domain.py`

Cases:

- valid `CallableRef` loads,
- valid `AgentClassTemplate` loads,
- valid `ToolClassTemplate` loads,
- valid `WorkflowFunctionTemplate` loads,
- valid `NodeInvocationSpec` loads,
- template rejects session/run state,
- template rejects local absolute workspace path.

### `tests/unit/test_callable_schema.py`

Cases:

- new JSON schemas parse with `python -m json.tool`,
- valid example payloads pass,
- missing required ids fail,
- invalid callable kind fails,
- invalid environment policy fails.

Required schema files:

- `schemas/agent_class_template_schema.json`
- `schemas/tool_class_template_schema.json`
- `schemas/workflow_function_template_schema.json`
- `schemas/node_invocation_spec_schema.json`
- `schemas/function_invocation_schema.json`
- `schemas/scope_frame_schema.json`
- `schemas/session_instance_schema.json`

### `tests/unit/test_callable_normalization.py`

Cases:

- legacy agent node normalizes to callable ref,
- legacy tool node normalizes to callable ref,
- legacy workflow node normalizes to workflow function callable ref,
- prompt becomes override,
- permission profile becomes invocation override,
- old `.accflow.json` examples still validate.

### `tests/unit/test_callable_engine_validation.py`

Cases:

- valid callable workflow passes,
- data edge source not control-upstream fails,
- parent edge to child internal node fails,
- missing child input binding fails when required,
- recursion fails by default,
- depth above policy fails,
- stateful-in-stateful fails by default,
- local absolute workspace path fails,
- full host env inheritance fails,
- large DAG validation sanity test.

Performance sanity:

- 1000 nodes / 999 control edges must validate without obvious quadratic blowup,
- callable normalization must not perform filesystem scans,
- engine validation must remain IO-free.

### `tests/unit/test_invocation_store.py`

Cases:

- store writes function invocation manifest,
- store writes scope frame manifest,
- store writes session instance manifest,
- manifests include parent ids for nested calls,
- path traversal is rejected.

## New integration tests

### `tests/integration/test_function_invocation_manifests.py`

Run a simple workflow and verify:

- root `function_invocation_manifest.json` exists,
- root `scope_frame_manifest.json` exists,
- manifest ids match workflow summary,
- workspace default is ephemeral.

### `tests/integration/test_session_instance_manifests.py`

Run a workflow with agent/tool nodes and verify:

- each executable node writes `session_instance_manifest.json`,
- session manifest references invocation id and scope frame id,
- node run manifest references session id.

### `tests/integration/test_nested_workflow_function_call.py`

Run nested callable demo and verify:

- child invocation manifest exists,
- child scope frame has parent frame id,
- child input comes from explicit binding,
- parent workflow-node outbox contains child exposed output,
- downstream inbox comes from parent workflow-node outbox.

### `tests/integration/test_callable_inspect.py`

Run inspect and verify output contains:

- function invocation,
- scope frame,
- session instances,
- workflow call stack,
- inbox/outbox lineage.

## Legacy regression tests

Existing tests must continue passing, especially:

- CLI JSON stdout contract tests,
- session isolation tests,
- GraphOps dry-run tests,
- architecture boundary tests,
- clean accflow tests,
- environment kernel tests.
