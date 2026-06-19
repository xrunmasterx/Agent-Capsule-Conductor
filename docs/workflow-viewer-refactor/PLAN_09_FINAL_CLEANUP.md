# PLAN 09 - 最终收口与技术债删除

## 目标

彻底删除重构过程中留下的兼容层、wrapper/re-export、旧内联实现、测试 barrel、demo factory 和未使用代码。完成后，`WorkflowViewer.tsx` 真正成为 thin shell，并且旧技术债代码不再留在仓库中。

## 前置条件

- PLAN 00-08 全部完成。
- 前端测试、build、浏览器验收均已通过。
- stores/hooks/model/components 已成为真实 owner。

## 写集合

允许修改/删除：

- `web/src/components/WorkflowViewer.tsx`
- `web/src/components/canvas/WorkspaceCanvas.tsx`
- `web/src/components/canvas/NodeRenderer.tsx`
- `web/src/components/canvas/CanvasEditor.tsx`
- `web/src/components/authoring/AuthoringSession.tsx`
- `web/src/components/authoring/ProposalReview.tsx`
- `web/src/components/*/index.ts`
- `web/src/App.test.tsx`
- `web/src/components/WorkflowViewer.drag.test.tsx`
- 所有仍 import `WorkflowViewer.tsx` helper 的测试
- 旧 demo fixture 文件
- 未使用 CSS / i18n keys

禁止修改：

- 后端 runtime/compiler 语义。
- Core v2 schema。
- 已通过验收的 store/model 行为，除非为删除旧兼容层必需。

## 删除清单

1. 删除 `WorkflowViewer.tsx` 巨型 export block。

2. 删除 `WorkflowViewer.tsx` 中所有旧本地实现：
   - `WorkspaceCanvas`
   - `AgentToolNode`
   - `WorkflowContainer`
   - `RightInspector`
   - `WorkflowInspector`
   - `DataConnectionsPanel`
   - `AssistantDrawer`
   - `AssistantDockContent`
   - `ExecutionDock`
   - `LiveOutputViewer`
   - graph/canvas conversion。
   - layout functions。
   - edge ops。
   - demo canvas factory。

3. 删除 wrapper/re-export：
   - `canvas/WorkspaceCanvas.tsx` 不再 re-export `WorkflowViewer`。
   - `canvas/NodeRenderer.tsx` 不再 re-export `WorkflowViewer`。
   - `authoring/AuthoringSession.tsx` 不再 re-export `WorkflowViewer`。
   - `authoring/ProposalReview.tsx` 不再 re-export `WorkflowViewer`。

4. 删除 `__workflowViewerTestables` 或等价 test barrel。

5. 清理测试 import：
   - tests 从真实模块 import。
   - `App.test.tsx` 只保留用户旅程测试。
   - model tests 覆盖 pure functions。

6. 删除重复类型/常量：
   - `WorkflowStatus` mirror。
   - `AssistantChatMessage` mirror。
   - `CanvasAuthoringProposal` mirror。
   - `TASK_STORE_KEY` duplicate。

7. 清理 CSS/i18n：
   - 删除未使用 class。
   - 删除 mojibake 文案。
   - 删除未使用 i18n keys。

8. 清理死代码：
   - `rg` 未引用的 helper。
   - 未使用 imports。
   - 迁移期 TODO。
   - compatibility aliases。

## 完成后的 `WorkflowViewer.tsx` 应该只包含

- props type。
- resource/store bootstrap。
- top-level hooks 调用。
- layout composition。
- `export function WorkflowViewer(...)`。

目标：

- 小于 300 行。
- 最好小于 200 行。
- 只 export `WorkflowViewer`。

## 验收命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

根目录：

```bash
rg "from ['\"].*WorkflowViewer" web/src/components web/src/hooks web/src/stores
rg "__workflowViewerTestables" web/src
rg "export \\{" web/src/components/WorkflowViewer.tsx
rg "api\\.|runnerApi\\.|new EventSource|ReactFlow|graphToWorkspaceCanvas|canvasToWorkflowGraph|workspaceDemoCanvas" web/src/components/WorkflowViewer.tsx
```

预期：

- components/hooks/stores 不从 `WorkflowViewer.tsx` import。
- 没有 `__workflowViewerTestables`。
- `WorkflowViewer.tsx` 不再 export helper。
- `WorkflowViewer.tsx` 不直接调用 API/EventSource。
- `WorkflowViewer.tsx` 不包含 ReactFlow implementation。
- `WorkflowViewer.tsx` 不包含 graph/canvas conversion。
- `WorkflowViewer.tsx` 不包含 demo canvas factory。

## 浏览器最终验收

- 打开 `http://127.0.0.1:5173/`。
- 无 Vite overlay。
- console 无新增 error。
- 加载当前 ACC 示例 canvas。
- `显控制` / `显数据` / `显全部` 正常。
- 当前示例边数与 snapshot/预期一致。
- workflow boundary control preview 正常。
- 显式 data edge 可见并保存。
- 提交运行不返回 `/api/runner/jobs` 400。
- run evidence 能看到正确 binding kind。
- assistant drawer 可用。
- inspector 可用。
- 多 task / 多 run 切换正常。

## 不可回退语义

- 不为了删代码放宽 validation。
- 不为了减行数删除关键测试。
- 不把 Workbench UI projection 写成 durable truth。
- 不把 boundary control edge 写进 runtime control edges。
- 不恢复 `main -> main` 硬编码吞显式 data edge。

## 最终完成定义

本 plan 完成后，重构专项应满足：

- `WorkflowViewer.tsx` 是 thin shell。
- 所有旧 wrapper/re-export 技术债已删除。
- 所有测试从真实模块 import。
- stores/hooks/model/components 的 ownership 清晰。
- 当前 ACC 示例运行行为不回退。
- 文档 `WORKFLOW_VIEWER_REFACTOR_STRATEGY.md` 与实际代码一致。

## Goal 模式执行契约

### Goal

在 PLAN 00-08 都真正完成后，删除迁移期间留下的 wrapper/re-export、compatibility export、测试 barrel、旧内联实现、重复类型/常量、未使用 CSS/i18n 和 demo factory。完成后 `WorkflowViewer.tsx` 是 thin shell，只 export `WorkflowViewer`。

### Non-goals

- 不补做 PLAN 01-08 未完成的大迁移。如果前置条件不成立，本 plan 必须停止。
- 不为了减行数删除关键测试。
- 不为了删代码放宽 validation、改变 runtime/control/data/boundary transfer 语义。

### 前置硬门禁

开始前必须先运行并记录：

```bash
git status --short --branch
rg -n "function WorkspaceCanvas|function AgentToolNode|function WorkflowContainer|function RightInspector|function AssistantDrawer|function ExecutionDock|graphToWorkspaceCanvas|canvasToWorkflowGraph|workspaceDemoCanvas" web/src/components/WorkflowViewer.tsx
rg -n "from '../WorkflowViewer'|from './WorkflowViewer'" web/src/components web/src/hooks web/src/stores web/src
```

如果 `WorkflowViewer.tsx` 仍拥有 ReactFlow、API/EventSource、graph conversion、assistant/inspector/presentational 本地实现，不允许进入删除阶段，必须回到对应 plan。

### 必建迁移表

执行前在 commit message 或 `docs/workflow-viewer-refactor/STATUS.md` 记录 symbol-to-owner 迁移表，至少覆盖：

- `WorkspaceCanvas` -> `web/src/components/canvas/WorkspaceCanvas.tsx`
- `AgentToolNode` / `WorkflowContainer` -> `web/src/components/canvas/NodeRenderer.tsx`
- graph/canvas conversion -> `web/src/workbench/model/canvasProjection.ts`
- edge ops -> `web/src/workbench/model/canvasEdgeOps.ts`
- flow projection/handle helpers -> `web/src/workbench/model/flowProjection.ts` 或 canvas helper module
- run state -> `web/src/components/workflow-viewer/runState.ts` 或 store selector
- authoring proposal -> `web/src/workbench/model/authoringProposal.ts`
- GraphOps proposal/review -> `web/src/workbench/model/graphOpsProposal.ts` 和 hook
- inspector model -> `web/src/workbench/model/*`
- shared types/constants -> `web/src/types/workbench.ts` 与 `web/src/workbench/constants.ts`

### 测试保留策略

- 不按文件删除测试，按职责迁移。
- `WorkflowViewer.drag.test.tsx` 中覆盖 schema-derived ports、显式 data edge、boundary control binding、drag buffer、reparent、scoped edge deletion、run evidence binding 的断言必须迁到对应 model/canvas/run tests。
- `App.test.tsx` 只保留用户旅程：资源库、工作台加载、拖拽、保存/校验/运行、assistant proposal、GraphOps approval、run inspector/evidence、task/run 切换。
- pure helper 断言必须从真实 owner import，不再从 `WorkflowViewer.tsx` 或 `__workflowViewerTestables` import。

### CSS/i18n 删除规则

- 只删除高置信静态未引用 class/key。
- 动态类前缀必须白名单保护：`status-*`、`workflow-edge-*`、`react-flow__*`、`selected`、`open`、`active`、`running`、`success`、`failed`。
- i18n key 不能只靠字符串搜索删除；先确认引用路径和用户可见行为。
- CSS/i18n 清理后必须做浏览器验收或截图/console 检查。

### 静态门禁

```bash
# App.tsx 是唯一允许导入 WorkflowViewer 组件的入口
rg -n "\\.?/WorkflowViewer|components/WorkflowViewer|../WorkflowViewer|./WorkflowViewer" web/src

# 期望无输出
rg -n "__workflowViewerTestables|Extracted from WorkflowViewer|remain.*WorkflowViewer|re-export.*WorkflowViewer|migration period|currently defined inline" web/src
rg -n "^export \\{" web/src/components/WorkflowViewer.tsx
rg -n "api\\.|runnerApi\\.|new EventSource|ReactFlow|MiniMap|NodeResizer|Handle|graphToWorkspaceCanvas|canvasToWorkflowGraph|workspaceDemoCanvas" web/src/components/WorkflowViewer.tsx

# 期望只剩 canonical owner
rg -n "type WorkflowStatus|type AssistantChatMessage|type CanvasAuthoringProposal|TASK_STORE_KEY" web/src
```

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

如果实现触及运行、保存、workflow 编译或 boundary transfer 语义，必须补跑：

```bash
python -m pytest -q tests/server/test_workbench_canvas_snapshots_api.py tests/server/test_runner_api.py tests/unit/test_workbench_adapter.py tests/unit/test_workflow_normalization.py tests/unit/test_schema_driven_ports.py
```

### 浏览器补充验收

- 确认 loaded canvas 不依赖 `workspaceDemoCanvas()` 本地 factory。
- 确认显式 data edge 保存后重新加载仍可见。
- 确认当前 ACC 示例运行后 binding kind 不回退为错误的 control fallback。

### Commit / Push

- 开始前冻结 `git status --short --branch`，明确哪些 dirty 文件属于本 plan。
- 禁止 `git add .`。只 stage PLAN 09 删除/迁移收口相关文件，排除 `.acc/`、`.codex_runtime_logs/`、运行产物、无关后端。
- 提交前运行 `git diff --check`、`git diff --cached --name-only`、`git diff --cached --stat`。
- commit message 建议：`refactor(web): finalize WorkflowViewer cleanup`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果 PLAN 01-08 任一 owner 未完成，停止并回到对应 plan。
- 如果某个测试断言无法确定迁往哪里，不删除该测试，先建 owner module 或保留并标记。
- 如果 CSS/i18n 是否未使用无法证明，保留它，不为追求清理数量冒险。
