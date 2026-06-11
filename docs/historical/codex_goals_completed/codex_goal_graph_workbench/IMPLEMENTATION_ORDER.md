# Implementation Order: Graph Workbench

## Milestone 1: Chinese UI pass

Deliver:

- Centralized i18n dictionary.
- Default locale zh-CN.
- Chinese labels for main pages, buttons, status, validation messages.

Tests:

- UI renders required Chinese labels.
- Build passes.

## Milestone 2: WorkflowGraph model

Deliver:

- Pydantic/TypeScript graph schema.
- `workflows/*.graph.json` support.
- Graph validate command/API.
- Cycle detection and edge validation.

Tests:

- schema tests
- cycle tests
- invalid edge tests

## Milestone 3: Graph canvas

Deliver:

- React Flow canvas or equivalent.
- Capsule palette.
- Add node.
- Drag edge between node handles.
- Save graph JSON.
- Load graph JSON.

Tests:

- canvas renders nodes/edges.
- adding node changes graph.
- connecting nodes changes graph.

## Milestone 4: Node and edge inspector

Deliver:

- Node inspector.
- Edge inspector.
- Static input editor.
- Mapping editor.
- Validation error panel.

Tests:

- select node shows inspector.
- edit input updates graph.
- select edge shows mapping.

## Milestone 5: Auto layout

Deliver:

- Auto layout button.
- Use ELK/Dagre or a deterministic fallback.
- Serial and parallel demo graphs become readable.

Tests:

- layout updates node positions.

## Milestone 6: Graph runner integration

Deliver:

- `acc workflow validate` if missing.
- `acc workflow run` if missing.
- API/UI run action calls existing runtime.
- Workflow run summary.

Tests:

- demo serial graph runs.
- demo parallel graph runs.
- workflow_run.json exists.

## Milestone 7: Run inspector integration

Deliver:

- node status on graph.
- click node shows input/output/artifacts/logs.
- error highlighting.

Tests:

- inspector loads node run detail.

## Milestone 8: Demo and docs

Deliver:

- `demo_serial.graph.json`
- `demo_parallel.graph.json`
- README update
- acceptance commands pass
