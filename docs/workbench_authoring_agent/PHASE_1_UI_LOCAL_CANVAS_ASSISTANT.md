# Phase 1 - UI-Local Canvas Assistant

## Decision

Phase 1 builds a Workbench-side authoring assistant that applies AI-generated edits only to the
current browser-local task canvas draft. It does not automatically write `workflows/` or
`callables/`.

The key invariant is:

```text
AI proposal -> user review -> apply to WorkspaceCanvasModel draft
  -> existing save/run paths
```

## Embedded Phase 0 Guardrail - Authoring IR and Safety Contract

Although this roadmap is organized into four delivery phases, Phase 1 must first define the
authoring intermediate representation (IR). This is the safety contract that keeps the AI from
becoming a hidden workflow writer.

The authoring agent may output only:

```text
CanvasAuthoringProposal
GraphOpsTransactionProposal
questions / confirmations / approval requests
```

It must not directly call persistent mutation endpoints such as:

```text
POST /api/workflows
PUT /api/workflows/*
POST /api/callables/agents
PUT /api/callables/agents/*
GraphOps apply
filesystem writes
```

Phase 1 implements only `CanvasAuthoringProposal`. The proposal is inert data until the UI validates
it and applies it through the same canvas command semantics used by human edits.

The assistant must not create a second workflow editor. It must reuse the same canvas command
semantics that human drag/drop, node editing, and connection editing already use in
`web/src/components/WorkflowViewer.tsx`.

## Problem Being Solved

The user wants to describe a task in natural language and have ACC create a runnable workflow draft:

- create task canvas nodes from existing agent/tool/workflow templates;
- fill invocation-scoped data such as user prompt, static input, bindings, and `output_schema`;
- connect nodes using control edges and data edges;
- run the draft through the same Workbench run path as a manually assembled workflow;
- optionally draft new agent templates, but not silently persist them.

Phase 1 is intentionally UI-local because current GraphOps apply is dry-run only, and because the
fastest useful path is matching the human canvas authoring experience first.

## Non-Goals

- Do not auto-write `workflows/*.accflow.json`.
- Do not auto-write `callables/agents/*.yaml`.
- Do not give the assistant direct filesystem write, shell write, or Git mutation ability.
- Do not manipulate the browser DOM as a substitute for canvas model operations.
- Do not write runtime evidence, node statuses, `run_id`, logs, `input.json`, or `output.json` into
  workflow templates.
- Do not treat `output.json` as authoring input. The authoring-time concept is `output_schema`.

## Existing Code Anchors

- `web/src/components/WorkflowViewer.tsx`
  - `WorkspaceCanvasModel`, `WorkflowContainerModel`, `InternalNodeView`, `CanvasSelection`.
  - `canvasToWorkflowGraph()`: converts canvas draft to workflow graph.
  - `stripRuntimeStateFromCanvas()`: prevents runtime projection from being saved.
  - `addCallableNodeFromPalette()` / `addInternalNodeFromPalette()`: human-equivalent node creation.
  - `createDataEdgeCommand()`: data-edge creation and validation rules.
  - `runWorkflowGraph()`: async submit and polling path.
- `web/src/components/workflow-viewer/runState.ts`
  - run overlay projection and runtime-state stripping.
- `web/src/api.ts`
  - `submitGraphRun()`, `saveWorkflow()`, `runEvents()`.
- `acc/server/routes/workflows.py`
  - `/api/workflows/run-graph/submit` writes runtime specs under `runs/_workflow_function_specs/`.
- `acc/app/workbench_adapter.py`
  - compiles Workbench drafts into Core v2 root and child workflow templates.

## UX Placement

Add the assistant as a right-side Workbench drawer:

```text
chrome.rightPanel = "assistant"
```

It should live inside `WorkflowViewer`, not `App`, because it needs:

- `activeTaskId` and `currentTask`;
- the authoring `canvas`, not `displayCanvas`;
- `selection`, `selectedWorkflow`, `selectedInternalNode`, `selectedEdge`, `selectedPort`;
- callable and workflow catalogs;
- selected run evidence summaries when available;
- access to existing canvas update helpers.

The bottom selection/details/evidence dock should remain focused on node details and run evidence.
The assistant drawer owns conversation, proposal preview, and apply controls.

## Context Snapshot

Every assistant request captures a stable snapshot:

```json
{
  "snapshot_id": "sha256:...",
  "task_id": "task_canvas_default",
  "target": {
    "kind": "task_canvas | workflow | internal_node | edge | port",
    "workflow_id": "optional",
    "node_id": "optional",
    "edge_id": "optional",
    "port_id": "optional"
  },
  "canvas": {},
  "canonical_graph": {},
  "selection": {},
  "callable_catalog": [],
  "workflow_catalog": [],
  "run_evidence_summary": {}
}
```

`canonical_graph` is produced from:

```text
canvasToWorkflowGraph(stripRuntimeStateFromCanvas(canvas))
```

The assistant may inspect `displayCanvas` for user-visible status, but all mutations must target the
authoring `canvas`. Applying a proposal must fail if `task_id` or `snapshot_id` no longer matches
the current canvas.

## Proposal Model

Phase 1 uses `CanvasAuthoringProposal`, not GraphOps apply.

```json
{
  "proposal_id": "canvas_proposal_001",
  "base_task_id": "task_canvas_default",
  "base_canvas_hash": "sha256:...",
  "rationale": "Create a research-review-synthesis workflow draft.",
  "operations": [
    {
      "op": "add_node",
      "scope_workflow_id": null,
      "kind": "agent",
      "id": "researcher",
      "callable_id": "researcher.codex",
      "label": "Researcher",
      "input": {
        "user_prompt": "Collect source facts and produce a structured report."
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "report_markdown": { "type": "string" }
        },
        "required": ["report_markdown"]
      }
    },
    {
      "op": "add_data_edge",
      "scope_workflow_id": null,
      "from": { "node": "researcher", "port": "main" },
      "to": { "node": "reviewer", "port": "main" },
      "materialization": "copy"
    }
  ]
}
```

`scope_workflow_id = null` means the root canvas. A non-null value means the operation targets an
inline workflow container's `internalNodes` / `internalEdges`.

## Field Semantics

The assistant must use the same fields as the current Core v2 and Workbench model. Do not invent
parallel names just because natural language uses different words.

| User intent | Authoring target |
| --- | --- |
| Change the reusable agent's system or method prompt | `AgentClassTemplate.default_prompt`; this is a resource-class change and requires persistence approval |
| Set this node's task prompt | `NodeInvocationSpec.prompt_policy.user_prompt` |
| Fill fixed invocation input | `NodeInvocationSpec.overrides.static_input` |
| Bind workflow input into a node | `workflow_input_bindings` |
| Bind upstream node output into downstream node input | `node.input_bindings` or `data_edges` |
| Bind a workflow function call input | `workflow_call_input_bindings` |
| Bind a workflow function call output | `workflow_call_output_bindings` |
| Declare workflow outputs | `workflow_output_bindings` |
| Constrain an agent output shape | `output_schema` or `artifact_contract.output_schema` |
| Read a node's produced result | runtime evidence such as `nodes/<id>/output.json` |

`output_schema` is authoring-time structure. `output.json` is runtime evidence. The assistant must
not ask the user to fill `output.json`.

Recommended schema precedence:

```text
NodeInvocationSpec.output_schema
  -> AgentClassTemplate.artifact_contract.output_schema
  -> default main-output schema
```

Non-`main` output ports must be declared in the schema. The assistant should not use
`output_bindings` as the primary way to move data into downstream nodes. Runtime input composition
comes from workflow input bindings, node input bindings, data edges, and control-edge main-output
fallback rules.

## Supported Operations

Phase 1 should support only the operations that can be mapped to existing human-equivalent canvas
logic:

```text
add_node
add_workflow_container
update_invocation_label
update_invocation_input
update_output_schema
set_ports
add_control_edge
add_data_edge
remove_edge
create_temporary_agent_template
replace_temporary_template_with_existing_callable
```

Each operation must be typed enough that the UI does not need to infer whether an edge is control or
data.

## Temporary Resource Drafts

AI-created agent templates in Phase 1 are temporary until approved.

Recommended states:

| State | Meaning |
| --- | --- |
| `draft` | AI proposed a new agent/tool template payload; the user may edit or discard it |
| `unresolved` | a canvas node references the draft, but the default backend callable registry cannot resolve it |
| `approved_for_canvas` | the user allowed the draft to appear on the current canvas only |
| `pending_save` | the workflow is complete enough to ask whether the draft should become a durable resource |
| `saved` | the user approved persistence and the resource exists in the callable registry |
| `discarded` | the user rejected the draft; referencing nodes must be rebound, kept non-runnable, or deleted |

Temporary resource drafts may appear in the resource palette and be referenced visually in the
current task canvas, but they are not durable callable resources.

Temporary IDs may use UI-only IDs such as `tmp_agent_<uuid>`. Persistent callable IDs must still use
the same safe identifier rules as human-created resources. Do not encode paths, absolute workspace
locations, run IDs, or `draft:<id>` strings into persistent IDs.

## Run-Local Overlay Is Deferred

Phase 1 temporary resources are not runnable by default.

Running a canvas that references temporary agent templates must be gated with one of these user
visible outcomes:

- option A: ask the user to persist the drafted template first;
- option B: ask the user to replace it with an existing callable;
- option C: keep it temporary and block run/save.

Phase 1 should prefer option A or B. It must not invent a hidden runtime registry for temporary
callables because the current backend callable discovery resolves real callables from
`callables/agents/*.yaml` and `callables/tools/*.yaml`.

If the product later needs "run before saving", that is a separate server feature: the submit
payload must carry `temporary_callables`, the run must build a run-scoped callable overlay, and the
run record must snapshot the behavior under `runs/<run_id>/...`. Without that explicit backend
overlay, temporary template nodes stay unresolved and non-runnable.

## Human Approval Points

The assistant must interrupt and ask for confirmation when:

- creating a persistent agent template;
- saving a workflow template;
- replacing an existing canvas with a generated proposal;
- running a graph with real external agents enabled;
- applying a proposal whose `base_canvas_hash` is stale.

For Phase 1, approvals are UI-level confirmations. Persistent resource creation may still use the
same backend endpoint a human uses, but only after explicit user action.

## Run Flow

After a proposal is applied to the canvas draft, running should use the existing path:

```text
runGraph()
  -> runWorkflowGraph()
  -> api.submitGraphRun()
  -> POST /api/workflows/run-graph/submit
  -> run evidence under runs/<run_id>
```

The assistant does not write `input.json` or `output.json`. Those are runtime evidence files. It can
define invocation input and `output_schema`, then the runtime produces evidence.

## Validation

Before applying a proposal:

- verify `base_task_id` and `base_canvas_hash`;
- verify referenced callable IDs exist or are temporary drafts;
- verify node IDs are unique within the target scope;
- verify data edges reference existing ports;
- verify control edges do not carry data context;
- verify temporary resources are not silently treated as persisted resources.

After applying a proposal:

- call `canvasToWorkflowGraph(stripRuntimeStateFromCanvas(canvas))`;
- compile or validate the draft through the same server boundary used by save/run when feasible;
- surface validation errors in the assistant drawer.

## Acceptance Criteria

- From an empty task, the assistant can propose two existing agent/tool nodes, fill
  `user_prompt`, define `output_schema`, connect them, and apply the draft.
- Applying a proposal uses the same canvas model path as human edits.
- A stale proposal is rejected when the canvas changed since generation.
- A canvas containing temporary agent templates cannot run or save silently.
- Running an applied draft uses `/api/workflows/run-graph/submit`.
- Saved reusable workflow templates do not contain runtime status, run IDs, logs, absolute workspace
  paths, `input.json`, or `output.json`.

## Tests

Frontend:

```bash
cd web
npm run test -- --run
npm run build
```

Focused tests should cover:

- `CanvasAuthoringProposal` reducer behavior;
- root and internal workflow scopes;
- stale `base_canvas_hash`;
- temporary resource gating, including unresolved/non-runnable temporary nodes;
- `output_schema` vs runtime `output.json`;
- prompt/static input/output schema field separation;
- run submit path remains `/api/workflows/run-graph/submit`.

Backend focused checks should include Workbench compile behavior:

```bash
uv run pytest -q tests/unit/test_workbench_adapter.py tests/server/test_workbench_core_v2_api.py
```
