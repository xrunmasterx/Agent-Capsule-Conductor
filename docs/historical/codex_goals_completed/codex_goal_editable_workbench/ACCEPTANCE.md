# Editable Workbench MVP Acceptance Criteria

The goal is complete only when all required criteria pass.

## 1. Existing baseline still passes

These must still pass:

```bash
uv run pytest -q
uv run ruff check .
```

Existing MVP commands must remain compatible:

```bash
uv run acc list
uv run acc show echo-test.generic
uv run acc validate echo-test.generic
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_echo_regression --emit-conductor-json
```

## 2. Capsule scaffold works

Run:

```bash
uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force
uv run acc validate demo-research.generic
```

Acceptance:

```text
capsules/demo-research.generic/capsule.yaml exists
capsules/demo-research.generic/prompt_template.md exists
capsules/demo-research.generic/input_schema.json exists
capsules/demo-research.generic/output_schema.json exists
capsules/demo-research.generic/artifact_manifest.yaml exists
capsules/demo-research.generic/examples/input.json exists
acc validate demo-research.generic exits 0
```

## 3. Scaffolded capsule can run

Run:

```bash
uv run acc run demo-research.generic --input capsules/demo-research.generic/examples/input.json --run-dir runs/acceptance_demo_capsule --emit-conductor-json
```

Acceptance:

```text
stdout is exactly one JSON object
status is success
output_path exists
artifact_dir exists
event_log exists
required artifacts exist
```

## 4. Workflow graph validates

Run:

```bash
uv run acc workflow validate examples/workflows/demo_two_node.graph.json
```

Acceptance:

```text
exit code 0
all node capsule references resolve
no cycles
all edge endpoints exist
```

## 5. Workflow graph runs

Run:

```bash
uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json
```

Acceptance:

```text
stdout is exactly one JSON object
workflow status is success
runs/acceptance_demo_graph/workflow_run.json exists
node run dirs exist
node outputs exist
node artifacts exist
```

## 6. API server tests pass

If the server exists or is created, these must pass:

```bash
uv run pytest -q tests/server
```

Required endpoint behavior:

```text
GET /api/health returns ok
GET /api/capsules returns capsules
POST /api/capsules/scaffold creates capsule
GET /api/capsules/{id}/files/prompt_template.md reads prompt
PUT /api/capsules/{id}/files/prompt_template.md writes prompt
path traversal is rejected
GET /api/workflows returns workflows
POST /api/workflows saves graph
POST /api/workflows/{id}/validate validates graph
POST /api/workflows/{id}/run runs graph
```

## 7. Web build passes

If web exists or is created:

```bash
cd web && npm install && npm run build
```

Acceptance:

```text
build exits 0
Capsule Library route exists
Capsule Editor route exists
Workflow Builder route exists
Run Inspector route exists
```

## 8. Minimal UI user path exists

The UI must support the path below. It does not need full e2e automation unless practical, but the implementation must expose the actions clearly.

```text
Create capsule
Edit prompt/schema
Validate capsule
Add capsule node to workflow
Connect two nodes
Save graph
Validate graph
Run graph
Inspect output/artifacts/logs
```

## 9. No scope creep

The project must not introduce:

```text
custom LLM agent loop
complex autonomous scheduler
database persistence requirement
cloud deployment
AI auto-apply workflow edits
real external agent dependency in default tests
```

## 10. Documentation

Required docs must be updated or created:

```text
docs/codex_goal_editable_workbench/PROGRESS.md
docs/codex_goal_editable_workbench/INTEGRATION_GAPS.md
README or docs explaining how to launch the workbench
```
