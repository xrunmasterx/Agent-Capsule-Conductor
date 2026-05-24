# Acceptance Criteria: Graph Workbench

The Graph Workbench is complete only when every required criterion below is satisfied.

## 1. Existing baseline remains intact

These commands must still pass:

```bash
uv run pytest -q
uv run ruff check .
```

Existing `acc run`, capsule validation, batch runner, artifact store, and stdout contract must not regress.

## 2. Chinese UI

The UI must default to Chinese.

Required visible labels include:

- 工作流
- 节点库
- 保存
- 校验
- 运行
- 自动布局
- 节点属性
- 输入
- 输出
- 产物
- 日志

No major primary button should remain English unless it is a technical identifier such as capsule id.

## 3. Graph canvas

The UI must have a real graph canvas.

Acceptance:

- A user can add capsule nodes to the canvas.
- A user can connect nodes by dragging an edge.
- Saved graph contains nodes and edges.
- Serial dependency is visible.
- Parallel dependency is visible in demo graph.
- Button-only sequence connection is not the primary workflow construction method.

## 4. Workflow graph files

At least these demo graph files must exist:

```text
examples/workflows/demo_serial.graph.json
examples/workflows/demo_parallel.graph.json
```

They must validate successfully.

## 5. Graph validation

Validation must catch:

- missing capsule
- duplicate node id
- invalid edge endpoint
- self edge
- cycle
- missing required input

## 6. Graph run

These commands or equivalent API-backed UI actions must work:

```bash
uv run acc workflow validate examples/workflows/demo_serial.graph.json
uv run acc workflow run examples/workflows/demo_serial.graph.json --run-dir runs/acceptance_graph_serial --emit-json
uv run acc workflow validate examples/workflows/demo_parallel.graph.json
uv run acc workflow run examples/workflows/demo_parallel.graph.json --run-dir runs/acceptance_graph_parallel --emit-json
```

Acceptance:

- each graph run writes workflow_run.json
- each node has its own run directory
- node summaries are written
- outputs and artifacts are inspectable

## 7. Inspector

Clicking a node in the graph must show:

- capsule id
- runtime
- static input
- input mapping
- last run status
- output path
- artifact path
- logs path

## 8. Frontend build

If a `web/` frontend exists:

```bash
cd web && npm install && npm run build
```

must pass.

If frontend tests exist:

```bash
cd web && npm run test -- --run
```

must pass.

## 9. Documentation

Required docs must exist:

```text
docs/codex_goal_graph_workbench/GOAL.md
docs/codex_goal_graph_workbench/SPEC.md
docs/codex_goal_graph_workbench/DESIGN.md
docs/codex_goal_graph_workbench/UX_REQUIREMENTS.md
docs/codex_goal_graph_workbench/TEST_PLAN.md
docs/codex_goal_graph_workbench/ACCEPTANCE.md
```

## 10. No scope creep

The implementation must not introduce:

- a new LLM agent loop
- a new autonomous graph scheduler
- a full Dify clone
- mandatory real external-agent credentials for tests
- cloud deployment requirements
