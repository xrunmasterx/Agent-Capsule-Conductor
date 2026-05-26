# Domain Model

## WorkflowTemplate

Portable graph asset.

```json
{
  "id": "engine_research_v1",
  "version": "0.1.0",
  "nodes": [],
  "control_edges": [],
  "data_edges": [],
  "policies": {}
}
```

## EnvironmentBinding

Local file that binds a workflow to a workspace.

```json
{
  "workflow_id": "engine_research_v1",
  "binding_name": "local_engine_repo",
  "workspace_root": "F:/Agent-Capsule-Conductor"
}
```

## EnvironmentFrame

Created at runtime.

```json
{
  "environment_id": "env_root",
  "run_id": "run_001",
  "workflow_id": "engine_research_v1",
  "workspace_root": "...",
  "ephemeral": false,
  "inbox_root": "runs/run_001/environments/env_root/inbox",
  "outbox_root": "runs/run_001/environments/env_root/outbox",
  "artifact_root": "runs/run_001/environments/env_root/artifacts"
}
```

## AgentNode

```json
{
  "id": "source_check",
  "kind": "agent",
  "runtime": "codex_cli",
  "prompt": "Analyze current renderer architecture",
  "ports": {
    "inputs": ["research_bundle"],
    "outputs": ["source_report"]
  },
  "behavior_pack": {
    "mode": "workspace_native"
  }
}
```

## ToolNode

```json
{
  "id": "merge_reports",
  "kind": "tool",
  "tool": "merge",
  "ports": {
    "inputs": ["reports"],
    "outputs": ["bundle"]
  }
}
```

## WorkflowNode

```json
{
  "id": "research_subflow",
  "kind": "workflow",
  "workflow_ref": "workflows/research_subflow.accflow.json",
  "environment_policy": "inherit_parent"
}
```

## ControlEdge

```json
{
  "from": "A",
  "to": "B",
  "condition": null
}
```

## DataEdge

```json
{
  "from": {"node": "A", "port": "report"},
  "to": {"node": "B", "port": "external_report"},
  "materialization": "copy"
}
```
