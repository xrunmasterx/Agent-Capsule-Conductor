# Visual Workbench UX Refactor Test Plan

## 1. Baseline regression

Run before and after meaningful implementation milestones:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend:

```bash
cd web
npm run test -- --run
npm run build
```

## 2. Unit/component tests

### Task persistence

Add tests proving:

- creating a task writes to the task store;
- switching from 任务 to 资源 and back keeps the new task;
- browser refresh/re-render restores the task;
- delete button removes only the selected task;
- deleting the active task selects another valid task or creates an empty default task;
- malformed persisted payload does not crash the UI.

### Navigation

Add tests proving:

- left nav visible labels include 任务, 资源, 运行, 产物, 决策, 控制面;
- accessible button names match labels;
- no primary nav label is mojibake.

### Inspector

Add tests proving:

- selecting an agent node does not show system prompt editor by default;
- class/system prompt editing remains available in the resource library;
- node inspector shows user prompt/static input/input mapping;
- after a run, inspector loads `input.json` and `output.json` artifact content;
- output panel exposes full content, not only path.

## 3. Server/API tests if server persistence is added

If implementing task persistence server-side, add tests for:

- `GET /api/workbench/tasks`;
- `POST /api/workbench/tasks`;
- `PUT /api/workbench/tasks/{id}`;
- `DELETE /api/workbench/tasks/{id}`;
- path traversal rejection;
- malformed task payload rejection.

## 4. Semiconductor graph tests

Add hermetic tests for:

- creating/listing the three semiconductor agents;
- saving a serial graph: collect -> clean -> analyze;
- graph run writes per-node summaries;
- clean node input contains collector output;
- analysis node input contains cleaner output;
- nested workflow bound via local binding to `F:\ACCTest\1`;
- nested workflow output maps to outer analysis node.

## 5. Browser journeys

Run at least:

### Journey A: Semiconductor serial workflow

Steps:

1. Open Workbench.
2. Verify left nav icon + label.
3. Create new task.
4. Create or select the three semiconductor agents from resources.
5. Drag them onto canvas.
6. Connect collect -> clean -> analyze.
7. Run task.
8. Click every node.
9. Verify input/output panel correctness.

### Journey B: Nested workflow handoff

Steps:

1. Create new task.
2. Add workflow container.
3. Bind workflow workspace to `F:\ACCTest\1`.
4. Add collect and clean inside workflow.
5. Add analysis node outside workflow.
6. Connect nested workflow output to analysis.
7. Run task.
8. Inspect internal and external node input/output.

For each journey, record screenshots, console errors, network errors, and usability issues.

## 6. Optional real-agent smoke test

Skipped unless explicitly enabled:

```bash
ACC_RUN_EXTERNAL_AGENT_TESTS=1 uv run pytest -q tests/external
```

Default tests must remain hermetic.
