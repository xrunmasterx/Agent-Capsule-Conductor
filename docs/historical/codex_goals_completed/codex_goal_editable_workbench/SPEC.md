# Editable Workbench MVP Spec

## 1. Product definition

Editable Workbench MVP is the first practical authoring layer for Agent Capsule Conductor.

It adds:

- capsule scaffolding;
- safe capsule file editing;
- simple workflow graph editing;
- local deterministic graph running;
- minimal read/write UI.

It does not replace the existing `acc` runtime.

## 2. Non-goals

Do not implement:

- a full low-code AI platform;
- a custom agent loop;
- a complex autonomous scheduler;
- multi-user permission system;
- database-backed persistence;
- cloud deployment;
- AI auto-apply workflow modification;
- complex graph semantics such as loops, retries, or condition branches.

## 3. Capsule Scaffold

### 3.1 Blueprint input

A blueprint is a compact JSON object:

```json
{
  "id": "demo-note.generic",
  "name": "Demo Note Capsule",
  "runtime": "generic_cli",
  "workspace_mode": "existing_dir",
  "description": "Generate a simple note from a topic.",
  "input_fields": [
    {"name": "topic", "type": "string", "required": true}
  ],
  "output_fields": [
    {"name": "summary", "type": "string", "required": true}
  ],
  "artifacts": [
    {"name": "report", "path": "artifacts/report.md", "type": "markdown", "required": true}
  ],
  "prompt": "Write a concise report about {{ topic }}."
}
```

### 3.2 Generated files

The scaffold command must generate:

```text
capsules/<id>/capsule.yaml
capsules/<id>/prompt_template.md
capsules/<id>/input_schema.json
capsules/<id>/output_schema.json
capsules/<id>/artifact_manifest.yaml
capsules/<id>/examples/input.json
```

### 3.3 Validation

After scaffolding, `uv run acc validate <id>` must pass.

## 4. Capsule Editor API

### 4.1 Safe file read

```text
GET /api/capsules/{id}/files/{file_name}
```

Allowed file names:

```text
capsule.yaml
prompt_template.md
input_schema.json
output_schema.json
artifact_manifest.yaml
examples/input.json
```

### 4.2 Safe file write

```text
PUT /api/capsules/{id}/files/{file_name}
```

Request:

```json
{
  "content": "..."
}
```

The server must:

- reject path traversal;
- write atomically where practical;
- validate JSON files after save;
- return validation errors clearly;
- never write outside the capsule directory.

## 5. Workflow Graph

### 5.1 File format

Workflow graph files live under:

```text
workflows/*.graph.json
examples/workflows/*.graph.json
```

Schema:

```text
schemas/workflow_graph_schema.json
```

### 5.2 Example

```json
{
  "id": "demo_two_node",
  "version": "0.1.0",
  "name": "Demo Two Node Workflow",
  "nodes": [
    {
      "id": "echo",
      "capsule_id": "echo-test.generic",
      "input": {"message": "hello"},
      "position": {"x": 0, "y": 0}
    },
    {
      "id": "fake",
      "capsule_id": "fake-agent.generic",
      "input": {
        "message": "{{ nodes.echo.output.summary }}"
      },
      "position": {"x": 320, "y": 0}
    }
  ],
  "edges": [
    {"id": "edge_echo_fake", "from": "echo", "to": "fake"}
  ]
}
```

## 6. Graph Runner

### 6.1 Required commands

```bash
uv run acc workflow validate <graph.json>
uv run acc workflow run <graph.json> --run-dir <run_dir> --emit-json
```

### 6.2 Execution rules

- Run nodes in topological order.
- No loops.
- No conditionals.
- No dynamic agent routing.
- No implicit external agent calls beyond the referenced capsules.
- Resolve simple Jinja-style templates using context:

```text
workflow.input
nodes.<node_id>.output
nodes.<node_id>.output_path
nodes.<node_id>.artifact_dir
```

### 6.3 Run output

Graph runner writes:

```text
<run_dir>/workflow_run.json
<run_dir>/nodes/<node_id>/...
```

`workflow_run.json` includes:

- workflow id;
- status;
- nodes;
- edges;
- per-node status;
- output paths;
- artifact dirs;
- errors.

## 7. API endpoints

If an API server exists, extend it. If not, create minimal FastAPI server.

Required:

```text
GET  /api/health
GET  /api/capsules
GET  /api/capsules/{id}
POST /api/capsules/scaffold
GET  /api/capsules/{id}/files/{file_name}
PUT  /api/capsules/{id}/files/{file_name}
POST /api/capsules/{id}/validate
POST /api/capsules/{id}/test

GET  /api/workflows
GET  /api/workflows/{id}
POST /api/workflows
PUT  /api/workflows/{id}
POST /api/workflows/{id}/validate
POST /api/workflows/{id}/run

GET  /api/runs
GET  /api/runs/{id}
GET  /api/runs/{id}/nodes/{node_id}
GET  /api/artifacts/read?path=...
```

## 8. UI requirements

The UI should be minimal and usable.

Layout:

```text
Left: navigation / capsule palette
Center: editor or graph canvas
Right: inspector
Bottom: run output / logs
```

Required features:

- create capsule from form;
- edit capsule prompt/schema/artifact manifest;
- validate capsule;
- add capsule node to graph;
- connect nodes;
- edit node input JSON;
- save graph;
- validate graph;
- run graph;
- inspect node output and artifacts.

## 9. Backward compatibility

All previous acceptance commands must still pass.
