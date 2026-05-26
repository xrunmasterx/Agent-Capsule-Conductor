# Environment-Scoped Workflow Capsule Spec

## 1. Product definition

ACC Environment Kernel is a refinement of the existing Capsule and Workflow system.

It makes workflows act like reusable environment-aware templates. A workflow can be saved without a machine-specific workspace, then bound at runtime to a workspace. Agent nodes inside the workflow execute in that workspace, preserving the native experience of opening agent CLI inside a working directory.

## 2. Core model

### 2.1 Base Capsule

`BaseCapsule` is an abstract execution graph node.

It defines:

```text
id
name
inputs[]
outputs[]
readiness_policy
failure_policy
metadata
```

It is not used directly by users.

### 2.2 WorkflowTemplate

A saved workflow asset.

Properties:

```text
id
version
nodes
control_edges
data_edges
exposed_inputs
exposed_outputs
workspace_policy
behavior_pack_policy
```

A saved `WorkflowTemplate` must not contain machine-specific workspace paths by default.

### 2.3 EnvironmentFrame

A runtime environment created when a workflow is run.

Properties:

```text
environment_id
workflow_id
state_mode: stateless | stateful
workspace_root
inbox_root
outbox_root
artifact_root
snapshot_root
```

### 2.4 AgentSessionNode

Runs an external mature agent inside the current EnvironmentFrame.

Required behavior:

```text
cwd = environment.workspace_root unless node overrides subdir
uses workspace-native AGENTS.md / CLAUDE.md / skills / hooks by default
can apply template overlay behavior pack if configured
writes artifacts through node outbox
```

### 2.5 ToolNode

Deterministic node.

Kinds:

```text
atomic_script
if
for_each
merge
wait
json_transform
```

### 2.6 WorkflowNode

A nested workflow-as-node.

It can:

```text
inherit parent environment
or create a new stateful environment if allowed
or run as stateless ephemeral environment
```

Default rule:

```text
stateful environment inside another stateful environment is rejected.
```

### 2.7 Port / Inbox / Outbox

Ports are first-class.

Input data must be materialized into:

```text
<environment_root>/.acc/inbox/<node_id>/<port_id>/<source_ref>/...
```

Node output must be written to:

```text
<environment_root>/.acc/outbox/<node_id>/<port_id>/...
```

Scheduler is responsible for copying/linking upstream outbox artifacts into downstream inboxes.

Sender nodes must not write directly into receiver workspace or inbox.

## 3. Workspace policy

### 3.1 Stateless workflow

Saved workflow templates are stateless by default.

When run without workspace binding, they must use an ephemeral per-run workspace:

```text
runs/<run_id>/environments/<environment_id>/workspace/
```

They must not use ACC install directory as mutable workspace.

### 3.2 Stateful workflow

A workflow run can be bound to a real workspace:

```bash
acc workflow run workflow.graph.json --workspace F:\Agent-Capsule-Conductor
```

Agent nodes inside it inherit this workspace.

### 3.3 Saved workflow paths

Saved workflows must not store local absolute workspace paths unless written to a separate local binding file:

```text
workflow.graph.json          # portable template
workflow.binding.local.json  # local machine binding, gitignored
```

## 4. Behavior pack policy

Modes:

```text
workspace_native
  Use AGENTS.md / CLAUDE.md / skills / hooks already present in workspace.

template_overlay
  Copy/link fixed behavior pack files from workflow template into a session overlay.

hybrid
  Use workspace-native configuration plus template overlay, with explicit precedence.
```

All behavior pack files used in a run must be snapshotted.

## 5. Scheduler semantics

A node is ready when:

```text
all required control dependencies are satisfied
all required input ports have materialized data
resource locks are available
```

Fan-out means:

```text
all downstream ready nodes are scheduled, subject to max_concurrency and resource locks.
```

It does not mean unbounded simultaneous execution.

## 6. Resource lock policy

Nodes in the same workspace can conflict.

Default:

```text
read-only nodes may run concurrently
write nodes require exclusive workspace lock
```

## 7. Required commands

```bash
acc workflow bind <workflow> --workspace <path> --out <binding.json>
acc workflow validate <workflow>
acc workflow run <workflow> --workspace <path> --run-dir <dir> --emit-json
acc environment inspect <run_dir> --json
acc ports inspect <run_dir> --json
```

## 8. Backward compatibility

Existing commands must continue to work:

```bash
acc run echo-test.generic --input ... --run-dir ... --emit-conductor-json
acc validate echo-test.generic
acc batch-run ... --emit-conductor-json
```
