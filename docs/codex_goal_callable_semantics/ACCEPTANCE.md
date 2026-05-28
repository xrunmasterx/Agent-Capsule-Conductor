# Callable Semantics Acceptance

This goal is complete only when all required commands pass.

## 1. Baseline

```bash
uv run pytest -q
uv run ruff check .
uv run pytest -q tests/architecture/test_import_boundaries.py
```

## 2. New callable domain tests

```bash
uv run pytest -q tests/unit/test_callable_domain.py
uv run pytest -q tests/unit/test_callable_schema.py
uv run pytest -q tests/unit/test_callable_normalization.py
uv run pytest -q tests/unit/test_callable_engine_validation.py
uv run pytest -q tests/unit/test_invocation_store.py
```

Schema files must also be valid JSON:

```bash
uv run python -m json.tool schemas/agent_class_template_schema.json
uv run python -m json.tool schemas/tool_class_template_schema.json
uv run python -m json.tool schemas/workflow_function_template_schema.json
uv run python -m json.tool schemas/node_invocation_spec_schema.json
uv run python -m json.tool schemas/function_invocation_schema.json
uv run python -m json.tool schemas/scope_frame_schema.json
uv run python -m json.tool schemas/session_instance_schema.json
```

## 3. New callable integration tests

```bash
uv run pytest -q tests/integration/test_function_invocation_manifests.py
uv run pytest -q tests/integration/test_session_instance_manifests.py
uv run pytest -q tests/integration/test_nested_workflow_function_call.py
uv run pytest -q tests/integration/test_callable_inspect.py
```

## 4. Example workflow validation

```bash
uv run acc workflow validate examples/workflows/callable_main_function_demo.accflow.json --json
uv run acc workflow validate examples/workflows/callable_nested_function_demo.accflow.json --json
uv run acc workflow validate examples/workflows/callable_agent_tool_demo.accflow.json --json
```

Each command must emit one valid JSON object to stdout when `--json` is used.

## 5. Example workflow execution

```bash
uv run acc workflow run examples/workflows/callable_main_function_demo.accflow.json --run-dir runs/acceptance_callable_main --emit-json
uv run acc workflow run examples/workflows/callable_nested_function_demo.accflow.json --run-dir runs/acceptance_callable_nested --emit-json
uv run acc workflow run examples/workflows/callable_agent_tool_demo.accflow.json --run-dir runs/acceptance_callable_agent_tool --emit-json
```

Each command must:

- emit exactly one JSON object to stdout,
- write `function_invocation_manifest.json`,
- write `scope_frame_manifest.json`,
- write node events,
- write node outboxes,
- write artifact bundles.

Nested acceptance must also verify:

- child invocation manifest exists,
- child scope frame includes parent frame id,
- parent workflow-node outbox is populated from child exposed output,
- downstream inbox reads from parent workflow-node outbox.

## 6. Legacy command regression

```bash
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_callable_echo --emit-conductor-json
```

Acceptance:

- stdout is exactly one JSON object,
- logs do not appear in stdout,
- `session_manifest.json` exists,
- `conductor_output.json` exists,
- status is success.

## 7. Environment binding regression

```bash
uv run acc workflow bind examples/workflows/environment_stateful_demo.accflow.json --workspace . --out runs/acceptance_callable_binding/workflow.binding.local.json --json
uv run acc workflow run examples/workflows/environment_stateful_demo.accflow.json --binding runs/acceptance_callable_binding/workflow.binding.local.json --run-dir runs/acceptance_callable_bound --emit-json
```

Acceptance:

- binding file is separate from workflow template,
- workflow template is not mutated,
- manifest marks workspace as non-ephemeral,
- stdout remains one JSON object.

## 8. Safety negative tests

The test suite must prove rejection for:

- local absolute workspace paths in templates,
- recursive workflow call without explicit allow policy,
- call depth above policy,
- stateful-in-stateful nesting by default,
- parent edge to child internal node,
- child reads unbound parent data,
- dangerous permission without explicit allow,
- network in hermetic mode,
- full host env inheritance,
- path traversal in materialization.

## 9. Performance sanity

The test suite must prove the refactor does not introduce obvious graph-validation regressions:

```bash
uv run pytest -q tests/unit/test_callable_engine_validation.py::test_large_dag_validation_sanity
```

Acceptance:

- 1000 nodes and 999 edges validate in a reasonable local unit-test budget,
- validation does not recurse until stack overflow,
- engine does not perform filesystem IO,
- normalization does not scan unrelated directories.

## 10. Termination conditions

All conditions in `docs/codex_goal_callable_semantics/TERMINATION_CONDITIONS.md` must be satisfied.

## 11. Final report

`docs/codex_goal_callable_semantics/QUALITY_REPORT.md` must include:

- what was added,
- what was deleted,
- what was renamed,
- what was preserved,
- how legacy Capsule/NodeSpec maps to callable semantics,
- exact commands run,
- test results,
- remaining risks.
