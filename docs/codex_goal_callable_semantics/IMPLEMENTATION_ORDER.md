# Callable Semantics Implementation Order

## Milestone 1: Baseline audit

Deliver:

- update `FINDINGS.md`,
- update `RISK_REGISTER.md`,
- record baseline test results.

Commands:

```bash
uv run pytest -q
uv run ruff check .
uv run pytest -q tests/architecture/test_import_boundaries.py
```

## Milestone 2: Domain types and schemas

Deliver:

- domain types,
- JSON schemas,
- example payloads if useful.
- required schema files:
  - `schemas/agent_class_template_schema.json`
  - `schemas/tool_class_template_schema.json`
  - `schemas/workflow_function_template_schema.json`
  - `schemas/node_invocation_spec_schema.json`
  - `schemas/function_invocation_schema.json`
  - `schemas/scope_frame_schema.json`
  - `schemas/session_instance_schema.json`

Tests:

```bash
uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_callable_schema.py
```

## Milestone 3: Legacy normalization

Deliver:

- old `.accflow.json` to callable semantic normalization,
- compatibility mapping from old `NodeSpec` fields,
- compatibility mapping from `CapsuleSpec` where needed.

Tests:

```bash
uv run pytest -q tests/unit/test_callable_normalization.py
```

## Milestone 4: Invocation and scope store

Deliver:

- function invocation manifests,
- scope frame manifests,
- ids and parent relations,
- store path safety.

Tests:

```bash
uv run pytest -q tests/unit/test_invocation_store.py tests/integration/test_function_invocation_manifests.py
```

## Milestone 5: Session instance manifests

Deliver:

- agent/tool session instance manifest,
- node run manifest references session id,
- workflow call evidence for workflow nodes.

Tests:

```bash
uv run pytest -q tests/integration/test_session_instance_manifests.py
```

## Milestone 6: Nested workflow function call

Deliver:

- explicit workflow-call input bindings,
- explicit workflow-call output bindings,
- child outputs returned through parent workflow-node outbox,
- downstream nodes read from parent outbox.

Tests:

```bash
uv run pytest -q tests/integration/test_nested_workflow_function_call.py
```

## Milestone 7: Engine validation hardening

Deliver:

- recursion guard,
- max depth policy,
- stateful-in-stateful rejection,
- child boundary validation,
- unbound parent data rejection,
- safety negative tests.

Tests:

```bash
uv run pytest -q tests/unit/test_callable_engine_validation.py
```

## Milestone 8: App layer cleanup

Deliver:

- split app coordination modules if needed,
- preserve public imports,
- keep CLI/server behavior.

Tests:

```bash
uv run pytest -q tests/architecture/test_import_boundaries.py
uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_environment_kernel.py
```

## Milestone 9: Inspect/debug evidence

Deliver:

- inspect payload includes invocation, scope, sessions, call stack, lineage.

Tests:

```bash
uv run pytest -q tests/integration/test_callable_inspect.py
```

## Milestone 10: Final acceptance

Deliver:

- all acceptance commands pass,
- update migration notes,
- update quality report.
- update `docs/human/ACC_CALLABLE_SEMANTICS_PLAIN_LANGUAGE.md`.
- update `docs/codex_goal_callable_semantics/MIGRATION_NOTES.md`.

Commands:

```bash
uv run pytest -q
uv run ruff check .
```
