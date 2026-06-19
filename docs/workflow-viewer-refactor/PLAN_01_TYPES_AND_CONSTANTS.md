# PLAN 01 - 类型与常量收口

## 目标

创建 Workbench 前端共享类型和常量边界，消除 `WorkflowViewer.tsx`、stores、hooks、extracted components 之间的 mirror type 和常量分叉。这个 plan 的目标是切断“子模块必须从 `WorkflowViewer.tsx` import 类型”的理由。

## 前置条件

- PLAN 00 已完成。
- 基线测试稳定。
- 不在本 plan 中迁移业务逻辑或 React 组件。

## 写集合

允许新增/修改：

- `web/src/types/workbench.ts`
- `web/src/workbench/constants.ts`
- `web/src/stores/workbenchStore.ts`
- `web/src/stores/runStore.ts`
- `web/src/stores/assistantStore.ts`
- `web/src/hooks/useRunStream.ts`
- `web/src/hooks/useAssistantStream.ts`
- `web/src/components/*` 中只涉及 type import 的小改动
- `web/src/components/canvas/canvasConstants.ts`

谨慎修改：

- `web/src/components/WorkflowViewer.tsx` 只允许把本地类型/常量改为 import，不迁移函数体。

禁止修改：

- graph/canvas conversion 行为。
- ReactFlow interaction 行为。
- run submit / assistant submit 行为。

## 任务清单

1. 新建 `web/src/types/workbench.ts`，迁入或统一定义：
   - `WorkspaceCanvasModel`
   - `WorkflowContainerModel`
   - `InternalNodeView`
   - `WorkflowCanvasEdge`
   - `CanvasSelection`
   - `WorkbenchTask`
   - `WorkbenchChromeState`
   - `RunProjection`
   - `NodeRunSummary`
   - `NodeLiveLogs`
   - `SelectedEntityDetailsModel`
   - `AssistantChatMessage`
   - `CanvasAuthoringProposal`
   - `CanvasAuthoringValidationResult`
   - `AssistantGraphOpsReview`

2. 新建 `web/src/workbench/constants.ts`，统一：
   - node size constants。
   - port spacing constants。
   - inspector width limits。
   - `DEFAULT_TASK_ID`。
   - `TASK_STORE_KEY`。
   - temporary callable prefixes。
   - log preview limits。

3. 删除或替换 mirror types：
   - `workbenchStore.ts` 中的本地镜像类型。
   - `runStore.ts` 中重复的 `WorkflowStatus` / log 类型。
   - `assistantStore.ts` 中重复的 assistant/proposal 类型。
   - hooks 中重复的 stream callback 类型可保留，但 domain type 必须 import。

4. 修复常量分叉：
   - 确认 `WorkflowViewer.tsx` 和 `canvasConstants.ts` 不再各自维护不同 `TASK_STORE_KEY`。
   - 如果保留 `canvasConstants.ts`，让它 re-export `workbench/constants.ts`，不要反向。

5. 消除新的循环依赖：
   - `types/workbench.ts` 只能 import API DTO type，不 import components/hooks/stores。
   - `workbench/constants.ts` 不 import React 或 component。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

并满足：

```bash
rg "type .* = .*WorkflowViewer" web/src
rg "from ['\"].*WorkflowViewer" web/src/components web/src/hooks web/src/stores
```

预期：

- 不再因为类型需要从 `WorkflowViewer.tsx` import。
- 允许临时存在 wrapper re-export，但必须列入后续 PLAN 09 清理。
- `TASK_STORE_KEY` 只有一个 authoritative definition。

## 不可回退语义

- 仅迁类型和常量，不改变保存格式。
- 不改变 localStorage key，除非同时提供兼容读取旧 key 的 migration。
- 不改变 workflow canvas JSON shape。

## 交接给下一 plan

PLAN 02 可以开始抽纯模型函数。进入 PLAN 02 前，所有目标模块都应能从 `types/workbench.ts` 和 `workbench/constants.ts` 取得类型/常量。

## Goal 模式执行契约

### Goal

在当前 `dev_v3` 分支上完成类型与常量收口，并在验证通过后只提交本 plan 范围内的代码与测试。完成后，stores、hooks、extracted components 不再为了 domain type 或共享常量从 `WorkflowViewer.tsx` import。

### Non-goals

- 不迁移 graph/canvas conversion、edge ops、ReactFlow 组件、run submit、assistant submit。
- 不把 Zustand store 变成真实 owner，这属于 PLAN 08。
- 不清理所有 wrapper/re-export，这属于 PLAN 09。

### 执行分片

1. 新建 `web/src/types/workbench.ts`，只放 type/interface/union，只允许 `import type ... from '../types'`。
2. 新建 `web/src/workbench/constants.ts`，以 `WorkflowViewer.tsx` 当前行为为准迁移常量。
3. 修复高风险常量分叉：`TASK_STORE_KEY` 的 authoritative 值必须是 `acc.workbench.tasks.v2`；`AGENT_CONTROL_HANDLE_TOP` 必须保留 `'50%'` 语义；`agentDataPortTop` 必须保留三参数居中布局。
4. stores 改为 import shared domain type，store-local callback/action type 可以保留。
5. hooks 和组件改为 import shared domain type，hook callback shape 可以保留本地定义。
6. `WorkflowViewer.tsx` 只删除本地 type/constant 定义并改 import，不移动函数体。
7. tests 只迁移 type/constant import 的最低必要部分，纯函数 helper import 可留给 PLAN 02/09 白名单。

### 必补测试样例

- `web/src/workbench/constants.test.ts`：断言 `TASK_STORE_KEY === 'acc.workbench.tasks.v2'`、默认 task id、temporary callable prefix、`AGENT_CONTROL_HANDLE_TOP === '50%'`、`agentDataPortTop(index, count, nodeHeight)` 保持当前居中语义。
- `web/src/App.test.tsx` 或相邻 persistence 测试：断言 localStorage 写入 `acc.workbench.tasks.v2`，且没有回退写入 `acc.workbench.tasks.v1`。
- `web/src/types/workbench.type-boundary.test.ts`：从 `types/workbench` 构造最小 `WorkspaceCanvasModel`、`CanvasSelection`、`AssistantChatMessage`、`WorkbenchRunProjection`，不从 `WorkflowViewer.tsx` 导入。
- `web/src/workbench/constants.compat.test.ts` 或 canvas constants 测试：旧 `components/canvas` barrel 如需保留导出，必须 re-export authoritative constants。
- `web/src/hooks/streamTypes.test.ts`：hook callback type 可用 shared status/log type，不再镜像 domain type。
- `web/src/stores/workbenchStore.types.test.ts`：store 初始 chrome/state 使用 shared constants/type。

### 静态门禁

```bash
rg -n "from ['\"].*(components|hooks|stores|api|@xyflow)" web/src/types/workbench.ts
rg -n "acc.workbench.tasks.v1|AGENT_CONTROL_HANDLE_TOP = AGENT_TOOL_NODE_SIZE.height|function agentDataPortTop\(index: number\): number" web/src
rg -n "export type (AssistantChatMessage|WorkflowStatus|NodeLiveLogs|WorkbenchChromeState|CanvasAuthoringValidationResult)" web/src/components web/src/hooks web/src/stores
rg -n "import type .*WorkflowViewer|type .*WorkflowViewer" web/src
```

预期：第一条无结果；第二条只允许测试负向断言；第三条只允许明确白名单 callback type；第四条无结果。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

### Commit / Push

- 提交前先 `git status --short --branch`，当前分支必须是 `dev_v3` 或明确 push 到 `dev_v3`。
- 禁止 `git add .`。只 stage PLAN 01 相关文件，例如 `web/src/types/workbench.ts`、`web/src/workbench/constants.ts`、相关 stores/hooks/components 的 type import、对应测试、本文档。
- 不 stage `.acc/`、`.codex_runtime_logs/`、后端 boundary transfer 改动或其他计划文件。
- commit message 建议：`refactor(web): centralize workbench types and constants`。
- 验证通过后执行 `git push origin dev_v3`。

### Stop conditions

- 如果必须移动函数体、ReactFlow 组件、run/assistant 行为，停止并转交 PLAN 02/03/06/07。
- 如果发现 `TASK_STORE_KEY` 迁移会丢旧任务，必须先补兼容读取测试，不允许直接改 key。
