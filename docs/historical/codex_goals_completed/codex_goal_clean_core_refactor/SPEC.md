# ACC Clean Core Refactor Spec

## Product definition

ACC vNext is a local-first, lightweight, environment-scoped workflow kernel for orchestrating mature external agent sessions and tools.

Its primary job is to let users build reusable workflow templates that can be rebound to different workspaces and then execute agent/tool nodes with explicit ports, artifact channels, and deterministic scheduling.

## Replacement policy

This spec may replace earlier architecture concepts. If older code or commands conflict with this spec, refactor or delete them.

Do not preserve backwards compatibility for its own sake.

## Required core entities

### WorkflowTemplate

Portable, stateless graph asset.

Must include:

- id
- version
- nodes
- control_edges
- data_edges
- policies
- metadata

Must not include:

- local absolute workspace path
- secret values
- run-specific session state

### EnvironmentBinding

Local-only binding from workflow template to workspace.

May include:

- workflow_id
- workspace_root
- binding_name
- environment_variables reference
- behavior_pack policy override

Should be gitignored by default.

### EnvironmentFrame

Runtime object created for a workflow run.

Includes:

- environment_id
- workflow_id
- run_id
- workspace_root
- ephemeral flag
- inbox root
- outbox root
- artifact root
- locks
- behavior pack snapshot path

### NodeSpec

Node kinds:

```text
agent
tool
workflow
```

Do not use five flat capsule kinds as the primary core model. Those may exist as compatibility wrappers only.

### AgentNode

Runs a mature external agent inside an EnvironmentFrame.

Supported runtime types may include:

- codex_cli
- claude_cli_or_sdk
- cursor_cli
- hermes_cli
- generic_cli

Default tests must mock external agents.

### ToolNode

Runs deterministic tool logic:

- python_script
- shell_script
- if
- for_each
- merge
- wait

### WorkflowNode

Runs a nested WorkflowTemplate as a node.

Default rule:

- stateless child may inherit parent environment,
- child may also use explicit binding,
- nested stateful workflow with separate workspace requires explicit allow flag.

## Required execution model

1. Load WorkflowTemplate.
2. Load or create EnvironmentBinding.
3. Create EnvironmentFrame.
4. Validate graph.
5. Topologically schedule control edges.
6. Materialize data edges into node inbox.
7. Execute nodes.
8. Write node outbox and ArtifactBundle.
9. Emit events.
10. Produce WorkflowRunManifest.

## Required safety defaults

- stateless workflow uses run-scoped ephemeral workspace,
- no writes to ACC install directory,
- no direct upstream write to downstream workspace,
- default network disabled,
- default dangerous shell commands denied,
- external agent integration optional in tests,
- no secret values in logs/events/artifacts.
