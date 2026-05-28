# Goal: ACC Callable Semantics Refactor

## Objective

Upgrade ACC Clean Core from a node/capsule-oriented runtime into an explicit callable runtime:

```text
Agent / Tool          = reusable ClassTemplate
Workflow             = reusable WorkflowFunctionTemplate
Workflow execution   = FunctionInvocation
Runtime environment  = ScopeFrame
Agent/tool execution = SessionInstance
Node in a workflow   = NodeInvocationSpec
```

This is a semantic-core refactor, not a rewrite of the mature-agent runner. The existing layered architecture must be preserved and strengthened:

```text
acc.domain
acc.engine
acc.store
acc.runtime
acc.app
acc.cli
```

The refactor must make class/function/invocation/scope/session boundaries first-class in code, schemas, manifests, tests, and docs.

## First-principles model

ACC should behave like a lightweight local runtime for agent workflows:

```text
ClassTemplate defines a reusable capability.
WorkflowFunctionTemplate defines a reusable function body.
NodeInvocationSpec calls one class/function inside the workflow body.
FunctionInvocation binds a workflow function to runtime input and environment.
ScopeFrame defines what the call can see: cwd, inbox, outbox, artifacts, behavior snapshot.
SessionInstance records one concrete agent/tool execution.
Port, Inbox, Outbox, and ArtifactBundle carry data across boundaries.
```

The saved workflow is stateless. Runtime state belongs to invocations, scope frames, sessions, events, inboxes, outboxes, and artifacts.

## Must deliver

1. New domain concepts:
   - `CallableRef`
   - `AgentClassTemplate`
   - `ToolClassTemplate`
   - `WorkflowFunctionTemplate`
   - `NodeInvocationSpec`
   - `FunctionInvocation`
   - `ScopeFrame`
   - `SessionInstance`
   - `WorkflowCallBinding`
   - `WorkflowReturnBinding`
   - `WorkflowCallInputBinding`
   - `WorkflowCallOutputBinding`
   - `CallableOverride`
   - `InvocationPolicy`
   - `CallDepthPolicy`
   - `RecursionPolicy`

2. Compatibility mapping:
   - Existing `.accflow.json` files still validate and run.
   - Existing `NodeSpec` fields normalize into `NodeInvocationSpec`.
   - Existing `CapsuleSpec` based capsules remain supported through an adapter/mapping layer.

3. Explicit nested workflow function-call semantics:
   - Parent inputs/inboxes bind into child workflow exposed inputs.
   - Child workflow exposed outputs return through the parent workflow-node outbox.
   - Downstream nodes consume only from the parent workflow-node outbox.
   - `upstream_context` remains optional control context, not primary data transport.

4. Runtime evidence:
   - Every workflow run writes `function_invocation_manifest.json`.
   - Every workflow call writes `scope_frame_manifest.json`.
   - Every agent/tool run writes `session_instance_manifest.json`.
   - Workflow nodes write workflow-call evidence and child invocation evidence.

5. Engine validation:
   - callable references are valid,
   - workflow function input/output contracts are valid,
   - data edges remain upstream control dependencies,
   - parent workflows cannot reference child internal nodes,
   - recursive workflow calls are rejected by default,
   - max call depth is enforced,
   - stateful-in-stateful nesting is rejected by default,
   - local absolute workspace paths in templates are rejected,
   - dangerous permissions, hermetic network access, and full env inheritance are rejected.

6. App-layer cleanup:
   - Keep `acc.app` as coordinator.
   - Split workflow service, execution loop, node invocation, workflow call handling, and legacy compatibility if needed.
   - Do not move CLI or UI concerns into core layers.

7. Documentation and migration:
   - Explain how old Capsule/NodeSpec maps to Class/Function/Invocation/Scope/Session.
   - Document preserved behavior, renamed concepts, compatibility, and risks.

## Completion condition

This goal is complete only when:

1. The new domain model exists and class/function/invocation/scope/session boundaries are explicit.
2. Old `.accflow.json` files normalize into `NodeInvocationSpec` without breaking existing examples.
3. Agent/tool class templates do not store runtime state.
4. Workflow function templates do not store local workspace paths or session state.
5. Every workflow run produces `FunctionInvocation` and `ScopeFrame` manifests.
6. Every agent/tool node produces a `SessionInstance` manifest.
7. Nested workflow calls use explicit input/output bindings instead of relying on `upstream_context` as primary data transport.
8. Child workflow outputs can flow through the parent workflow-node outbox into downstream inboxes.
9. Engine rejects illegal nested boundaries, recursion, excessive depth, stateful-in-stateful nesting, and absolute workspace paths.
10. Store remains the sole owner of inbox/outbox materialization.
11. Runtime remains execution-only and does not mutate graph semantics.
12. App coordination is thin enough that clean callable execution and legacy compatibility are separated.
13. All files listed in `ACCEPTANCE.md` pass.
14. `uv run pytest -q`, `uv run ruff check .`, and architecture boundary tests pass.
15. Existing `acc run ... --emit-conductor-json` and workflow `--emit-json` stdout contracts remain single JSON object contracts.
16. Default tests remain hermetic and require no real external agent credentials.
17. `QUALITY_REPORT.md` documents implementation evidence, test evidence, migration notes, and remaining risks.

## Non-goals

Do not implement:

- a custom LLM tool-calling loop,
- a database backend,
- cloud or Kubernetes deployment,
- distributed workers,
- full Microsoft Conductor DSL,
- a new autonomous scheduler,
- UI redesign as the main deliverable,
- default real Codex/Claude/Cursor/Gemini/Hermes execution,
- unreviewed LLM auto-apply workflow mutation.
