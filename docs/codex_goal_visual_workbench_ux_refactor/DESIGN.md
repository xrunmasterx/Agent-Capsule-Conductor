# Visual Workbench UX Refactor Design

## 1. Architecture boundary

```text
web UI
  owns interaction state and display
  calls acc-server APIs

acc-server
  owns safe file/API access
  exposes capsules, workflows, runs, artifacts, task persistence if implemented server-side

acc app/engine/store/runtime
  owns validation, execution coordination, manifests, inbox/outbox, artifacts

external agents
  own their internal reasoning/tool loop only when explicitly invoked
```

Do not move graph execution semantics into React state. The UI may project and edit a graph, but validation and run evidence must flow through existing app/server/runtime contracts.

## 2. Recommended implementation slices

### Slice 1: Audit and cleanup map

Create/update `FINDINGS.md` before code changes.

Classify:

- demo nodes loaded by UI startup;
- generated run/intermediate artifacts;
- example fixtures required by tests;
- mojibake Chinese labels;
- task state persistence defect;
- inspector evidence gaps.

### Slice 2: UI text and navigation shell

Fix the primary sidebar:

- expand width on desktop;
- show icon + label;
- dark restrained style;
- ensure accessible button names match visible labels;
- keep mobile/narrow responsive behavior.

### Slice 3: Persistent task store

Introduce a small `WorkbenchTaskStore` boundary.

Preferred path:

```text
web/src/components/workflow-viewer/workbenchTaskStore.ts
```

Responsibilities:

- load tasks;
- save tasks;
- delete task;
- sanitize malformed stored data;
- version the storage payload;
- provide a default empty task.

This keeps persistence out of the rendering component and avoids spreading `localStorage` calls through the UI.

If server-backed persistence is chosen instead, add API routes and tests. Do not make the runtime engine depend on UI task storage.

### Slice 4: Empty default canvas

Replace forced demo startup with an empty user task.

Keep an explicit "加载示例" action if the project still needs manual demo loading. Do not make demo nodes the default.

### Slice 5: Resource/class workflow

Reuse existing capsule scaffold/editor APIs where possible.

For the semiconductor agents:

- add resource-library creation presets or test fixtures;
- save as reusable capsule/class assets;
- keep system prompt in class editor;
- avoid creating runtime sessions during class creation.

### Slice 6: Inspector refactor

Split the inspector into conceptual panels:

```text
Class reference
  name, capsule id, runtime, model

Invocation config
  user prompt, static input, input mapping

Effective input
  resolved from real upstream output / input.json

Real output
  output.json / output artifact content

Evidence
  artifacts, logs, events, paths
```

The inspector should call artifact APIs to read evidence files. It should not rely on placeholder `sourceInput` when a node has a run summary.

### Slice 7: Semiconductor journeys

Add hermetic fixtures and tests for:

- three reusable agents;
- serial graph;
- nested workflow with `F:\ACCTest\1` binding;
- output handoff into outer analysis node;
- inspector input/output evidence.

Use fake local agents or generic CLI scripts for default tests. Real stock news collection is optional smoke coverage only.

### Slice 8: Browser QA loop

Run browser journeys after implementation. Capture evidence under:

```text
runs/browser_e2e/visual_workbench_ux_refactor/<timestamp>/
```

Required files:

- `journey-report.json`;
- screenshots;
- console log;
- network log;
- notes on fixed usability issues.

## 3. State model

```ts
type RunStatus =
  | 'not_run'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'crashed';

type WorkbenchTask = {
  taskId: string;
  title: string;
  canvas: WorkspaceCanvasModel;
  savedWorkflowRef?: string;
  status: RunStatus;
  activeRunId?: string;
  latestRunId?: string;
  updatedAt: string;
};

type RunProjection = {
  runId: string;
  taskId?: string;
  status: RunStatus;
  summary?: WorkflowRunResult;
  events: WorkflowRunEvent[];
  overlay?: RunOverlayState;
  pollState: 'idle' | 'polling' | 'error';
};

type WorkbenchRunState = {
  runsById: Record<string, RunProjection>;
  taskRunRefs: Record<string, { activeRunId?: string; latestRunId?: string }>;
};
```

Persist a versioned envelope:

```ts
type WorkbenchTaskStorePayload = {
  version: 1;
  activeTaskId: string;
  tasks: WorkbenchTask[];
};
```

Malformed stored payloads must fall back to one empty task without crashing the app.

Runtime state must be run-scoped:

- switching tasks must not clear another task's `RunProjection`;
- a terminal run remains visible when the user returns to that task;
- clicking "运行当前任务" creates a new run and updates that task's `activeRunId`;
- terminal runs stop high-frequency polling;
- non-selected running runs may poll low-frequency summaries only.

## 4. Evidence mapping

When a node is selected:

1. Find latest `WorkflowRunResult` / active run.
2. Match UI node id to `NodeRunSummary.node_id` or `ui_node_id`.
3. Load `input_path` and `output_path` through `/api/artifacts/read`.
4. Show full content in scrollable panels.
5. If evidence is missing, show "尚未运行" or "没有上游输入".

## 5. Risk controls

- Keep old acceptance commands passing before deleting any example.
- Keep `acc run --emit-conductor-json` untouched.
- Do not add network-dependent market data tests.
- Do not let UI task persistence become runtime truth.
- Do not save local absolute workspace path inside reusable workflow templates; save it only as local binding.

## 6. Current visual language target

The current ACC Workbench visual direction is documented in
`docs/ACC_WORKBENCH_PRODUCT_UI_ARCHITECTURE_BRANDKIT.md`. For implementation, treat that document as
the visual contract and use these rules as the short version.

### 6.1 Product surface

ACC should look like a dark, local-first, rounded engineering workbench:

```text
left workspace rail
  + top project/action bar
  + rounded graph canvas shell
  + selected node settings inspector
  + current run evidence dock
  + change review surface
```

It should not look like a SaaS landing page, a chat app, or a sharp military terminal.

### 6.2 User-facing translation

The main UI should use Chinese product language and expose only necessary runtime facts:

| Runtime/Core term | User-facing label |
| --- | --- |
| `WorkflowFunctionTemplate` | 工作流模板 / 任务流 |
| `NodeInvocationSpec` | 任务节点 / 节点设置 |
| `control_edges` | 执行顺序 |
| `data_edges` / `bindings` | 数据传递 / 输入来源 |
| `RunSummary` / events | 本次运行 / 最近事件 |
| `ArtifactBundle` | 结果文件 / 产物 |
| GraphOps | 变更审核 |

Raw names such as `SessionInstance`, `ScopeFrame`, `manifest`, `output_schema.json`, and raw Core v2
JSON should stay behind "更多技术详情" or debugging views.

### 6.3 Shape and color

Use a soft bounded shape system:

- app shell radius around 24px;
- canvas shell around 20px;
- inspector/dock/list panels around 16px;
- workflow nodes and review cards around 12px;
- buttons, selects, search boxes, and status chips around 10px.

Use near-black and graphite surfaces, warm off-white text, teal for primary run/callable identity,
cyan only for data transfer, amber for waiting or human confirmation, and red only for failure,
rejection, or destructive actions.

### 6.4 Default information hierarchy

Default views should answer:

1. 哪个工作区、哪个任务流正在编辑？
2. 哪个节点正在运行、等待或需要确认？
3. 这个节点用了哪些输入、产生了什么结果？
4. 本次运行有哪些最近事件、结果文件和日志入口？
5. 如果有流程变更，哪些已经自动校验，哪些需要人工确认？

This keeps the UI focused on user operation while preserving the Core v2 evidence boundary.
