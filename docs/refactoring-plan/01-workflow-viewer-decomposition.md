# WorkflowViewer.tsx 拆分重构

## 现状分析

### 涉及文件及行数

| 文件 | 行数 | 职责 |
|------|------|------|
| `web/src/components/WorkflowViewer.tsx` | **17,521** | 全部 Workbench 逻辑 |
| `web/src/components/workflow-viewer/palette.ts` | ~300 | Palette item 工具函数 |
| `web/src/components/workflow-viewer/workflowConnectionState.ts` | ~200 | 边地址工具 |
| `web/src/components/workflow-viewer/workflowViewerModel.ts` | ~100 | 边界 ID 工具 |
| `web/src/components/workflow-viewer/runState.ts` | ~350 | Run overlay 工具 |
| `web/src/components/workflow-viewer/WorkflowEvidenceDock.tsx` | ~250 | 证据抽屉（已外置） |

现有子模块合计约 1,200 行，主文件独占 17,521 行，占比 93%。

### 当前问题

1. **单文件超大**：17,521 行违反所有可维护性原则，任意修改都要全量解析整棵组件树。
2. **类型定义散落文件顶部**：50+ 个 `type` 定义（`WorkspaceCanvasModel`、`WorkbenchTask`、`CanvasSelection` 等）完全嵌入主文件，无法被其他模块复用。
3. **硬编码演示常量**：第 145–158 行的 14 个 `STOCK_*_AGENT_ID` 常量是历史遗留 Demo 数据，当前无任何组件引用。
4. **状态臃肿**：`WorkflowViewer` 函数组件顶层声明了 30+ 个 `useState`（从第 2244 行起），涵盖 canvas、selection、run、assistant、chrome 等完全正交的关注点，全部在同一 re-render 链上。
5. **SSE 流逻辑内联**：`useWorkbenchLiveStream` hook 及三条 live scope 的拼装逻辑（第 3008–3047 行）埋在主渲染函数中间。
6. **内联组件无法独立测试**：`AssistantDrawer`（~line 5018）、`AgentSessionPanel`（~line 9027）、`WorkflowContainer`（~line 6600）、`AgentToolNode`（~line 5500）等数十个函数组件和纯函数统统通过 `__workflowViewerTestables` 导出，测试耦合度高。
7. **全局 CSS**：`styles.css` 是单文件全局样式，WorkflowViewer 专用 class 与全局布局混在一起，修改风险大。

---

## 重构目标

### 目标架构

```
web/src/
├── store/
│   ├── workbenchStore.ts          # Zustand — task/canvas/selection/chrome
│   ├── runStore.ts                # Zustand — runs projection / polling
│   └── assistantStore.ts         # Zustand — assistant session state
├── hooks/
│   ├── useWorkbenchLiveStream.ts  # SSE streaming hook（从主文件提取）
│   └── useRunPolling.ts           # run polling logic
├── types/
│   └── workbench.ts               # 所有 WorkflowViewer 专用类型
├── components/
│   ├── WorkflowViewer.tsx         # 瘦壳，仅负责 layout + store 连接（目标 ≤300 行）
│   └── workflow-viewer/
│       ├── palette.ts             # 现有（保留）
│       ├── workflowConnectionState.ts  # 现有（保留）
│       ├── workflowViewerModel.ts      # 现有（保留）
│       ├── runState.ts                 # 现有（保留）
│       ├── WorkflowEvidenceDock.tsx    # 现有（保留）
│       ├── canvas/
│       │   ├── WorkspaceCanvas.tsx     # ReactFlow 画布根
│       │   ├── WorkflowContainer.tsx   # workflowContainer 节点类型
│       │   ├── AgentToolNode.tsx       # agentToolNode 节点类型
│       │   ├── ControlConnectHitbox.tsx
│       │   ├── WorkflowHeader.tsx
│       │   ├── WorkflowPortColumn.tsx
│       │   ├── WorkflowInternalEdgeLayer.tsx
│       │   ├── canvasLayout.ts         # layoutCanvasForSelection / layoutWorkspaceCanvas / dagre
│       │   ├── canvasToGraph.ts        # canvasToWorkflowGraph / graphToWorkspaceCanvas
│       │   └── canvasEdgeOps.ts        # createDataEdgeCommand / resolveScopedConnection 等纯函数
│       ├── authoring/
│       │   ├── canvasAuthoringProposal.ts   # applyCanvasAuthoringProposal / validate / build
│       │   ├── authoringSnapshot.ts          # captureAuthoringSnapshot / canvasAuthoringHash
│       │   └── graphOpsProposal.ts           # graphOpsTransactionForTemporaryAgent 等
│       ├── assistant/
│       │   ├── AssistantDrawer.tsx           # 抽屉壳
│       │   ├── AssistantMessageList.tsx      # 消息列表
│       │   ├── AssistantGraphOpsReview.tsx   # GraphOps 审核 UI
│       │   └── assistantTurnHelpers.ts       # buildDeterministicCanvasAuthoringProposal 等
│       ├── inspector/
│       │   ├── NodeInspectorPanel.tsx        # 右侧 Inspector 总控
│       │   ├── AgentSessionPanel.tsx         # Agent session tab
│       │   ├── InvocationInputEditor.tsx
│       │   ├── DataConnectionsPanel.tsx
│       │   ├── TechnicalDetailsDisclosure.tsx
│       │   └── selectedEntityDetails.ts      # selectedEntityDetailsModel 纯函数
│       ├── execution/
│       │   ├── WorkbenchTaskBar.tsx          # 顶部任务栏
│       │   ├── RunSummaryBar.tsx
│       │   └── runProjection.ts              # refreshRunProjection / nodeRunForInternalNode
│       └── workbench/
│           ├── WorkbenchChrome.tsx           # leftPanel/rightPanel layout 壳
│           ├── WorkbenchTaskTabs.tsx         # 任务列表 tab
│           └── SaveWorkflowDialog.tsx
```

### 关键设计决策

1. **状态管理：选用 Zustand（推荐）**

   理由：
   - 单用户本地应用，无需服务端状态同步，TanStack Query 的缓存/dedupe 优势用不上。
   - WorkflowViewer 有 30+ `useState`，跨层传 props 超 15 层。Zustand 的 atom 切片模式可将 canvas、run、assistant 三条正交状态线完全隔离，各自 re-render 互不影响。
   - Zustand selector 粒度可精确到单字段（`useWorkbenchStore(s => s.canvas)`），优于 Context 的整树重渲。
   - 无需 Provider 包裹，与现有 App.tsx 无侵入式接入。
   - 对比 Redux Toolkit：体积更小（~3 KB），样板代码少，适合 1–2 人团队维护。

   三个 store 切片：
   - `workbenchStore`：`tasks`、`activeTaskId`、`canvas`、`selection`、`chrome`、`connectionMode`、`edgeViewMode`
   - `runStore`：`runsById`、`runLogsById`、`runtimeConfig`、`workflowBindings`
   - `assistantStore`：`assistantMessages`、`assistantProposal`、`assistantSessionId`、`assistantBusy`、`agentSessionState` 等

2. **CSS Modules**：每个新建组件文件配套同名 `.module.css`，全局 `styles.css` 只保留 `:root`、`body`、`*`、`.shell`、`.sidebar` 等真正全局的规则，WorkflowViewer 专用 class 迁入对应模块。

3. **`__workflowViewerTestables` 迁移**：拆分后每个纯函数/组件都从自己的模块直接导出命名 export，测试文件改为直接 `import { canvasToWorkflowGraph } from '../canvas/canvasToGraph'`，删除聚合 export 对象。

4. **Supervisor/Handoff**：现有相关代码标注 `// STUB: supervisor interface` 注释，不实现业务逻辑，Interface 类型保留。

---

## 详细实施步骤

### 步骤 1：类型提取

- **具体操作**：将第 128–799 行所有顶层 `type` 定义（`InternalNodeView`、`WorkflowContainerModel`、`WorkspaceCanvasModel`、`CanvasSelection`、`WorkbenchTask`、`WorkbenchChromeState`、`RunProjection` 等 50+ 个）移至 `web/src/types/workbench.ts`。
- **涉及文件**：`WorkflowViewer.tsx` → `web/src/types/workbench.ts`
- **预期结果**：WorkflowViewer.tsx 减少 ~600 行；所有子模块可直接 import 类型，消除循环依赖风险。

### 步骤 2：删除硬编码演示常量

- **具体操作**：删除第 145–158 行的 14 个 `STOCK_*_AGENT_ID` 常量。全局搜索确认无任何引用后直接删除。
- **涉及文件**：`WorkflowViewer.tsx`
- **预期结果**：约 14 行删除；消除 "demo agent IDs" 代码味道。

### 步骤 3：安装并配置 Zustand

- **具体操作**：`npm install zustand`；创建 `web/src/store/workbenchStore.ts`、`runStore.ts`、`assistantStore.ts`，将 WorkflowViewer 中对应的 `useState` 迁移为 Zustand `create` store，使用 `immer` middleware（可选）处理 canvas 的嵌套更新。
- **涉及文件**：新建 3 个 store 文件；`package.json`
- **预期结果**：WorkflowViewer 中 30+ `useState` 减少到 ≤5 个（仅保留无需全局共享的 UI 瞬态状态）。

### 步骤 4：提取 SSE streaming hook

- **具体操作**：将 `useWorkbenchLiveStream` 函数（约第 2700–2900 行）及其依赖的 `WorkbenchLiveStreamScope`、`WorkbenchLiveStreamState` 类型迁移到 `web/src/hooks/useWorkbenchLiveStream.ts`。
- **涉及文件**：`WorkflowViewer.tsx` → `web/src/hooks/useWorkbenchLiveStream.ts`
- **预期结果**：SSE 逻辑可独立测试；从主文件消除约 200 行。

### 步骤 5：提取 canvas 纯函数层

- **具体操作**：将以下纯函数移至 `canvas/` 子目录：
  - `canvasToWorkflowGraph`、`graphToWorkspaceCanvas` → `canvasToGraph.ts`（约 line 11500–12500）
  - `layoutCanvasForSelection`、`layoutWorkspaceCanvas`、`expandWorkflowToFitChildren` → `canvasLayout.ts`（约 line 13500–14500）
  - `createDataEdgeCommand`、`resolveScopedConnection`、`scopedBoundaryDataEdge`、`canvasEdgesAreEquivalent` → `canvasEdgeOps.ts`（约 line 12500–15500）
- **涉及文件**：WorkflowViewer.tsx → 3 个新 canvas 模块
- **预期结果**：约 2,000 行纯函数迁移出主文件；可直接 Jest 单元测试。

### 步骤 6：提取 ReactFlow 节点类型组件

- **具体操作**：
  - `WorkflowContainer`（约 line 6500–7500）→ `canvas/WorkflowContainer.tsx`
  - `AgentToolNode`（约 line 5400–5900）→ `canvas/AgentToolNode.tsx`
  - `WorkflowHeader`（约 line 4850–4994）→ `canvas/WorkflowHeader.tsx`
  - `ControlConnectHitbox`（搜索 `ControlConnectHitbox`）→ `canvas/ControlConnectHitbox.tsx`
  - `WorkflowPortColumn`（搜索定义）→ `canvas/WorkflowPortColumn.tsx`
  - `WorkspaceCanvas`（主 ReactFlow 渲染组件，约 line 3100–4000）→ `canvas/WorkspaceCanvas.tsx`
- **涉及文件**：WorkflowViewer.tsx → 6 个新 canvas 组件
- **预期结果**：约 2,500 行迁移；`nodeTypes` 对象在 `WorkspaceCanvas.tsx` 中本地定义，避免 React Flow 重复注册。

### 步骤 7：提取 authoring 纯函数层

- **具体操作**：
  - `applyCanvasAuthoringProposal`、`validateCanvasAuthoringProposal`、`buildDeterministicCanvasAuthoringProposal` → `authoring/canvasAuthoringProposal.ts`（约 line 1500–2200）
  - `captureAuthoringSnapshot`、`canvasAuthoringHash`、`stableJsonStringify` → `authoring/authoringSnapshot.ts`（约 line 876–920）
  - `graphOpsTransactionForTemporaryAgent`、`graphOpsProposalId`、`persistentCallableIdForDraft` → `authoring/graphOpsProposal.ts`（约 line 843–875）
- **涉及文件**：WorkflowViewer.tsx → 3 个新 authoring 模块
- **预期结果**：约 700 行迁移；authoring 逻辑可独立测试。

### 步骤 8：提取 AssistantDrawer 及子组件

- **具体操作**：
  - `AssistantDrawer`（约 line 5018–5900）→ `assistant/AssistantDrawer.tsx`
  - 消息列表渲染逻辑 → `assistant/AssistantMessageList.tsx`
  - GraphOps Review UI → `assistant/AssistantGraphOpsReview.tsx`
  - `buildDeterministicCanvasAuthoringProposal` 辅助函数 → `assistant/assistantTurnHelpers.ts`
- **涉及文件**：WorkflowViewer.tsx → 4 个新 assistant 模块
- **预期结果**：约 900 行迁移；AssistantDrawer 通过 Zustand store 读取状态，不再需要 20+ props 透传。

### 步骤 9：提取 Inspector 面板

- **具体操作**：
  - `AgentSessionPanel`（约 line 9027–9800）→ `inspector/AgentSessionPanel.tsx`
  - `InvocationInputEditor`（搜索定义）→ `inspector/InvocationInputEditor.tsx`
  - `DataConnectionsPanel`（搜索定义）→ `inspector/DataConnectionsPanel.tsx`
  - `TechnicalDetailsDisclosure`（搜索定义）→ `inspector/TechnicalDetailsDisclosure.tsx`
  - `selectedEntityDetailsModel` 纯函数（约 line 16990–17130）→ `inspector/selectedEntityDetails.ts`
  - 顶层 Inspector 总控（约 line 10950–11500）→ `inspector/NodeInspectorPanel.tsx`
- **涉及文件**：WorkflowViewer.tsx → 6 个新 inspector 模块
- **预期结果**：约 1,500 行迁移。

### 步骤 10：提取 execution 运行层

- **具体操作**：
  - `WorkbenchTaskBar`（顶部任务栏，约 line 4600–4850）→ `execution/WorkbenchTaskBar.tsx`
  - `refreshRunProjection`、`nodeRunForInternalNode`、`nodeLiveLogsFor` → `execution/runProjection.ts`（约 line 3060–3200）
  - Run polling `useEffect`（约 line 3200–3400）→ `web/src/hooks/useRunPolling.ts`
- **涉及文件**：WorkflowViewer.tsx → 3 个新 execution 模块
- **预期结果**：约 600 行迁移；run polling 可独立测试。

### 步骤 11：提取 Workbench Chrome 和 Task Tabs

- **具体操作**：
  - `WorkbenchChrome`（leftPanel/rightPanel layout 壳，约 line 3400–4600）→ `workbench/WorkbenchChrome.tsx`
  - `WorkbenchTaskTabs`（任务 tab 栏，搜索定义）→ `workbench/WorkbenchTaskTabs.tsx`
  - `SaveWorkflowDialog`（搜索定义）→ `workbench/SaveWorkflowDialog.tsx`
- **涉及文件**：WorkflowViewer.tsx → 3 个新 workbench 模块
- **预期结果**：约 500 行迁移。

### 步骤 12：CSS Modules 化

- **具体操作**：
  - 将 `styles.css` 中 WorkflowViewer 专用的 class（如 `.workflow-nested-canvas`、`.inspector-stack`、`.assistant-drawer`、`.agent-tool-node`、`.workflow-shell` 等）分别迁移至对应组件的 `.module.css` 文件。
  - `styles.css` 只保留真正全局的规则：`:root`、`body`、`*`、`.shell`、`.sidebar`、`.brand`、`.nav`、`.sr-only`、通用 button/input 样式。
- **涉及文件**：`styles.css` → 多个 `.module.css`
- **预期结果**：全局 CSS 缩减至 ≤150 行，组件样式本地化，消除命名冲突风险。

### 步骤 13：重写 WorkflowViewer.tsx 为瘦壳

- **具体操作**：将主文件缩减为仅包含：
  - Props 类型定义（保留对外 API）
  - Zustand store 初始化
  - 副作用（`useEffect` for `runtimeConfig`、`authoringAgents` 加载）
  - Layout 组合（`WorkbenchChrome` + `WorkspaceCanvas` + `AssistantDrawer` + `NodeInspectorPanel`）
- **涉及文件**：`WorkflowViewer.tsx`（最终目标 ≤300 行）
- **预期结果**：主文件只做"组合"，逻辑全部在子模块。

### 步骤 14：迁移 `__workflowViewerTestables`

- **具体操作**：删除 `__workflowViewerTestables` 导出对象（第 17527–17572 行）。在每个拆分后的模块中，相关函数/组件已是命名 export，测试文件直接 import 对应模块。
- **涉及文件**：`WorkflowViewer.tsx`；所有引用 `__workflowViewerTestables` 的测试文件（搜索 `__workflowViewerTestables`）
- **预期结果**：测试依赖清晰，不再有聚合 export 对象。

---

## 文件变更清单

### 新建文件

```
web/src/types/workbench.ts
web/src/store/workbenchStore.ts
web/src/store/runStore.ts
web/src/store/assistantStore.ts
web/src/hooks/useWorkbenchLiveStream.ts
web/src/hooks/useRunPolling.ts
web/src/components/workflow-viewer/canvas/WorkspaceCanvas.tsx
web/src/components/workflow-viewer/canvas/WorkspaceCanvas.module.css
web/src/components/workflow-viewer/canvas/WorkflowContainer.tsx
web/src/components/workflow-viewer/canvas/WorkflowContainer.module.css
web/src/components/workflow-viewer/canvas/AgentToolNode.tsx
web/src/components/workflow-viewer/canvas/AgentToolNode.module.css
web/src/components/workflow-viewer/canvas/WorkflowHeader.tsx
web/src/components/workflow-viewer/canvas/ControlConnectHitbox.tsx
web/src/components/workflow-viewer/canvas/WorkflowPortColumn.tsx
web/src/components/workflow-viewer/canvas/WorkflowInternalEdgeLayer.tsx
web/src/components/workflow-viewer/canvas/canvasLayout.ts
web/src/components/workflow-viewer/canvas/canvasToGraph.ts
web/src/components/workflow-viewer/canvas/canvasEdgeOps.ts
web/src/components/workflow-viewer/authoring/canvasAuthoringProposal.ts
web/src/components/workflow-viewer/authoring/authoringSnapshot.ts
web/src/components/workflow-viewer/authoring/graphOpsProposal.ts
web/src/components/workflow-viewer/assistant/AssistantDrawer.tsx
web/src/components/workflow-viewer/assistant/AssistantDrawer.module.css
web/src/components/workflow-viewer/assistant/AssistantMessageList.tsx
web/src/components/workflow-viewer/assistant/AssistantGraphOpsReview.tsx
web/src/components/workflow-viewer/assistant/assistantTurnHelpers.ts
web/src/components/workflow-viewer/inspector/NodeInspectorPanel.tsx
web/src/components/workflow-viewer/inspector/NodeInspectorPanel.module.css
web/src/components/workflow-viewer/inspector/AgentSessionPanel.tsx
web/src/components/workflow-viewer/inspector/InvocationInputEditor.tsx
web/src/components/workflow-viewer/inspector/DataConnectionsPanel.tsx
web/src/components/workflow-viewer/inspector/TechnicalDetailsDisclosure.tsx
web/src/components/workflow-viewer/inspector/selectedEntityDetails.ts
web/src/components/workflow-viewer/execution/WorkbenchTaskBar.tsx
web/src/components/workflow-viewer/execution/WorkbenchTaskBar.module.css
web/src/components/workflow-viewer/execution/runProjection.ts
web/src/components/workflow-viewer/workbench/WorkbenchChrome.tsx
web/src/components/workflow-viewer/workbench/WorkbenchChrome.module.css
web/src/components/workflow-viewer/workbench/WorkbenchTaskTabs.tsx
web/src/components/workflow-viewer/workbench/SaveWorkflowDialog.tsx
```

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `web/src/components/WorkflowViewer.tsx` | 从 17,521 行缩减至 ≤300 行瘦壳 |
| `web/src/styles.css` | 删除 WorkflowViewer 专用 class，保留全局规则 |
| `web/src/App.tsx` | 无结构变化，Props 不变 |
| `web/package.json` | 新增 `zustand` 依赖 |
| 所有引用 `__workflowViewerTestables` 的测试文件 | 改为直接 import 具名模块 |

### 删除文件

无文件删除（子目录文件均为现有文件，不删除）。

**删除的代码块**（在原文件内删除，不产生独立文件）：

| 位置 | 内容 | 理由 |
|------|------|------|
| WorkflowViewer.tsx 第 145–158 行 | 14 个 `STOCK_*_AGENT_ID` 常量 | 演示数据，无任何引用 |
| WorkflowViewer.tsx 第 17527–17572 行 | `__workflowViewerTestables` 导出 | 拆分后每模块直接命名导出替代 |

---

## 测试计划

### 纯函数单元测试（随步骤 5、7 一起编写）

| 测试文件 | 覆盖函数 |
|---------|---------|
| `canvas/canvasToGraph.test.ts` | `canvasToWorkflowGraph`、`graphToWorkspaceCanvas` 往返一致性 |
| `canvas/canvasEdgeOps.test.ts` | `createDataEdgeCommand`（合法连接/拒绝路径）、`canvasEdgesAreEquivalent` |
| `canvas/canvasLayout.test.ts` | `layoutWorkspaceCanvas` 节点不重叠断言、`expandWorkflowToFitChildren` 边界 |
| `authoring/canvasAuthoringProposal.test.ts` | `applyCanvasAuthoringProposal` 操作序列、`validateCanvasAuthoringProposal` 错误检测 |
| `authoring/authoringSnapshot.test.ts` | `captureAuthoringSnapshot` hash 稳定性（同 canvas 两次 hash 相等） |
| `execution/runProjection.test.ts` | `nodeRunForInternalNode`、`nodeLiveLogsFor` |
| `inspector/selectedEntityDetails.test.ts` | `selectedEntityDetailsModel` 各 selection 类型分支 |

### 集成测试（步骤 13 完成后编写）

- `WorkflowViewer` 瘦壳渲染不崩溃（shallow render with mock store）
- Zustand store 初始化 → canvas 加载 → selection 变更流程
- SSE `useWorkbenchLiveStream` 模拟 EventSource，验证 `terminal` event 停止轮询

### 测试工具

- Jest + React Testing Library（现有项目配置）
- `@testing-library/user-event` 用于交互测试
- 无需 CI pipeline，本地 `npm test` 即可

---

## 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| ReactFlow `nodeTypes` 对象引用不稳定导致节点闪烁重渲 | 高 | 高 | `nodeTypes` 定义在 `WorkspaceCanvas.tsx` 模块顶层（模块级常量），不在组件内部创建；用 `memo()` 包裹节点组件 |
| Zustand store 切片之间跨读导致重渲扩散 | 中 | 中 | 严格使用 selector 粒度，禁止在一个 selector 中读取两个不同 store 的值并返回新对象 |
| CSS Modules 迁移破坏现有样式 | 中 | 中 | 每个组件 CSS 迁移后立即浏览器截图对比；保留全局 class 作为兼容层，迁移稳定后删除 |
| `canvasToWorkflowGraph` 行为细节丢失（类型精炼过度） | 低 | 高 | 迁移前写往返测试（步骤 5 前置）；任何行为变更必须有失败测试 |
| `__workflowViewerTestables` 删除导致现有测试全量失败 | 低 | 中 | 先在每个新模块添加具名 export，再改测试 import，最后删除 testables 对象（不能反序） |

---

## 依赖关系

```
步骤 1（类型提取）
  └─→ 步骤 2（删常量）— 并行
  └─→ 步骤 3（Zustand 安装）
        └─→ 步骤 4（SSE hook）— 并行
        └─→ 步骤 5（canvas 纯函数）
              └─→ 步骤 6（canvas 组件）
        └─→ 步骤 7（authoring 纯函数）
              └─→ 步骤 8（AssistantDrawer）— 依赖 step 3 store
        └─→ 步骤 9（Inspector）— 依赖 step 3 store
        └─→ 步骤 10（execution）
  └─→ 步骤 11（WorkbenchChrome）— 依赖 step 3 store
步骤 6 + 8 + 9 + 10 + 11 全部完成
  └─→ 步骤 12（CSS Modules）
  └─→ 步骤 13（瘦壳）
        └─→ 步骤 14（删 testables）
```

---

## 预估工作量

| 步骤 | 估时（人天） | 备注 |
|------|------------|------|
| 步骤 1–2（类型提取 + 删常量） | 0.5 | 机械操作 |
| 步骤 3（Zustand store） | 1.5 | 需要仔细映射 30+ useState |
| 步骤 4（SSE hook） | 0.5 | 已有清晰边界 |
| 步骤 5（canvas 纯函数） | 1.0 | 含测试 |
| 步骤 6（canvas 组件） | 2.0 | ReactFlow 节点类型敏感 |
| 步骤 7（authoring 纯函数） | 0.5 | 含测试 |
| 步骤 8（AssistantDrawer） | 1.5 | props 转 store 重写 |
| 步骤 9（Inspector） | 1.5 | 含测试 |
| 步骤 10（execution） | 1.0 | 含 polling hook |
| 步骤 11（WorkbenchChrome + Tabs + Dialog） | 1.0 | |
| 步骤 12（CSS Modules） | 1.0 | 视觉回归验证 |
| 步骤 13–14（瘦壳 + testables 清理） | 1.0 | |
| **合计** | **~13 人天** | 单人串行执行，可部分并行 |
