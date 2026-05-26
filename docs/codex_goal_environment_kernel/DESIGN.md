# Environment Kernel Design

## 1. Why the old model is insufficient

The previous model treated `atomic`, `agent_session`, `agent_workflow`, `acc_workflow`, and `external_workflow` as sibling capsule kinds.

That is incomplete because the user's actual mental model is:

```text
workflow = environment / workspace scope
agent node = session started inside that environment
atomic/tool node = deterministic logic inside that environment
workflow = reusable saved template, bound to workspace at runtime
```

## 2. New architecture

```text
WorkflowTemplate
  -> instantiated as WorkflowInstance
      -> creates EnvironmentFrame
          -> contains AgentSessionNode / ToolNode / WorkflowNode
              -> each creates NodeSession
                  -> reads inbox
                  -> runs in environment cwd
                  -> writes outbox
                  -> emits artifacts and events
```

## 3. Key objects

### WorkflowTemplate

Portable graph asset.

It contains graph structure and node definitions but no machine-specific workspace path.

### WorkflowInstance

Runtime instance of a WorkflowTemplate.

It owns one root EnvironmentFrame.

### EnvironmentFrame

A runtime workspace boundary.

Stateful environment:

```text
workspace_root = user-provided path
```

Stateless environment:

```text
workspace_root = runs/<run_id>/environments/<env_id>/workspace
```

### NodeSession

Execution instance of a node.

It has:

```text
node_id
session_id
environment_id
cwd
inbox
outbox
run_dir
events
artifacts
```

## 4. Data movement design

### Wrong design

```text
Sender writes directly into receiver workflow folder.
```

This is rejected.

Reason:

- breaks isolation;
- hides data ownership;
- causes race conditions;
- makes debugging hard.

### Correct design

```text
Sender writes to its own outbox.
Scheduler materializes sender outbox into receiver inbox.
Receiver reads from its inbox.
```

This is the core rule.

## 5. Directory layout

Example run:

```text
runs/run_001/
  workflow_run_manifest.json
  environments/
    root_env/
      environment_manifest.json
      workspace/                 # stateless ephemeral workspace, or link/ref to bound workspace
      .acc/
        inbox/
          node_b/input_from_a/source_node_a/
        outbox/
          node_a/main/
        snapshots/
          behavior_pack/
        artifacts/
  nodes/
    node_a/
      session_manifest.json
      input.json
      resolved_prompt.md
      events.jsonl
      output.json
      artifacts/
```

For a stateful workspace, do not litter the user's workspace. Prefer `.acc/` inside run dir and pass references to the agent. If workspace-native config must be used, `cwd` is the user workspace, but inputs/outputs should still be staged under a controlled `.acc` run directory unless explicitly configured.

## 6. Behavior pack materialization

Modes:

```text
workspace_native:
  no overlay; use files already in cwd.

template_overlay:
  materialize fixed files into session overlay; optionally symlink/copy.

hybrid:
  overlay plus workspace-native; precedence must be explicit.
```

Every run must snapshot the effective behavior pack.

## 7. Nesting rule

Default:

```text
stateful EnvironmentFrame cannot create another stateful EnvironmentFrame.
```

Allowed:

```text
stateless child workflow inherits parent environment
stateless root workflow can instantiate one bound stateful environment
```

This prevents workspace ambiguity.

## 8. UI implications

Workbench should show:

```text
workflow container boundary
environment state: unbound / stateless / bound
workspace path badge
agent node cwd
node input ports
node output ports
inbox / outbox artifacts
```

If the workflow is unbound, UI should show:

```text
请绑定工作目录
```

## 9. Scheduler implications

The scheduler must:

```text
validate graph semantics
compute readiness by input/control dependencies
materialize inboxes before node run
apply resource locks
run ready nodes subject to max_concurrency
emit events
aggregate node outputs/errors
```

## 10. Compatibility

Existing `acc run` remains the atomic execution boundary.

Environment-aware workflow runner should call existing CapsuleRunner internally, not rewrite it.
