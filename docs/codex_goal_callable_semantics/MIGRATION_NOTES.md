# Migration Notes

Status: Implemented as additive compatibility migration.

## Compatibility commitment

This goal must not remove existing public commands. Existing `.accflow.json` and `CapsuleSpec` based workflows remain supported through normalization and compatibility views.

## Concept mapping

```text
CapsuleSpec(kind=agent_session) -> AgentClassTemplate compatibility view
CapsuleSpec(kind=atomic)        -> ToolClassTemplate or legacy callable view
CapsuleSpec(kind=acc_workflow)  -> WorkflowFunctionTemplate compatibility view
WorkflowTemplate                -> WorkflowFunctionTemplate compatibility facade
NodeSpec                        -> NodeInvocationSpec compatibility facade
EnvironmentFrame                -> ScopeFrame compatible subset
SessionManifest                 -> SessionInstance compatible subset for acc run
```

## Field mapping

```text
kind: agent + runtime         -> callable_ref(kind=agent_class)
kind: tool + tool             -> callable_ref(kind=tool_class)
kind: workflow + workflow_ref -> callable_ref(kind=workflow_function)
prompt                       -> CallableOverride.prompt
permission_profile           -> CallableOverride.permission_profile
ports                        -> invocation-visible port contracts
raw                          -> compatibility metadata
```

## Additive manifests

The new runtime evidence is additive:

```text
function_invocation_manifest.json
scope_frame_manifest.json
nodes/<node_id>/session_instance_manifest.json
nodes/<node_id>/workflow_call_manifest.json
```

Existing manifests remain until a documented migration removes them in a later phase.

## Implemented notes

Schema changes:

- Added callable class/function/invocation/scope/session schemas under `schemas/`.
- Existing capsule, session, graph, and workflow schemas were not removed.

Domain changes:

- Added callable domain dataclasses in `acc.domain`.
- Existing `NodeSpec`, `WorkflowTemplate`, `EnvironmentFrame`, and legacy `SessionManifest` behavior remain supported.

Normalization:

- `acc.engine.normalize_node_invocation_spec()` maps legacy `NodeSpec` fields into `NodeInvocationSpec`.
- `acc.engine.normalize_workflow_function_template()` maps `WorkflowTemplate` into `WorkflowFunctionTemplate`.
- `acc.app.legacy_compat` maps `CapsuleSpec` to callable class/function compatibility views.

Runtime evidence:

- Clean workflow runs now emit:
  - `function_invocation_manifest.json`,
  - `scope_frame_manifest.json`,
  - `nodes/<node_id>/session_instance_manifest.json` for agent/tool nodes,
  - `nodes/<node_id>/workflow_call_manifest.json` for workflow nodes.
- Existing `workflow_run_manifest.json`, `workflow_summary.json`, `workflow_run.json`, `environment_manifest.json`, node events, outboxes, inboxes, and artifact bundles remain.

Nested workflows:

- Legacy nested workflow behavior still works.
- New explicit function-call behavior is available through:
  - `workflow_call_input_bindings`,
  - `workflow_call_output_bindings`.
- `upstream_context` remains only as compatibility/control context fallback.

CLI behavior:

- Existing `acc run ... --emit-conductor-json` behavior is preserved.
- Existing `acc workflow run ... --emit-json` behavior is preserved with additive manifest fields.
- `acc workflow inspect --json` now includes callable evidence while keeping existing summary/manifest fields.

Examples added:

- `examples/workflows/callable_main_function_demo.accflow.json`
- `examples/workflows/callable_child_function.accflow.json`
- `examples/workflows/callable_nested_function_demo.accflow.json`
- `examples/workflows/callable_agent_tool_demo.accflow.json`

Known compatibility correction:

- `tests/unit/test_registry.py` referenced stale capsule id `stock-market-info-curation.codex`.
- The repository contains `stock-market-info-cleaner.codex`, so the test now validates the actual capsule id.

Tests proving compatibility:

- `uv run pytest -q`
- `uv run pytest -q tests/integration/test_clean_core_accflow.py tests/integration/test_environment_kernel.py`
- `uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_callable_echo --emit-conductor-json`
- `uv run acc workflow run examples/workflows/environment_stateful_demo.accflow.json --binding runs/acceptance_callable_binding/workflow.binding.local.json --run-dir runs/acceptance_callable_bound --emit-json`
