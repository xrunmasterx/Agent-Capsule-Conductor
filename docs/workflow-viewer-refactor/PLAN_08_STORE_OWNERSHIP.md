# PLAN 08 - Store Ownership 迁移

## 目标

让 Zustand stores 真正接管前端交互投影状态，删除 `WorkflowViewer.tsx` 中的全局状态容器职责。完成后，task/canvas/selection/chrome、run projection/logs/events、assistant session/proposal/review 都有明确 owner。

## 前置条件

- PLAN 07 已完成。
- UI 组件、hooks、pure model 已基本拆出。
- `WorkflowViewer.tsx` 已不再持有 ReactFlow 和 inspector/assistant 具体实现。

## 写集合

允许修改：

- `web/src/stores/workbenchStore.ts`
- `web/src/stores/runStore.ts`
- `web/src/stores/assistantStore.ts`
- `web/src/stores/resourceStore.ts`
- `web/src/hooks/useWorkbenchBootstrap.ts`
- `web/src/hooks/useTaskPersistence.ts`
- `web/src/hooks/useRunSubmit.ts`
- `web/src/hooks/useRunStream.ts`
- `web/src/hooks/useAssistantSession.ts`
- `web/src/components/WorkflowViewer.tsx`
- 相关 component selector 使用点
- store tests

禁止修改：

- backend durable truth。
- workflow template schema。
- run evidence file shape。

## Store Ownership

### `workbenchStore`

拥有：

- `tasksById`
- `taskOrder`
- `activeTaskId`
- `canvasRevisionsByTaskId`
- `selectionsByTaskId`
- `focusedWorkflowIdByTaskId`
- `chrome`
- `connectionMode`
- `edgeViewMode`

删除：

- 主文件中的 `tasks` state。
- 主文件中的 `activeTaskId` state。
- 主文件中的 `canvas` state。
- 主文件中的 `sourceGraph` state。
- 主文件中的 `selection` state。

### `runStore`

拥有：

- `runsById`
- `runIdsByTaskId`
- `activeRunIdsByTaskId`
- `nodeRunsByRunId`
- `liveLogsByRunAndNode`
- `liveEventsByRunId`
- `runtimeConfig`
- `workflowBindings`

删除：

- 主文件中的 `runsById`。
- 主文件中的 `liveEventsByRunId`。
- 主文件中的 node logs state。
- 全局 `isRunning` 派生路径。

### `assistantStore`

拥有：

- assistant input/messages。
- session id。
- pending turn。
- proposal。
- backend validation。
- required actions。
- GraphOps review。
- apply undo。
- selected authoring agent。

删除：

- 主文件中的 assistant state。

### `resourceStore`

拥有：

- callables。
- workflows。
- authoring agents。
- resource load status。

如果暂不引入 `resourceStore`，必须明确这些仍由 props 提供，不要再复制为主文件 state。

## 任务清单

1. 定义 store state 和 actions。
2. 为每个 store 增加 selector helpers。
3. 把 hooks 改为调用 store actions。
4. 把 components 改为 selector 读取。
5. 删除 `WorkflowViewer.tsx` 中对应 `useState`。
6. 删除 `canvas/sourceGraph/tasks[].canvas` 三份权威状态。
7. canonical graph 改为从 canvas 派生：
   - 使用 `canvasRevision` memo/cache。
   - 不作为单独 source of truth。
8. 多 run 状态按 `run_id + task_id` 分区。

## 必须覆盖的测试

- 多 task 切换保留各自 canvas。
- 多 task 切换保留各自 selection。
- active task 切换不丢 run evidence。
- 两个 run 同时存在时状态不互相覆盖。
- stream event 更新指定 runId。
- assistant proposal apply 更新当前 task canvas。
- undo 恢复正确 task。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

并满足：

```bash
rg "useState<WorkbenchTask|useState\\(.*tasks|useState\\(.*canvas|useState\\(.*selection|useState\\(.*runsById|useState\\(.*assistant" web/src/components/WorkflowViewer.tsx
```

预期：

- 相关主状态已经清零或仅剩局部 UI transient。
- `WorkflowViewer.tsx` 不再作为状态 owner。

## 不可回退语义

- UI task state 仍只是 projection，不写入 runtime-only 字段。
- 多 run 不退回单例 `isRunning`。
- store actions 不直接调用 API；API 在 hooks。
- store 不 import React components。

## 浏览器验收

- 多 task 切换。
- 在不同 task 中编辑 canvas。
- 运行一个 task 后切换到另一个 task。
- 切回后 evidence 和状态仍正确。
- assistant proposal apply/undo 只影响当前 task。

## 交接给下一 plan

PLAN 09 可以做最终技术债删除。进入 PLAN 09 前，`WorkflowViewer.tsx` 应主要只剩 layout composition 和 bootstrap hooks。

## Goal 模式执行契约

### Goal

把 Workbench task/canvas/selection/run/assistant 状态的真实 ownership 收口到 Zustand stores 和 selector/hook 层，删除 `WorkflowViewer.tsx` 中的 shadow owner。完成后 `tasksById[activeTaskId].canvas` 是唯一 canvas source of truth，canonical graph 只能由 selector 派生。

### Non-goals

- 不迁移 ReactFlow canvas 实现，这属于 PLAN 07。
- 不把 store action 写成 API/effect 层。API 仍在 hooks。
- 不改变 backend durable truth、workflow schema、run evidence shape。

### 前置硬条件

- PLAN 01/02/03/06/07 已完成到 stores/hooks/components 不需要从 `WorkflowViewer.tsx` 拿类型、pure model 或 canvas implementation。
- 如果 stores 仍是 shadow state 且主路径没有消费 store，先补 selector/store contract 和测试，不要只搬 useState 名字。

### Store contract

- `workbenchStore` 拥有 `tasksById`、`taskOrder`、`activeTaskId`、`canvasRevisionsByTaskId`、`selectionsByTaskId`、`focusedWorkflowIdByTaskId`、Workbench chrome。
- `runStore` 拥有 `runsById`、`runIdsByTaskId`、`activeRunIdsByTaskId`、`nodeRunsByRunId`、`liveEventsByRunId`、`logsByRunIdAndNode`、runtime config、bindings。
- `assistantStore` 必须明确是 per-task 还是 global with stale guards。推荐 `assistantByTaskId`；若全局，所有 async completion 必须带 `taskId/baseCanvasHash/sessionId/turnId` guard。
- 资源列表归 `resourceStore` 或当前资源 hook；assistant 只保存 `selectedAuthoringAgentId`，避免复制 authoringAgents list。

### 必备 selectors

`selectActiveTaskId`、`selectActiveTask`、`selectActiveCanvas`、`selectActiveSelection`、`selectCanvasGraph(taskId)`、`selectTaskRunIds(taskId)`、`selectActiveRunForTask(taskId)`、`selectRunLogs(runId,nodeKey)`、`selectAssistantForTask(taskId)`。selector 必须稳定，必要时使用 shallow，避免 canvas drag 导致全局重渲染。

### 执行分片

1. 补 shared store types/model 边界，删除 store-local mirror domain types。
2. 写 store contract tests，再改 store。
3. 迁写入口：`updateCanvas`、`resetCanvas`、`switchTask`、`newTask`、`deleteTask`、proposal apply/undo、run projection append。
4. 删除 `canvas/sourceGraph/tasks[].canvas` 三份真相：只保留 `tasksById[activeTaskId].canvas`，`sourceGraph` 改 selector/memo，`graphRef` 不作为可写真相。
5. hooks 调 API 后只 dispatch store action；store action 只接受纯 payload。
6. 组件通过 selector 读取最小状态，不传整 store 或整 canvas 给无关组件。
7. 删除主文件剩余 owner state 和兼容 exports。

### 必补测试样例

- `workbenchStore.test.ts`：`updateCanvas(taskA)` 不影响 taskB；`selectCanvasGraph(taskA)` 按 `canvasRevision` 失效重算；没有独立 `sourceGraph` setter。
- `workbenchStore.test.ts`：task switch 保留或按设计重置各自 `selection/focusedWorkflowId/connectionMode`。
- `runStore.test.ts`：taskA/run1 和 taskB/run2 隔离；同 node id logs 不串；mismatched run id live event 被忽略。
- `assistantStore.test.ts`：taskA proposal 不可在 taskB apply；stale turn completion 不覆盖当前 task proposal。
- App integration：两个 task 两个 run 的 evidence/logs 分别可打开；artifact cache 按 `runId + path` 或更强 key 隔离。
- Static boundary tests：stores 不 import API/fetch/ReactFlow/WorkflowViewer。

### 静态门禁

```bash
rg "useState<WorkbenchTask|useState<WorkspaceCanvasModel|useState<WorkflowGraph|useState<CanvasSelection|useState<Record<string, RunProjection|useState<Record<string, Record<string, NodeLiveLogs|useState<Record<string, WorkbenchLiveEvent|useState<CanvasAuthoringProposal|useState<AgentSessionUiState" web/src/components/WorkflowViewer.tsx
rg "api\\.|runnerApi\\.|new EventSource|setInterval\\(|setTimeout\\(" web/src/components/WorkflowViewer.tsx
rg "api\\.|fetch\\(|from ['\"].*components/WorkflowViewer|ReactFlow|@xyflow/react" web/src/stores
rg "from ['\"].*WorkflowViewer" web/src/components web/src/hooks web/src/stores web/src/*.test.tsx
```

预期：第一条只允许局部 transient UI state；第二条为空或只剩明确后续 plan 例外；第三条为空；第四条逐步归零，stores/hooks/components 不能依赖 `WorkflowViewer`。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

### Commit / Push

- 按边界拆 commit：types/model boundary、workbenchStore ownership、runStore ownership、assistantStore ownership、hook API dispatch、selector/component wiring、tests/cleanup。
- 禁止 `git add .`。不 stage `.acc/`、`.codex_runtime_logs/`、无关 backend/server。
- commit message 可按分片命名，例如 `refactor(workbench): move canvas ownership into store`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果 store action 需要直接调用 API/fetch/EventSource，停止。
- 如果出现 `canvas`、`sourceGraph`、`tasks[].canvas` 三份可写真相，停止。
- 如果多 task/multi run evidence 出现串状态风险，停止并补隔离测试。
