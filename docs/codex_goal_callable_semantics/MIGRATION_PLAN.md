# Callable Semantics Migration Plan

## Principle

Migrate by normalization and compatibility first. Do not break existing public commands.

## Existing concept mapping

```text
CapsuleSpec(kind=agent_session) -> AgentClassTemplate compatibility view
CapsuleSpec(kind=atomic)        -> ToolClassTemplate or legacy callable view
CapsuleSpec(kind=acc_workflow)  -> WorkflowFunctionTemplate compatibility view
WorkflowTemplate                -> WorkflowFunctionTemplate compatibility facade
NodeSpec                        -> NodeInvocationSpec compatibility facade
EnvironmentFrame                -> ScopeFrame compatible subset
SessionManifest                 -> SessionInstance compatible subset for acc run
```

## File format migration

Existing `.accflow.json` remains valid. Parser normalizes it internally.

New files may prefer:

```text
callable_ref
node_invocations
workflow_call_input_bindings
workflow_call_output_bindings
```

Old fields remain supported:

```text
kind
runtime
tool
workflow_ref
prompt
permission_profile
ports
```

## CLI migration

No public command is removed in this goal.

Potential future aliases may be added only after compatibility tests exist.

## Manifest migration

Existing manifests remain.

New manifests are additive:

```text
function_invocation_manifest.json
scope_frame_manifest.json
session_instance_manifest.json
workflow_call_manifest.json
```

## Rollback strategy

Because the migration is additive and normalized, rollback should be possible by:

- keeping old parser path,
- keeping old run summary fields,
- keeping old CLI JSON output fields,
- disabling new strict callable schema only for legacy paths if needed.

