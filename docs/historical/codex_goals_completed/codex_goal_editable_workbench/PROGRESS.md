# Progress Log: Editable Workbench MVP

Codex should update this file after each milestone.

## Template

```text
Milestone:
Status:
Files changed:
Tests run:
Result:
Next step:
Blocked by:
```

```text
Milestone: 1 Baseline audit
Status: Complete
Files changed: None
Tests run: uv run pytest -q; uv run ruff check .; cd web && npm test
Result: Baseline passed before Editable Workbench implementation
Next step: Capsule scaffold CLI/core
Blocked by: None
```

```text
Milestone: 2 Capsule scaffold CLI
Status: Complete
Files changed: acc/scaffold.py, acc/scaffold_runtime.py, acc/cli.py, acc/prompting.py, acc/adapters/generic_cli.py, tests/unit/test_capsule_scaffold.py
Tests run: uv run pytest -q tests/unit/test_capsule_scaffold.py; uv run ruff check related files
Result: Scaffold generation, validation, duplicate handling, path validation, and hermetic run pass
Next step: Workflow graph schema and validation
Blocked by: None
```

```text
Milestone: 3-4 Workflow graph validation and local graph runner
Status: Complete
Files changed: acc/workflow_graph.py, acc/workflow_runner.py, acc/cli.py, examples/workflows/demo_two_node.graph.json, tests/unit/test_workflow_graph_schema.py, tests/integration/test_workflow_graph_runner.py
Tests run: uv run pytest -q tests/unit/test_workflow_graph_schema.py tests/integration/test_workflow_graph_runner.py; uv run acc workflow validate examples/workflows/demo_two_node.graph.json; uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json
Result: Static DAG validation, cycle detection, missing capsule/edge validation, template mapping, and workflow_run.json generation pass
Next step: Capsule editor and workflow API
Blocked by: None
```

```text
Milestone: 5-6 Capsule editor API and Workflow API
Status: Complete
Files changed: acc/server/routes/capsules.py, acc/server/routes/workflows.py, tests/server/test_capsules_api.py, tests/server/test_workflows_api.py
Tests run: uv run pytest -q tests/server; uv run ruff check related files
Result: Scaffold endpoint, safe capsule file read/write, workflow graph save/validate/run, and path traversal tests pass
Next step: Editable Workbench UI
Blocked by: None
```

```text
Milestone: 7-10 Minimal web shell, Capsule Library/Editor, Workflow Builder, Run Inspector, final acceptance
Status: Complete
Files changed: web/src/App.tsx, web/src/api.ts, web/src/types.ts, web/src/components/CapsuleBrowser.tsx, web/src/components/WorkflowViewer.tsx, web/src/App.test.tsx, web/src/styles.css, README.md
Tests run: uv run pytest -q; uv run ruff check .; uv run acc list; uv run acc show echo-test.generic; uv run acc validate echo-test.generic; uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_echo_regression --emit-conductor-json; uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force; uv run acc capsule scaffold --id demo-note.generic --runtime generic_cli --template simple --force; uv run acc validate demo-research.generic; uv run acc run demo-research.generic --input capsules/demo-research.generic/examples/input.json --run-dir runs/acceptance_demo_capsule --emit-conductor-json; uv run acc workflow validate examples/workflows/demo_two_node.graph.json; uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json; uv run pytest -q tests/server; cd web && npm test; cd web && npm run build; old MVP smoke commands for fake-agent, batch-run, and GraphOps dry-run
Result: Editable Workbench MVP acceptance passed; Python tests 139 passed; server tests 29 passed; UI tests 7 passed; web build passed; ruff passed
Next step: None
Blocked by: None
```

```text
Milestone: Final audit hardening
Status: Complete
Files changed: acc/scaffold.py, acc/server/routes/capsules.py, acc/server/routes/workflows.py, examples/blueprints/simple_research_capsule.json, tests/server/test_capsules_api.py, tests/unit/test_capsule_scaffold.py, docs/codex_goal_editable_workbench/PROGRESS.md
Tests run: uv run pytest -q; uv run ruff check .; uv run acc list; uv run acc show echo-test.generic; uv run acc validate echo-test.generic; uv run acc validate fake-agent.generic; uv run acc validate workflow-editor.codex; uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_echo_regression --emit-conductor-json; uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force; uv run acc capsule scaffold --id demo-note.generic --runtime generic_cli --template simple --force; uv run acc validate demo-research.generic; uv run acc run demo-research.generic --input capsules/demo-research.generic/examples/input.json --run-dir runs/acceptance_demo_capsule --emit-conductor-json; uv run acc workflow validate examples/workflows/demo_two_node.graph.json; uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/acceptance_demo_graph --emit-json; uv run pytest -q tests/server; uv run acc inspect runs/workbench_acceptance_fake --json; uv run acc capsule doctor echo-test.generic; uv run acc capsule test echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/workbench_acceptance_capsule_test --emit-conductor-json; uv run acc server --host 127.0.0.1 --port 8765 with HTTP health/version checks; cd web && npm test; cd web && npm run build
Result: All goal acceptance remains passing; Python tests 140 passed; server tests 30 passed; UI tests 7 passed; web build passed; ruff passed. Scaffold API no longer writes a project-root temp file, workflow API avoids broad exception catching, and generated demo capsule directories were removed from source control.
Next step: None
Blocked by: None
```
