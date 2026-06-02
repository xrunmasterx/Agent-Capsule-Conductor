# ACC Current Architecture

## One-Sentence Model

ACC turns reusable agent/tool/workflow definitions into isolated runtime invocations, moves data only
through explicit ports and artifacts, and exposes local CLI/server/Workbench surfaces without
owning a custom LLM reasoning loop.

## First Principles

The architecture follows four separations:

1. **Definition vs execution**
   - Definition: `AgentClassTemplate`, `ToolClassTemplate`, `WorkflowFunctionTemplate`.
   - Execution: `FunctionInvocation`, `ScopeFrame`, `SessionInstance`, events, manifests, artifacts.

2. **Control dependency vs data dependency**
   - Control edges decide scheduling order.
   - Data edges and workflow-call bindings decide what content is materialized into inboxes/outboxes.

3. **Template state vs runtime state**
   - Templates are reusable and stateless.
   - Runtime evidence lives under run directories and can be inspected or replayed.

4. **Human-governed editing vs agent execution**
   - LLMs may propose callable/workflow changes through GraphOps.
   - Persistent mutation requires validation, dry-run evidence, and human approval.

## Core Data Flow

```text
WorkflowFunctionTemplate
  -> FunctionInvocation
  -> ScopeFrame
  -> NodeInvocationSpec
  -> SessionInstance or child FunctionInvocation
  -> outbox/artifacts/events/manifests
  -> downstream inbox materialization
```

The important rule is that downstream nodes receive data through ACC-owned materialization. Upstream
nodes do not mutate downstream workspaces directly.

## Runtime Boundaries

```text
acc.domain
  pure types and domain records

acc.engine
  pure validation, normalization, dependency analysis, scheduling shape

acc.store
  filesystem manifests, run directories, inbox/outbox, artifacts, path protection

acc.runtime
  process/workspace execution policy

acc.app
  use-case coordination across engine/store/runtime

acc.server
  FastAPI routes over app/store/runtime services

web/
  Workbench UI state, graph projection, inspector views, browser-local task persistence
```

`acc.engine` must not perform filesystem IO, spawn processes, import server/UI modules, or inspect
the host environment. `web/` must not become runtime truth.

## Callable Concepts

| Current concept | Meaning |
| --- | --- |
| `AgentClassTemplate` | Reusable agent behavior class, including runtime, prompt defaults, permissions, and ports. |
| `ToolClassTemplate` | Reusable local/tool behavior class. |
| `WorkflowFunctionTemplate` | Reusable workflow function body with exposed inputs/outputs and graph structure. |
| `NodeInvocationSpec` | A call site inside a workflow function. |
| `FunctionInvocation` | One runtime call of a workflow function. |
| `ScopeFrame` | The invocation's cwd, inbox, outbox, artifact root, environment root, and behavior snapshot evidence. |
| `SessionInstance` | One agent/tool execution inside a scope frame. |

## Legacy Boundary

ACC no longer treats the old runtime architecture as an active product architecture. Legacy inputs
are allowed only at these edges:

```text
raw legacy document -> migration parser -> canonical Core v2 output
raw legacy document -> explicit rejection with migration hint
historical fixture   -> read-only documentation or regression evidence
```

Product runtime, CLI/API execution, Workbench save/run, Debugger projection, and GraphOps apply paths
must consume canonical Core v2 objects. They must not instantiate old runtime classes, load a legacy
registry, run an old graph runtime, or use old node raw fields as execution semantics.

## Workbench Model

The Workbench is a visual projection over ACC APIs and run evidence.

- It can edit resource definitions and task canvases.
- It must keep resource class prompts separate from task node invocation prompts.
- It stores task interaction state locally for usability, but run directories remain evidence truth.
- It uses `/api/workflows/run-graph/submit` for async run submission.
- Multiple tasks/runs must be modeled independently by `run_id` and `task_id`; one global
  `isRunning` singleton is an architectural bug.

### Workbench Run State

The robust mental model is:

```text
task canvas definition
  -> submit run
  -> run_id
  -> run summary/events/artifacts
  -> UI overlay projection for the selected task/run
```

The task canvas should store authoring state: nodes, edges, resource references, invocation prompt,
static input, and bindings. It should not store terminal node status, prior outputs, run ids as
template semantics, or agent memory.

The run directory should store execution evidence: status, events, node input/output, manifests,
artifacts, stdout/stderr logs, and failure information.

The UI may remember convenience pointers such as `activeRunId` and `latestRunId`, but those pointers
are not the evidence itself.

### Async Run APIs

Current Workbench run APIs:

```text
POST /api/workflows/run-graph/submit
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/events
POST /api/runs/{run_id}/cancel
```

`POST /api/workflows/run-graph` remains for synchronous compatibility. New Workbench behavior should
prefer submit + polling so multiple independent task runs can progress without blocking the whole UI.

### Run Statuses

Workbench run projections should understand at least:

```text
not_run
queued
running
success
failed
cancel_requested
cancelled
crashed
```

Terminal runs should stop high-frequency polling. Switching tasks should change the selected
projection, not clear another task's run evidence.

## Runtime Evidence Files

Core v2 workflow/callable evidence includes:

```text
run_record.json
run_summary.json
function_invocation.json
scope_frame.json
events.jsonl
result_store/
workflow_outputs/<port>/output.json
nodes/<node_id>/session_instance_manifest.json
nodes/<workflow_node>/workflow_call_manifest.json
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/output.json
nodes/<node_id>/events.jsonl
nodes/<node_id>/artifact_bundle.json
```

The exact file set can grow additively. New runtime evidence must remain a projection of
`FunctionInvocation`, `ScopeFrame`, `SessionInstance`, `ArtifactBundle`, `ResultStore`, and
`EventLog`; it must not resurrect old `node_runs/` or `workflow_graph.json` source-of-truth files.
Older goal documents may mention `function_invocation_manifest.json`,
`scope_frame_manifest.json`, `workflow_run_manifest.json`, or `workflow_summary.json`; treat those
as historical target names unless the runtime starts writing them again.

## Verification Contract

Default checks:

```bash
uv run pytest -q
uv run ruff check .
```

Workbench checks:

```bash
cd web
npm run test -- --run
npm run build
```

Machine-readable CLI checks must prove stdout contains one JSON object and no logs when JSON emit
flags are used.
