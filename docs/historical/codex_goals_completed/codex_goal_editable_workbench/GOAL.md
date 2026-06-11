# Goal: Editable Agent Capsule Workbench MVP

## Objective

Implement the next usable layer on top of the existing Agent Capsule Conductor runtime.

The existing system can already run capsules, validate output, store artifacts, and expose run information. This goal must make the system comfortable to use by adding a minimal editable workbench:

1. Create a custom capsule without manually writing every file.
2. Edit the essential capsule files from API/UI.
3. Add capsules as graph nodes.
4. Connect nodes with edges.
5. Save a workflow graph.
6. Run a small deterministic demo workflow.
7. Inspect node inputs, outputs, artifacts, and logs from a simple UI.

This is **not** a full visual product. It is a practical local workbench MVP.

## Must deliver

### 1. Capsule Scaffold

Add CLI/API support to create a capsule from a compact blueprint.

Required CLI:

```bash
uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force
uv run acc capsule scaffold --id demo-note.generic --runtime generic_cli --template simple --force
```

The scaffold command must generate:

```text
capsules/<id>/capsule.yaml
capsules/<id>/prompt_template.md
capsules/<id>/input_schema.json
capsules/<id>/output_schema.json
capsules/<id>/artifact_manifest.yaml
capsules/<id>/examples/input.json
```

### 2. Capsule File Editor API

Expose safe read/write endpoints for capsule files.

Required API shape:

```text
GET  /api/capsules
GET  /api/capsules/{id}
GET  /api/capsules/{id}/files/{file_name}
PUT  /api/capsules/{id}/files/{file_name}
POST /api/capsules/scaffold
POST /api/capsules/{id}/validate
POST /api/capsules/{id}/test
```

Only allow editing whitelisted files:

```text
capsule.yaml
prompt_template.md
input_schema.json
output_schema.json
artifact_manifest.yaml
examples/input.json
```

Reject path traversal.

### 3. Workflow Graph Format

Add a simple graph file format independent of Conductor YAML.

This graph format is for local demo and UI editing. It is not an autonomous scheduler.

Required file type:

```text
workflows/*.graph.json
```

Required schema:

```text
schemas/workflow_graph_schema.json
```

The graph must contain:

- workflow id;
- nodes;
- edges;
- each node's capsule id;
- each node's static input or input mapping;
- optional UI position.

### 4. Local Deterministic Graph Runner

Add a tiny static DAG runner for demo workflows.

Required CLI:

```bash
uv run acc workflow validate examples/workflows/demo_two_node.graph.json
uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/demo_two_node --emit-json
```

The runner must:

- validate graph schema;
- detect missing capsule references;
- detect cycles;
- run nodes in topological order;
- resolve simple input mappings;
- call the existing capsule runner internally;
- write a workflow run summary;
- keep stdout clean when `--emit-json` is used.

It must not implement LLM-based routing, loops, or autonomous graph planning.

### 5. Minimal Editable Workbench UI

Add a minimal local UI if the repo already has a web app. If no web app exists, create a minimal Vite React TypeScript app under `web/`.

Required pages:

1. Capsule Library
   - list capsules;
   - create capsule from simple form;
   - validate capsule;
   - test capsule.

2. Capsule Editor
   - edit `prompt_template.md`;
   - edit `input_schema.json`;
   - edit `output_schema.json`;
   - edit `artifact_manifest.yaml`;
   - save and validate.

3. Workflow Builder
   - show capsule palette;
   - add capsule as node;
   - connect nodes;
   - edit node input JSON;
   - save workflow graph;
   - validate workflow graph;
   - run workflow graph.

4. Run Inspector
   - show workflow run nodes;
   - show per-node input/output/prompt/artifacts/logs;
   - open markdown/json/text artifacts.

The UI can be plain. Prefer clarity over visual polish.

### 6. Demo

Provide a demo path that works without real Codex/Claude credentials.

Required demo:

```text
examples/workflows/demo_two_node.graph.json
```

It should use existing `echo-test.generic` and `fake-agent.generic` or scaffolded fake capsules.

The demo must run through CLI and UI.

## Completion condition

This goal is complete only when every command in `ACCEPTANCE.md` passes.

The final system must support this user path:

```text
Create capsule from UI or CLI
  -> edit prompt/schema
  -> validate capsule
  -> add capsule to workflow graph
  -> connect two nodes
  -> save graph
  -> run graph
  -> inspect artifacts
```

## Constraints

- Keep all previous MVP and workbench tests passing.
- Do not rewrite `acc run` unless a test proves a compatibility issue.
- Do not require real external agent credentials in default tests.
- Do not build a complex UI framework beyond the minimum necessary.
- Do not introduce database persistence; file-based persistence is enough.
- Do not implement AI auto-apply graph editing.
- Do not implement complex conditionals or loops in the graph runner.

## Blocked stop condition

If the current repo lacks a server or UI foundation, implement the smallest FastAPI + Vite React shell required for this goal. Do not stop because no UI exists.

If a frontend dependency cannot be installed, implement CLI/API functionality first and record the UI gap in `INTEGRATION_GAPS.md`.
