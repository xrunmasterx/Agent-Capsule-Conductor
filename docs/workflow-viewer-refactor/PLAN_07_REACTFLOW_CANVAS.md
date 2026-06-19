# PLAN 07 - ReactFlow Canvas 拆分

## 目标

迁移最敏感的 ReactFlow canvas 渲染和交互逻辑：`WorkspaceCanvas`、node renderer、handle projection、drag/drop、connect lifecycle、edge projection。完成后，`WorkflowViewer.tsx` 不再包含 ReactFlow node renderer 和 canvas event lifecycle。

## 前置条件

- PLAN 02 的 flow projection、canvas edge ops、layout 已完成并有测试。
- PLAN 05 的 inspector 已能消费 selection/action。
- PLAN 06 的 assistant 不依赖主文件本地 canvas helper。

## 写集合

允许新增/修改：

- `web/src/components/canvas/WorkspaceCanvas.tsx`
- `web/src/components/canvas/NodeRenderer.tsx`
- `web/src/components/canvas/WorkflowContainer.tsx`
- `web/src/components/canvas/AgentToolNode.tsx`
- `web/src/components/canvas/WorkflowHeader.tsx`
- `web/src/components/canvas/WorkflowPortColumn.tsx`
- `web/src/components/canvas/ControlConnectHitbox.tsx`
- `web/src/components/canvas/WorkflowInternalEdgeLayer.tsx`
- `web/src/components/canvas/CanvasToolbar.tsx`
- `web/src/components/canvas/connectionHandlers.ts`
- `web/src/components/canvas/dragDrop.ts`
- `web/src/workbench/model/flowProjection.ts`
- `web/src/components/WorkflowViewer.tsx`
- `web/src/components/WorkflowViewer.drag.test.tsx`

禁止修改：

- boundary transfer compiler rules。
- run submit semantics。
- assistant GraphOps flow。

## 迁移顺序

1. `flowProjection.ts`
   - 确认 ReactFlow node/edge DTO 由 pure-ish module 生成。
   - 覆盖 root canvas 和 focused workflow canvas。

2. `NodeRenderer.tsx`
   - 迁 `AgentToolNode`。
   - 迁 `WorkflowContainer`。
   - 迁 workflow header/port columns/control hitbox。
   - 删除从 `WorkflowViewer.tsx` re-export。

3. `WorkspaceCanvas.tsx`
   - 迁 ReactFlow root。
   - 迁 `nodeTypes`，保持稳定引用。
   - 迁 edge rendering/filtering。
   - 迁 selection click/double-click。

4. `connectionHandlers.ts`
   - 迁 connect start/connect/end/pending connection。
   - 调用 `canvasEdgeOps` 决定语义。
   - 不能在 handler 内复制 semantic 判断。

5. `dragDrop.ts`
   - 迁 palette drag/drop。
   - 迁 callable/workflow/file source drop。
   - 迁 layout sync/fallback。

6. 主文件收口：
   - `WorkflowViewer.tsx` 只渲染 `<WorkspaceCanvas />`。
   - 删除本地 `WorkspaceCanvas`、`AgentToolNode`、`WorkflowContainer`。

## 高风险点

- ReactFlow `nodeTypes` 引用不稳定导致节点重渲染/闪烁。
- handle id 改名导致拖线失败。
- DOM fallback 找不到 handle。
- focused workflow boundary handle 投影错位。
- `all/control/data` edge view mode 回退。
- 显式 `main -> main` data edge 被错误隐藏。

## 必须覆盖的测试

- drag callable into canvas。
- drag workflow into canvas。
- connect control edge。
- connect data edge。
- connect boundary input -> internal node。
- connect internal node -> boundary output。
- focused workflow 内连接。
- duplicate edge id 防护。
- show all/control/data edge mode。
- 已存在 `main -> main` data edge 在 `显全部` 可见。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

并满足：

- `WorkflowViewer.tsx` 不再定义 `WorkspaceCanvas`。
- `WorkflowViewer.tsx` 不再定义 `AgentToolNode`。
- `WorkflowViewer.tsx` 不再定义 `WorkflowContainer`。
- `components/canvas/WorkspaceCanvas.tsx` 不再从 `WorkflowViewer.tsx` re-export。
- `components/canvas/NodeRenderer.tsx` 不再从 `WorkflowViewer.tsx` re-export。

## 浏览器验收

- 打开 `http://127.0.0.1:5173/`。
- 无 Vite overlay。
- console 无新增 error。
- 当前 ACC 示例 canvas 可加载。
- 切换 `显控制` / `显数据` / `显全部`。
- 拖入 callable。
- 连接 control/data edge。
- focused workflow boundary 连接可用。

## 不可回退语义

- UI 控制线保持有箭头。
- boundary control edge 不进入 runtime `control_edges`。
- explicit data edge 仍优先。
- 已存在 `main -> main` data edge 不被隐藏。

## 交接给下一 plan

PLAN 08 可以迁 store ownership。进入 PLAN 08 前，ReactFlow UI 已独立，不再依赖 `WorkflowViewer.tsx` 本地函数。

## Goal 模式执行契约

### Goal

把 ReactFlow canvas、node renderer、handle contract、drag/drop、connect lifecycle 从 `WorkflowViewer.tsx` 中迁出。完成后 `components/canvas/WorkspaceCanvas.tsx` 和 `NodeRenderer.tsx` 拥有真实实现，不再从 `WorkflowViewer.tsx` re-export，测试也不再通过主文件导入 canvas testables。

### Non-goals

- 不修改 boundary transfer compiler rules。
- 不修改 run submit / assistant GraphOps / store ownership。
- 不改变现有产品规则：UI 新建普通 `main -> main` data edge 仍可拒绝；加载到 canvas 的显式 `main -> main` data edge 必须显示和保存。

### 执行分片

1. 先补 contract tests，不移动实现：`nodeTypes` identity、handle matrix、edge view mode、legacy explicit `main -> main` visible、document fallback no duplicate submit。
2. 抽公共 pure/helper：handle id helpers、old alias compat、edge address、connection resolution、flow projection、drag/drop helper。
3. 迁 `AgentToolNode`、`WorkflowContainer`、`ControlConnectHitbox`、port column/header 到 `NodeRenderer.tsx`，保持 DOM class、handle id、data attributes 完全兼容。
4. 在 `WorkspaceCanvas.tsx` 模块级定义稳定 `nodeTypes`，不能在 render 内创建，不能依赖 selection/edgeViewMode/focusedWorkflowId。
5. 迁 ReactFlow root、drag/drop、connect lifecycle、document-level pointer fallback、edge filtering。
6. 更新 `WorkflowViewer.tsx` 只消费 `<WorkspaceCanvas />`，不再导出 canvas testables。
7. 删除 canvas re-export shim，并把测试 import 改到 `components/canvas` 或更小 pure module。

### 必补测试样例

- `WorkspaceCanvas` rerender 后 `nodeTypes` 引用稳定。
- `WorkspaceCanvas` all mode 显示已存在显式 `main -> main` data edge，flow edge id/handles/className 正确。
- `all/control/data` 三种 edge view mode 在 WorkspaceCanvas 边界过滤正确。
- rendered handle matrix：agent control source/target、agent input/output main、workflow input outer target/inner source、workflow output inner target/outer source，`id === data-handleid` 且保留 `data-nodeid`、`data-acc-connection-mode`、`data-acc-connection-side`。
- focused workflow data connection 写入原 workflow 的 `internalEdges`，root edges 不变。
- document fallback 与 ReactFlow `onConnectEnd` 同时触发时只提交一次。
- drag/drop root/focused workflow：callable、workflow、file source；focused workflow 禁止嵌套 workflow 但允许 callable/file internal node。

### 静态门禁

```bash
rg -n "function WorkspaceCanvas|function AgentToolNode|function WorkflowContainer|const nodeTypes" web/src/components/WorkflowViewer.tsx
rg -n "from '../WorkflowViewer'|from './WorkflowViewer'" web/src/components/canvas web/src/components/WorkflowViewer.drag.test.tsx
rg -n "re-export|Extracted" web/src/components/canvas/WorkspaceCanvas.tsx web/src/components/canvas/NodeRenderer.tsx
```

预期：无结果；`WorkspaceCanvas.tsx` 和 `NodeRenderer.tsx` 不再是 shim。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

可选后端 smoke：

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
```

### Commit / Push

- 禁止 `git add .`。只 stage canvas modules、`WorkflowViewer.tsx` 中 canvas 替换/删除 hunk、`WorkflowViewer.drag.test.tsx` import 迁移、相关 canvas tests 和本文档。
- 如果改到 `boundaryTransfer`、run submit、GraphOps、backend runner，必须在 commit 前解释原因，否则不要 stage。
- commit message 建议：`refactor(workbench): extract ReactFlow canvas`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果 handle id、data attribute 或 className 无法等价保留，停止。
- 如果 focused workflow scope/edge id 变得不确定，停止。
- 如果已有显式 `main -> main` data edge 在 all/data 视图消失，停止。
