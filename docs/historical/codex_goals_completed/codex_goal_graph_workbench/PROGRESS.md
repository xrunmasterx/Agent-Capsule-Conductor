# Progress Log: Graph Workbench

```text
Milestone: 1-7 Chinese UI, WorkflowGraph model, React Flow canvas, inspectors, auto layout, graph runner integration
Status: Complete
Files changed: acc/workflow_graph.py, acc/workflow_runner.py, schemas/workflow_graph_schema.json, examples/workflows/demo_serial.graph.json, examples/workflows/demo_parallel.graph.json, web/package.json, web/package-lock.json, web/src/App.tsx, web/src/types.ts, web/src/api.ts, web/src/i18n/zh-CN.ts, web/src/components/WorkflowViewer.tsx, web/src/components/RunList.tsx, web/src/components/RunInspector.tsx, web/src/components/CapsuleBrowser.tsx, web/src/components/ArtifactViewer.tsx, web/src/styles.css, web/src/test/setup.ts, web/src/App.test.tsx, tests/unit/test_workflow_graph_schema.py, tests/integration/test_workflow_graph_runner.py
Tests run: uv run acc workflow validate examples/workflows/demo_serial.graph.json; uv run acc workflow validate examples/workflows/demo_parallel.graph.json; uv run acc workflow run examples/workflows/demo_serial.graph.json --run-dir runs/acceptance_graph_serial --emit-json; uv run acc workflow run examples/workflows/demo_parallel.graph.json --run-dir runs/acceptance_graph_parallel --emit-json; uv run pytest -q tests/server tests/unit/test_workflow_graph_schema.py tests/integration/test_workflow_graph_runner.py; uv run ruff check related files; cd web && npm test; cd web && npm run build
Result: Graph schema accepts v2 node/edge fields, validation catches self edges/missing required input/invalid mappings, input_mapping feeds runtime input, demo serial and parallel graphs run successfully, and the web workflow builder is now a Chinese-first React Flow canvas with draggable edge handles, node/edge inspector, auto layout, save/validate/run, and run artifact/log path inspection.
Next step: Run full Graph Workbench acceptance and full regression.
Blocked by: None
```

```text
Milestone: 8 Final acceptance
Status: Complete
Files changed: docs/codex_goal_graph_workbench/PROGRESS.md
Tests run: uv run pytest -q; uv run ruff check .; uv run acc workflow validate examples/workflows/demo_serial.graph.json; uv run acc workflow run examples/workflows/demo_serial.graph.json --run-dir runs/acceptance_graph_serial --emit-json; uv run acc workflow validate examples/workflows/demo_parallel.graph.json; uv run acc workflow run examples/workflows/demo_parallel.graph.json --run-dir runs/acceptance_graph_parallel --emit-json; cd web && npm install; cd web && npm run build; cd web && npm run test -- --run
Result: Graph Workbench acceptance passed. Python tests 144 passed; ruff passed; serial and parallel graph validation/run commands exited 0; web install/build passed; web tests 8 passed.
Next step: None
Blocked by: None
```

```text
Milestone: Node isolation audit and hardening
Status: Complete
Files changed: acc/workflow_graph.py, acc/workflow_runner.py, examples/workflows/demo_two_node.graph.json, tests/unit/test_workflow_graph_schema.py, tests/integration/test_workflow_graph_runner.py, docs/codex_goal_graph_workbench/PROGRESS.md
Tests run: uv run pytest -q; uv run ruff check .; cd web && npm run test -- --run; cd web && npm run build; uv run acc workflow run examples/workflows/demo_two_node.graph.json --run-dir runs/audit_graph_isolation --emit-json; uv run acc workflow run examples/workflows/demo_serial.graph.json --run-dir runs/acceptance_graph_serial --emit-json; uv run acc workflow run examples/workflows/demo_parallel.graph.json --run-dir runs/acceptance_graph_parallel --emit-json
Result: Node execution boundary is now explicit. Static node input is treated as literal JSON and rejects template expressions; upstream data handoff must use input_mapping. Graph metadata, UI labels, node notes, and edge mapping do not enter node input.json or resolved_prompt.md unless explicitly mapped. Each graph node still runs through CapsuleRunner in an isolated per-node run directory.
Next step: None
Blocked by: None
```
