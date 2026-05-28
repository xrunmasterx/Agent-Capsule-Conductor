# Callable Semantics Domain Model

## CallableRef

```json
{
  "kind": "agent_class",
  "id": "source_analyzer.codex",
  "version": "0.1.0"
}
```

Allowed kinds:

```text
agent_class
tool_class
workflow_function
legacy_capsule
```

## AgentClassTemplate

```json
{
  "id": "source_analyzer.codex",
  "version": "0.1.0",
  "runtime": "codex_cli",
  "default_prompt": "Analyze the source tree.",
  "default_skills": ["source-analysis"],
  "default_permissions": {
    "workspace_access": "read_only",
    "network": false,
    "shell": false,
    "dangerous": false
  },
  "input_ports": {
    "brief": {"type": "artifact", "required": true}
  },
  "output_ports": {
    "report": {"type": "artifact", "required": true}
  }
}
```

## ToolClassTemplate

```json
{
  "id": "merge_reports.local",
  "version": "0.1.0",
  "runner": "merge",
  "default_permissions": {
    "workspace_access": "writes_run_only",
    "network": false,
    "shell": false,
    "dangerous": false
  },
  "input_ports": {
    "reports": {"type": "artifact", "cardinality": "many"}
  },
  "output_ports": {
    "bundle": {"type": "artifact"}
  }
}
```

## WorkflowFunctionTemplate

```json
{
  "id": "architecture_review",
  "version": "0.1.0",
  "exposed_inputs": {
    "question": {"type": "artifact", "required": true}
  },
  "exposed_outputs": {
    "report": {"type": "artifact", "required": true}
  },
  "nodes": [],
  "control_edges": [],
  "data_edges": [],
  "policies": {}
}
```

## NodeInvocationSpec

```json
{
  "id": "source_check",
  "callable_ref": {
    "kind": "agent_class",
    "id": "source_analyzer.codex",
    "version": "0.1.0"
  },
  "overrides": {
    "prompt": "Focus on renderer initialization."
  },
  "input_bindings": [],
  "output_bindings": [],
  "environment_policy": "inherit_parent"
}
```

## CallableOverride

```json
{
  "prompt": "Focus on renderer initialization.",
  "permission_profile": {
    "workspace_access": "read_only",
    "network": false,
    "shell": false,
    "dangerous": false
  },
  "timeout_seconds": 120,
  "retry": {
    "max_attempts": 1
  },
  "static_input": {}
}
```

`CallableOverride` is scoped to one `NodeInvocationSpec`. It must not be written back into the reusable class template unless a human explicitly edits the template through a validated authoring path.

## WorkflowCallBinding

```json
{
  "from": {
    "node": "plan",
    "port": "brief"
  },
  "to": {
    "workflow_input": "question"
  },
  "materialization": "copy",
  "required": true
}
```

This binds parent-scope data into a child workflow function input.

## WorkflowReturnBinding

```json
{
  "from": {
    "workflow_output": "report"
  },
  "to": {
    "port": "summary"
  },
  "materialization": "copy",
  "required": true
}
```

This binds child workflow function output back into the parent workflow-node outbox.

## FunctionInvocation

```json
{
  "invocation_id": "invocation_001",
  "workflow_function_id": "architecture_review",
  "run_id": "run_001",
  "parent_invocation_id": null,
  "root_scope_frame_id": "scope_001",
  "status": "running",
  "input_payload": {},
  "started_at": "2026-05-28T00:00:00Z",
  "ended_at": null
}
```

## ScopeFrame

```json
{
  "frame_id": "scope_001",
  "invocation_id": "invocation_001",
  "parent_frame_id": null,
  "call_depth": 0,
  "workflow_id": "architecture_review",
  "workspace_root": "runs/run_001/environments/root_env/workspace",
  "environment_root": "runs/run_001/environments/root_env",
  "inbox_root": "runs/run_001/environments/root_env/.acc/inbox",
  "outbox_root": "runs/run_001/environments/root_env/.acc/outbox",
  "artifact_root": "runs/run_001/environments/root_env/.acc/artifacts",
  "ephemeral": true
}
```

## SessionInstance

```json
{
  "session_id": "session_001",
  "invocation_id": "invocation_001",
  "scope_frame_id": "scope_001",
  "node_id": "source_check",
  "callable_ref": {
    "kind": "agent_class",
    "id": "source_analyzer.codex",
    "version": "0.1.0"
  },
  "callable_kind": "agent_class",
  "cwd": "runs/run_001/environments/root_env/workspace",
  "env_keys": ["ACC_RUN_DIR", "ACC_NODE_ID"],
  "input_path": "nodes/source_check/input.json",
  "output_path": "nodes/source_check/output.json",
  "artifact_dir": "nodes/source_check/artifacts",
  "event_log_path": "nodes/source_check/events.jsonl",
  "status": "success"
}
```
