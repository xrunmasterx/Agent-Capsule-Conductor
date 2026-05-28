# ACC Callable Semantics: Plain Language

## One sentence

ACC should behave like a small local runtime where agents and tools are reusable classes, workflows are reusable functions, workflow runs are function calls, working directories are call-scope parameters, and every agent/tool execution is a session instance.

## Why this matters

The current Clean Core already has good mechanics:

- workflows do not need to store local workspace paths,
- default runs use run-scoped ephemeral workspaces,
- data moves through outbox -> store/scheduler -> inbox,
- control edges and data edges are separate,
- runtime enforces permission, env, cwd, timeout, and workspace write policy.

The missing part is semantic clarity. Today a node can still mix several ideas:

```text
which class/function it calls
what local overrides it uses
how it runs
what ports it exposes
what legacy raw fields it carries
```

That makes nested workflows, debugging, UI display, and real agent runner integration harder than they need to be.

## The intended model

```text
AgentClassTemplate = reusable agent class
ToolClassTemplate = reusable tool class
WorkflowFunctionTemplate = reusable workflow function
NodeInvocationSpec = a call site inside the workflow function body
FunctionInvocation = one runtime call of a workflow function
ScopeFrame = what that function call can see
SessionInstance = one concrete agent/tool execution
ArtifactBundle = stable data returned or produced by a call
```

## The key safety rule

Templates are reusable and stateless. Runtime state belongs to runs:

```text
template:
  graph, ports, defaults, callable refs

runtime:
  workspace, session ids, outputs, events, artifacts
```

Do not write session memory, run directories, or machine-specific workspace paths back into templates.

## Workflow as function

A workflow should feel like:

```text
function ReviewWorkflow(workspace, input) {
  source_report = SourceAnalyzer(input)
  final_report = MergeTool(source_report)
  return final_report
}
```

When a workflow calls another workflow, the child workflow should receive explicit input ports and return explicit output ports. It should not secretly read the parent scope.

## What changes for users

The old files should still work. The new model gives clearer names and better manifests:

- function invocation manifest,
- scope frame manifest,
- session instance manifest,
- workflow call manifest,
- explicit nested workflow input/output bindings.

This makes debugger and UI views easier to explain:

```text
which function is running
which scope it runs in
which class each node calls
which session was created
which artifacts crossed which ports
```

## What must not change

- `acc run ... --emit-conductor-json` must still emit exactly one JSON object.
- Default tests must stay hermetic.
- Real Codex/Claude/Cursor/Gemini/Hermes credentials must not be required by default.
- ACC must not become a custom LLM agent framework.
- Sender nodes must not write directly into receiver workspaces.

