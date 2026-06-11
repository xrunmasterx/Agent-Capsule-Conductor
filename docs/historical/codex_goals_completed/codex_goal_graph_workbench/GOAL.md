# Goal: Graph-first Editable Workbench

## Objective

Upgrade the current Agent Capsule Workbench from a button/sequence-based editor into a **Chinese-first graph workflow builder**.

The workbench must let a user visually create a workflow by adding capsule nodes, connecting nodes with edges, saving the graph, validating the graph, running a demo graph, and inspecting each node's input/output/artifacts/logs.

This goal is not to build a full Dify/ComfyUI clone. It is to build the smallest useful graph-first workbench on top of the existing `acc` runtime.

## Current problem to fix

The current UI experience is poor because workflow connections are effectively made by buttons or sequence operations. This hides the actual dependency graph. The user cannot clearly see:

- which node depends on which node,
- whether the workflow is serial or parallel,
- where the fan-out/fan-in happens,
- which output feeds which input,
- where failure paths or human gates should appear.

The next version must make the graph itself the primary interaction model.

## Must deliver

1. Chinese-first UI.
2. A real graph canvas with nodes and edges.
3. Capsule palette: add a capsule as a graph node.
4. Edge connection: drag from one node output handle to another node input handle.
5. Node inspector: edit node input mapping, static input, label, and notes.
6. Edge inspector: view or edit dependency semantics.
7. Graph validation: detect missing capsule, invalid edge, cycle, invalid node input mapping.
8. Graph save/load using `workflows/*.graph.json`.
9. Demo workflow: at least one serial graph and one parallel/fan-out graph.
10. Run graph: call existing backend/CLI runner; do not rewrite core runtime.
11. Run inspector: show node status, input, resolved prompt, output, artifacts, logs.
12. Auto layout: provide at least one layout action to make dependencies readable.
13. Tests: unit + integration + UI build tests.

## Non-goals

- Do not rewrite `acc run`.
- Do not rewrite adapters.
- Do not build a custom LLM tool loop.
- Do not build a full autonomous scheduler.
- Do not build a commercial-grade SaaS platform.
- Do not require real Codex/Claude credentials in default tests.
- Do not implement complex collaboration or cloud deployment.

## Completion condition

This goal is complete only when all commands in `docs/codex_goal_graph_workbench/ACCEPTANCE.md` pass, and the user can complete this workflow in the UI:

1. Open Workbench.
2. See Chinese UI.
3. Create or open a demo graph.
4. Add two capsule nodes.
5. Connect node A to node B by dragging an edge.
6. Save graph.
7. Validate graph.
8. Run graph.
9. Inspect each node's input/output/artifacts/logs.
10. Visually understand serial and parallel dependencies from the canvas.
