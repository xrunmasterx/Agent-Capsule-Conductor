# Goal: Environment-Scoped Workflow Capsule Kernel

## Objective

Upgrade ACC from a flat capsule-kind model into an **environment-scoped workflow capsule model**.

The new model must support:

```text
WorkflowTemplate       = saved reusable workflow graph, normally stateless
EnvironmentFrame       = runtime workspace binding for a workflow instance
AgentSessionNode       = agent CLI/SDK session launched inside an EnvironmentFrame
ToolNode               = atomic script / if / for_each / merge / wait / deterministic node
WorkflowNode           = nested workflow-as-node
Port / Inbox / Outbox  = explicit data channels and artifact materialization
```

The core user experience must be:

```text
A user can save a reusable workflow template without a machine-specific workspace.
When reusing it, the user binds it to a working directory.
Agent nodes inside that workflow run as if the user opened Codex/Claude/Cursor/Hermes CLI in that directory.
Inputs arrive in explicit inbox folders.
Outputs are emitted through explicit outbox folders and artifact manifests.
```

## Why this is needed

The old five-kind model:

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

is useful but too flat. It does not clearly define:

- which capsule creates an environment;
- which node inherits a workspace;
- where workflow inputs are stored;
- how outputs flow to downstream nodes;
- how saved workflows remain stateless and reusable;
- how workspace-native AGENTS.md / CLAUDE.md / skills / hooks interact with template-defined behavior.

## Must deliver

1. Data model upgrade:
   - `WorkflowTemplate`
   - `EnvironmentFrame`
   - `WorkflowInstance`
   - `NodeInstance`
   - `PortSpec`
   - `InboxManifest`
   - `OutboxManifest`
   - `ArtifactBundle`
   - `WorkspaceBinding`
   - `BehaviorPackPolicy`

2. CLI/API support:
   - `acc workflow bind <workflow> --workspace <path> --out <binding.json>`
   - `acc workflow run <workflow> --workspace <path> --run-dir <dir> --emit-json`
   - `acc workflow validate <workflow>` must validate environment semantics.
   - `acc environment inspect <run_dir> --json`
   - `acc ports inspect <run_dir> --json`

3. Runtime behavior:
   - Agent nodes inherit workflow workspace by default.
   - Stateless workflows run in a per-run ephemeral workspace, not ACC install directory.
   - Sender nodes write to outbox only.
   - Scheduler materializes upstream artifacts into receiver inboxes.
   - Stateful-in-stateful workflow nesting is rejected by default.
   - Stateless child workflows may inherit parent workspace.

4. Behavior pack support:
   - `workspace_native`
   - `template_overlay`
   - `hybrid`
   - snapshot of behavior files used in the session.

5. UI/workbench support if UI exists:
   - show workflow containers / environment boundary;
   - show workspace binding status;
   - show node cwd;
   - show input/output ports;
   - show inbox/outbox artifacts;
   - allow binding/rebinding a workflow workspace.

6. Tests:
   - Hermetic tests only by default.
   - No real Codex/Claude required.
   - Existing `acc run --emit-conductor-json` contract must not break.

## Non-goals

Do not:

- rewrite the whole ACC runtime;
- implement a new LLM agent loop;
- use ACC install directory as mutable default workspace;
- let upstream nodes write directly into downstream workspaces;
- silently share agent session memory across nodes;
- introduce remote registry/cloud/database dependencies by default;
- change existing stdout JSON contract.

## Completion condition

The goal is complete only when all commands in `docs/codex_goal_environment_kernel/ACCEPTANCE.md` pass and the examples demonstrate:

```text
stateless workflow template
  -> bind workspace
  -> agent node inherits cwd
  -> inputs materialize into inbox
  -> outputs go through outbox
  -> downstream node receives materialized input
  -> saved workflow does not store local workspace path
  -> nested stateful workflow is rejected
  -> existing acc run regression still passes
```
