# PLAN 03 - Effects 与 Hooks 收口

## 目标

把 `WorkflowViewer.tsx` 中直接调用 API、EventSource、timer、polling 的副作用逻辑迁到 hooks 层。完成后，组件不再直接持有 run stream、assistant stream、task persistence、boundary preview 的底层 effect。

## 前置条件

- PLAN 02 已完成。
- run projection、live event reducer、boundary preview view model 等纯函数已可复用。

## 写集合

允许新增/修改：

- `web/src/hooks/useWorkbenchBootstrap.ts`
- `web/src/hooks/useTaskPersistence.ts`
- `web/src/hooks/useBoundaryTransferPreview.ts`
- `web/src/hooks/useRunSubmit.ts`
- `web/src/hooks/useRunStream.ts`
- `web/src/hooks/useWorkbenchLiveStream.ts`
- `web/src/hooks/useAssistantSession.ts`
- `web/src/hooks/useAssistantTurnStream.ts`
- `web/src/hooks/*.test.tsx`
- `web/src/components/WorkflowViewer.tsx`

禁止修改：

- ReactFlow component implementation。
- store ownership 大迁移。
- backend routes。

## 目标边界

hooks 层可以：

- 调用 `api.*`。
- 创建/清理 `EventSource`。
- 管理 retry/gap refill/timer。
- 调用 store actions。
- 调用 pure model reducer。

hooks 层不应：

- 渲染 UI。
- 持有 ReactFlow node/edge transient state。
- 直接修改 nested canvas object。
- 绕过后端 canonical preview/validation。

## 任务清单

1. `useBoundaryTransferPreview`
   - 封装 `/api/workbench/boundary-transfer/preview`。
   - 提供 loading/error/result 状态。
   - error 时返回明确 preview unavailable diagnostics。
   - 不伪造 valid binding。

2. `useTaskPersistence`
   - 封装 localStorage save/load effect。
   - 封装 backend task canvas autosave。
   - 兼容旧 task key。
   - 失败只影响 diagnostics/message，不破坏当前 canvas。

3. `useWorkbenchBootstrap`
   - 加载 durable tasks。
   - 初始化 active task。
   - 初始化 workflow bindings/runtime resources。
   - 不直接写 workflow template。

4. `useRunSubmit`
   - 封装 run current task / selected workflow / selected node。
   - submit 前调用 boundary preview/validation。
   - 保持 `run_id + task_id` 模型。

5. `useRunStream`
   - 迁入主文件当前 run EventSource 逻辑。
   - 补齐 `live_event` 处理。
   - 统一 terminal event 与 polling merge。
   - cleanup 时不清空已完成 run evidence。

6. `useWorkbenchLiveStream`
   - 迁入 live scope stream。
   - 保留 seq gap refill。
   - 支持 run scope 和 assistant turn scope。

7. `useAssistantSession`
   - 封装 create/reuse assistant session。
   - 加载 session messages/events。

8. `useAssistantTurnStream`
   - 迁入 assistant turn SSE/polling。
   - 保留条件：只有非 `workbench_chat` 且 turn id 匹配时才 validate draft。

## 必须新增测试

- fake EventSource open/message/error/close。
- stream cleanup 后不再 set state。
- run terminal event 先于 node event 到达时仍正确。
- gap refill 被触发且幂等。
- assistant 普通 chat turn 不触发 draft validation。
- authoring turn 触发 draft validation。
- boundary preview API unavailable 显示不可用 diagnostics。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

并满足：

```bash
rg "new EventSource|api\\.|runnerApi\\.|setTimeout|setInterval" web/src/components/WorkflowViewer.tsx
```

预期：

- 直接 effect 调用显著减少。
- 迁移期残留必须有 TODO 和 PLAN 编号。
- hooks tests 覆盖主要失败路径。

## 不可回退语义

- submit 前仍必须走 boundary transfer preview/validation。
- warning 允许保存/运行策略不变；error 阻断策略不变。
- run evidence 不因 selection 切换丢失。
- assistant GraphOps destructive apply 仍需 validation + dry-run + approval。

## 交接给下一 plan

PLAN 04 可以替换小型展示组件。进入 PLAN 04 前，组件可以通过 hooks 获取 effect 状态，不需要在 UI 内直接调用 API。

## Goal 模式执行契约

### Goal

把 `WorkflowViewer.tsx` 中的数据副作用迁入 hooks，并修复现有半抽取 hook 与主文件正确语义不一致的问题。完成后 `WorkflowViewer.tsx` 不再直接创建 `EventSource`、调用 `api.*`/`runnerApi.*` 或维护 run/assistant polling timer。

### Non-goals

- 不迁移展示组件，这属于 PLAN 04/05/06/07。
- 不改变后端 stream/live event API。
- 不把 submit/run guard 放进 inspector。
- 不让 hook fallback 把 boundary preview API 不可用解释成可运行。

### 执行分片

1. 先补 hook 级测试，再改实现。
2. 修正或重写 `useRunStream`：必须处理 `node_log_delta`、`agent_event`、`live_event`、`summary`，并保证 terminal status 不被旧事件回退。
3. 修正或重写 `useAssistantTurnStream`：只有 `pendingTurn.reason !== 'workbench_chat'` 且 `current_output_turn_id === pendingTurn.turn_id` 时才 validate assistant draft。
4. 抽 `useWorkbenchLiveStream`：稳定合并 `event_id/event_seq`，gap refill 不以 gap seq 错误过滤 canonical replay；run scope 要么用 `api.runEvents(runId)` 补齐，要么显示明确 gap diagnostic。
5. 抽 `useBoundaryTransferPreview`：展示层可返回 unavailable warning；保存/运行 submit guard 必须把 unavailable 视为阻断。
6. 抽 `useTaskPersistence` / `useWorkbenchBootstrap`：明确 localStorage、snapshot publish、durable autosave 的顺序、去重 key、失败诊断和 stale protection。
7. 抽 `useRunSubmit`：submit 后的 poll loop 必须有 cancel/scope token；卸载、task 切换、selected run 切换后不能 set stale state。
8. 接线 hooks 后删除主文件旧 effect，避免双 SSE、双 polling、双 autosave。

### 必补测试样例

- `useRunStream.test.tsx`：fake EventSource 发送 `node_log_delta`、`agent_event`、`live_event`、`summary`，断言 live event 被写入且 terminal summary 不回退；unmount 后 source close 一次且不再回调。
- `useWorkbenchLiveStream.test.tsx`：收到 seq 1、gap seq 4，canonical refill 返回 2/3，断言补齐且去重；run scope gap 必须补齐或显示 diagnostic。
- `useAssistantTurnStream.test.tsx`：普通 chat 不 validate；canvas revision 且 turn id 匹配才 validate；turn id 不匹配不 validate；malformed SSE 后 polling 能恢复。
- `useBoundaryTransferPreview.test.tsx`：API reject 返回 unavailable diagnostics，但 submit validation path 阻断；ambiguous output severity error 不被降级。
- `useTaskPersistence.test.tsx`：localStorage JSON 损坏、autosave 409/stale、快速 canvas hash 变化，断言当前 canvas 不回滚且最后一次快照胜出。
- 保留 `App.test.tsx` 中普通 chat 不触发 draft validation 的集成测试。

### 静态门禁

```bash
rg -n "new EventSource|api\\.|runnerApi\\.|setInterval" web/src/components/WorkflowViewer.tsx
rg -n "setTimeout" web/src/components/WorkflowViewer.tsx
rg -n "useRunStream\\(|useAssistantTurnStream\\(|useWorkbenchLiveStream\\(|useBoundaryTransferPreview\\(" web/src/components/WorkflowViewer.tsx
```

预期：第一条为 0 或只剩带明确 `TODO PLAN_03` 的短期过渡项；第二条只允许纯 UI defer timer；第三条证明 hooks 已真实接线，不是未使用 import。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

后端契约相关回归：

```bash
python -m pytest -q tests/server/test_agent_sessions_api.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py tests/unit/test_workbench_adapter.py
```

### Commit / Push

- 只 stage `web/src/hooks/*`、`web/src/components/WorkflowViewer.tsx` 中 effect 接线/删除、相关测试和本文档。
- 不混入 inspector、ReactFlow canvas、assistant UI 展示组件的大搬迁。
- commit message 建议：`refactor(workflow-viewer): extract effect hooks plan 03`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果 hook 替换会引入双连接或遗漏 `live_event`，停止，先补测试和等价修复。
- 如果 boundary preview API 不可用时无法阻断 run/save，停止，不能交付展示-only fallback。
