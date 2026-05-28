# ACC Callable Semantics Spec

## 1. Product definition

ACC is a local-first callable runtime for deterministic agent workflows. It executes reusable workflow functions by binding them to runtime scope frames, instantiating agent/tool sessions, and moving data through explicit ports, inboxes, outboxes, and artifact bundles.

## 2. Core terms

### AgentClassTemplate

A reusable agent class definition. It describes behavior but does not execute.

Required semantics:

- stable id and version,
- mature runtime type,
- default prompt/rules/skills/behavior pack,
- input and output port contracts,
- default permission profile,
- artifact contract,
- no session state,
- no run directory,
- no local absolute workspace path.

### ToolClassTemplate

A reusable tool class definition. It describes deterministic or local tool behavior.

Required semantics:

- stable id and version,
- runner type,
- input and output port contracts,
- default permission profile,
- artifact contract,
- no invocation state.

### WorkflowFunctionTemplate

A saved reusable workflow function.

It contains:

- id and version,
- exposed inputs,
- exposed outputs,
- node invocation specs,
- control edges,
- data edges,
- workflow policies,
- metadata.

It must not contain runtime session state or local absolute workspace paths.

### NodeInvocationSpec

One call site inside a workflow function body.

It contains:

- node id,
- callable reference,
- local overrides,
- input bindings,
- output bindings,
- environment policy,
- retry policy,
- timeout policy,
- port declarations if needed for compatibility.

### CallableOverride

Local override applied by one node invocation to a reusable callable template.

It may contain:

- prompt override,
- permission override,
- timeout override,
- retry override,
- static input defaults,
- behavior-pack overlay.

It must not contain session memory, run directories, or machine-specific workspace paths.

### WorkflowCallBinding

Binding from the parent invocation into a child workflow function input.

It answers:

```text
which parent data becomes which child exposed input
```

### WorkflowReturnBinding

Binding from a child workflow function output back into the parent workflow-node output port.

It answers:

```text
which child exposed output becomes which parent workflow-node outbox port
```

### FunctionInvocation

One runtime call of a workflow function.

It contains:

- invocation id,
- run id,
- workflow function id,
- parent invocation id,
- root scope frame id,
- input payload,
- status,
- timestamps,
- manifest paths.

### ScopeFrame

The runtime scope of a function invocation.

It contains:

- frame id,
- invocation id,
- parent frame id,
- call depth,
- workflow id,
- workspace root,
- environment root,
- inbox root,
- outbox root,
- artifact root,
- behavior snapshot path,
- ephemeral flag,
- binding path.

### SessionInstance

One runtime agent/tool execution.

It contains:

- session id,
- invocation id,
- scope frame id,
- node id,
- callable reference,
- callable kind,
- cwd,
- env keys,
- input path,
- output path,
- artifact dir,
- event log path,
- status,
- timestamps,
- error.

## 3. Compatibility

Existing `.accflow.json` must continue to work.

Legacy node fields normalize as follows:

```text
kind: agent + runtime      -> callable_ref kind=agent_class
kind: tool + tool          -> callable_ref kind=tool_class
kind: workflow + workflow_ref -> callable_ref kind=workflow_function
prompt                    -> local override
permission_profile        -> invocation permission override
ports                     -> invocation visible port contracts
raw legacy fields         -> compatibility metadata only
```

Existing capsule templates remain supported. A compatibility adapter may expose them as class templates:

```text
CapsuleSpec(kind=agent_session) -> AgentClassTemplate
CapsuleSpec(kind=atomic)        -> ToolClassTemplate or legacy capsule callable
CapsuleSpec(kind=acc_workflow)  -> WorkflowFunctionTemplate compatibility wrapper
```

## 4. Workflow function call semantics

Nested workflow calls must use explicit function-call boundaries:

```text
parent workflow node input/inbox
  -> child workflow exposed inputs
  -> child internal nodes
  -> child workflow exposed outputs
  -> parent workflow-node outbox
  -> downstream inbox
```

Forbidden:

- parent edges referencing child internal nodes,
- child reading parent data that was not bound to a child exposed input,
- child writing directly into parent or downstream workspace,
- sender writing directly into receiver inbox/workspace.

## 5. Environment semantics

Workflow functions are saved statelessly. Runtime workspace is a call parameter:

```text
WorkflowFunctionTemplate + input + binding -> FunctionInvocation + ScopeFrame
```

Default behavior:

- no explicit binding creates a run-scoped ephemeral workspace,
- explicit binding may use a user workspace,
- nested workflow inherits parent workspace only when policy says so,
- stateful-in-stateful nesting is rejected by default.

## 6. Public behavior to preserve

- `uv run pytest -q` passes.
- `uv run ruff check .` passes.
- Default tests remain hermetic.
- `acc run ... --emit-conductor-json` stdout is exactly one JSON object.
- `acc workflow run ... --emit-json` stdout is exactly one JSON object.
- Existing core examples continue to validate/run or have documented migrations.
- GraphOps remains proposal/validation/dry-run/human-approval-first.
