# Implementation Order: Editable Workbench MVP

Implement in this order.

## Milestone 1: Baseline audit

Deliver:

- confirm existing tests pass;
- inspect current CLI/server/web structure;
- record available modules in PROGRESS.md.

Commands:

```bash
uv run pytest -q
uv run ruff check .
```

## Milestone 2: Capsule scaffold CLI

Deliver:

- blueprint schema;
- scaffold generator;
- `acc capsule scaffold` command;
- generated capsule files;
- tests.

Commands:

```bash
uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force
uv run acc validate demo-research.generic
uv run pytest -q tests/unit/test_capsule_scaffold.py
```

## Milestone 3: Workflow graph schema and validation

Deliver:

- `schemas/workflow_graph_schema.json`;
- `acc workflow validate`;
- cycle detection;
- missing capsule detection;
- tests.

Commands:

```bash
uv run acc workflow validate examples/workflows/demo_two_node.graph.json
uv run pytest -q tests/unit/test_workflow_graph_schema.py
```

## Milestone 4: Local workflow graph runner

Deliver:

- `acc workflow run`;
- topological execution;
- input template resolution;
- workflow_run.json;
- per-node run dirs;
- tests.

Commands:

```bash
uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json
uv run pytest -q tests/integration/test_workflow_graph_runner.py
```

## Milestone 5: Capsule editor API

Deliver:

- capsule scaffold endpoint;
- safe capsule file read/write endpoints;
- capsule validate/test endpoints;
- path traversal protection;
- tests.

Commands:

```bash
uv run pytest -q tests/server/test_capsule_api.py
```

## Milestone 6: Workflow API

Deliver:

- list workflows;
- read workflow graph;
- save workflow graph;
- validate workflow graph;
- run workflow graph;
- tests.

Commands:

```bash
uv run pytest -q tests/server/test_workflow_api.py
```

## Milestone 7: Minimal web shell

Deliver:

- Vite React TypeScript app if no app exists;
- API client;
- basic routes;
- build passes.

Commands:

```bash
cd web && npm install && npm run build
```

## Milestone 8: Capsule Library and Editor UI

Deliver:

- capsule list;
- create capsule form;
- edit prompt/schema/artifact files;
- validate/test capsule buttons.

Commands:

```bash
cd web && npm run build
```

## Milestone 9: Workflow Builder UI

Deliver:

- capsule palette;
- graph canvas;
- add nodes;
- connect nodes;
- edit node input JSON;
- save graph;
- validate graph;
- run graph.

Commands:

```bash
cd web && npm run build
```

## Milestone 10: Run Inspector UI and final acceptance

Deliver:

- workflow run list or link;
- node output viewer;
- artifact viewer;
- logs viewer;
- final acceptance commands pass.

Commands:

```bash
uv run pytest -q
uv run ruff check .
cd web && npm run build
```
