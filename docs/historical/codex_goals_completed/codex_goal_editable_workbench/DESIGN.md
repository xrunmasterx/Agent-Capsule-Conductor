# Editable Workbench MVP Design

## 1. Design philosophy

The existing project is a clean headless runtime:

```text
Capsule Template -> acc run -> Adapter -> output/artifacts
```

The next step is not a fancy product. The next step is a comfortable local authoring layer:

```text
Create capsule -> connect nodes -> run demo -> inspect results
```

The design must preserve separation:

```text
acc-core      = execution runtime
acc-server    = API layer
web           = local UI
workflow graph = editable authoring asset
```

The UI must not directly manipulate core internals. It calls APIs or CLI-backed service functions.

## 2. Architecture

```text
web/ React Workbench
  Capsule Library
  Capsule Editor
  Workflow Builder
  Run Inspector
        |
        v
acc-server FastAPI
  capsules API
  workflows API
  runs API
  artifacts API
        |
        v
acc-core
  registry
  scaffold
  runner
  workflow graph validator
  workflow graph runner
  artifact store
        |
        v
external agents / fake agents
```

## 3. New modules

Recommended Python modules:

```text
acc/
  scaffold.py
  workflow_graph.py
  workflow_runner.py
  server/
    app.py
    routes_capsules.py
    routes_workflows.py
    routes_runs.py
    routes_artifacts.py
```

Recommended web modules:

```text
web/src/
  main.tsx
  app/App.tsx
  api/client.ts
  features/capsules/
  features/workflows/
  features/runs/
  components/JsonEditor.tsx
  components/MarkdownViewer.tsx
  components/GraphCanvas.tsx
```

## 4. Capsule Scaffold design

### 4.1 Purpose

Current custom capsule authoring requires writing many files manually. Scaffold turns a small blueprint into a full capsule directory.

### 4.2 Generation flow

```text
blueprint JSON
  -> validate blueprint
  -> create capsule dir
  -> write capsule.yaml
  -> write prompt_template.md
  -> write input_schema.json
  -> write output_schema.json
  -> write artifact_manifest.yaml
  -> write examples/input.json
  -> run acc validate
```

### 4.3 Runtime defaults

For `generic_cli`, generated capsule may use a fake local helper for demo purposes.

For `codex_cli` and `claude_sdk`, scaffold only creates config; default tests must not execute real external agents.

## 5. Workflow Graph design

### 5.1 Why add graph.json

Conductor YAML is powerful but not friendly as the first UI editing format.

`*.graph.json` is a local authoring format:

- easy for React Flow to edit;
- easy to validate;
- easy to run as a demo;
- can later export to Conductor YAML.

### 5.2 Graph semantics

Keep it minimal:

- static DAG only;
- topological execution;
- no dynamic routing;
- no LLM deciding next node;
- no loops;
- no retries;
- no complex conditionals.

This is not a new autonomous scheduler. It is a deterministic demo runner.

## 6. Graph Runner design

### 6.1 Validate

Validation checks:

- graph schema valid;
- node ids unique;
- edge ids unique;
- all edge endpoints exist;
- all capsule ids exist;
- no cycles;
- static input is object;
- templated input can be rendered with available context.

### 6.2 Run

Execution:

```text
create workflow run dir
for node in topological_order:
  resolve node input
  write node input file
  call existing capsule runner
  collect conductor_output/output.json/artifacts
  update workflow_run.json
```

### 6.3 Output

`workflow_run.json`:

```json
{
  "workflow_id": "demo_two_node",
  "status": "success",
  "nodes": [
    {
      "node_id": "echo",
      "capsule_id": "echo-test.generic",
      "status": "success",
      "output_path": "runs/demo/nodes/echo/output.json",
      "artifact_dir": "runs/demo/nodes/echo/artifacts"
    }
  ]
}
```

## 7. API design

### 7.1 Principles

- API returns normalized JSON for UI.
- API validates before writing.
- API rejects path traversal.
- API must remain local-first.
- API must not require real external agent credentials.

### 7.2 Artifact reading

`GET /api/artifacts/read?path=...` should:

- allow only paths under project root `runs/`, `capsules/`, `workflows/`, or configured safe roots;
- detect file type by extension;
- return text content for md/json/yaml/log/jsonl/txt;
- reject binary or oversized files unless explicitly allowed.

## 8. UI design

### 8.1 Main navigation

```text
Runs
Capsules
Workflows
Demo
Settings
```

### 8.2 Capsule Library

- list capsule cards;
- filter by runtime;
- create new capsule;
- validate capsule;
- test capsule.

### 8.3 Capsule Editor

Tabs:

```text
Overview
Prompt
Input Schema
Output Schema
Artifacts
Example Input
Validate/Test
```

### 8.4 Workflow Builder

Layout:

```text
Left palette: capsules
Center: graph canvas
Right inspector: selected node / edge / workflow
Bottom: run status and logs
```

Required actions:

- add node from capsule;
- connect nodes;
- edit node input JSON;
- save graph;
- validate graph;
- run graph.

### 8.5 Run Inspector

- list workflow run nodes;
- click node;
- show input/resolved_prompt/output/artifacts/logs;
- markdown viewer;
- JSON viewer;
- plain text viewer.

## 9. Demo flow

User should be able to:

```text
1. Start server.
2. Open workbench.
3. Create a demo capsule or use existing echo/fake capsules.
4. Add two nodes.
5. Connect node A to node B.
6. Save graph.
7. Run graph.
8. Inspect node outputs.
```

## 10. Compatibility requirements

Do not break:

- previous `acc run` behavior;
- previous stdout JSON contract;
- previous adapter tests;
- previous artifact directory layout;
- previous hermetic test philosophy.
