# PLAN 04 - 小型展示组件等价替换

## 目标

先迁移低风险展示组件，减少 `WorkflowViewer.tsx` 体积，同时验证已抽出的组件是否与内联版本等价。这个 plan 不迁 ReactFlow canvas，不迁 store ownership。

## 前置条件

- PLAN 03 已完成。
- hooks 已能提供 run/assistant/task/boundary preview 的 effect 状态。

## 写集合

允许修改：

- `web/src/components/execution/ExecutionDock.tsx`
- `web/src/components/execution/RunOverlay.tsx`
- `web/src/components/execution/index.ts`
- `web/src/components/inspector/NodeDetailOverlay.tsx`
- `web/src/components/inspector/SelectionDetailsDock.tsx`
- `web/src/components/workbench/WorkbenchShell.tsx`
- `web/src/components/workbench/TopBar.tsx`
- `web/src/components/workbench/TaskRail.tsx`
- `web/src/components/workbench/TaskOverviewPage.tsx`
- `web/src/components/workbench/TaskWorkspaceSwitcher.tsx`
- `web/src/components/workbench/SaveWorkflowDialog.tsx`
- `web/src/components/WorkflowViewer.tsx`
- `web/src/i18n/zh-CN.ts` 或等价 i18n 文件
- 相关 tests

禁止修改：

- `WorkspaceCanvas` / ReactFlow interaction。
- canvas graph conversion。
- store ownership。

## 任务清单

1. 对比内联组件和 extracted component：
   - props 是否完整。
   - disabled 状态是否一致。
   - className 是否一致。
   - aria label 是否一致。
   - 中文文案是否正确。

2. 修复 mojibake：
   - `ExecutionDock.tsx`
   - `NodeDetailOverlay.tsx`
   - 其他已抽出的中文 UI 文件。
   - 优先使用 `i18n/zh-CN.ts`，至少保证 UTF-8 正确。

3. 替换小型组件：
   - 用 extracted `ExecutionDock` 替换主文件本地 `ExecutionDock`。
   - 用 extracted `RunOverlay` / `LiveOutputViewer` 替换本地版本。
   - 用 extracted `NodeDetailOverlay` 替换本地 overlay chrome。
   - 用 extracted workbench shell/topbar/task components 替换本地布局片段。

4. `SelectionDetailsDock` 谨慎替换：
   - 先补齐内联版本的 evidence actions。
   - 补齐 `onReadEvidence`。
   - 补齐 assistant body class / bottom dock mode。
   - 再切换 import。

5. 删除主文件中已经不用的本地组件定义。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

并满足：

- execution buttons 文案、disabled、click 行为一致。
- run overlay 和 live output 展示一致。
- evidence dock 所有操作仍可用。
- 中文文案不再出现 mojibake。
- `WorkflowViewer.tsx` 本地小组件定义减少。

## 手工浏览器验收

- 打开 Workbench。
- 顶栏、任务栏、执行栏正常显示。
- 切换任务总览/蓝图。
- 打开/关闭 bottom dock。
- 查看 run evidence。
- 打开 live output。

## 不可回退语义

- 只做展示组件等价替换，不改变 run submit 语义。
- 不改变 data/control edge 语义。
- 不改变 boundary transfer preview 语义。

## 交接给下一 plan

PLAN 05 可以拆 Inspector。进入 PLAN 05 前，低风险展示组件应不再依赖 `WorkflowViewer.tsx` 本地实现。

## Goal 模式执行契约

### Goal

把已经抽出的展示组件追平内联版本并切换到主渲染路径。完成后 `WorkflowViewer.tsx` 不再保留低风险展示组件本地实现，也不再出现 `*Extracted` 临时别名。

### Non-goals

- 不迁移 ReactFlow canvas、graph conversion、edge ops、store ownership。
- 不改变 run submit、boundary transfer、assistant/GraphOps 语义。
- 不把 `NodeDetailOverlay` 误当完整业务详情组件替换；它只能作为 chrome wrapper 包住现有 panes。

### 执行分片

1. 先补抽取组件等价测试，不切主路径。
2. 追平抽取组件：`WorkbenchShell` 补 `durableTasksReady` 与 `data-durable-tasks-ready`；`SelectionDetailsDock` 补 `evidenceActions`、`onReadEvidence`、assistant body class；`LiveOutputViewer` 迁移当前 transcript/filter/pinned scroll/跳到最新行为；`NodeDetailOverlay` 明确是 chrome wrapper。
3. 逐个切换主路径：Workbench shell/topbar/task rail/task overview/task switcher/save dialog，随后 `ExecutionDock`，随后 `LiveOutputViewer`，随后 `SelectionDetailsDock`，最后 `NodeDetailOverlay` chrome。
4. 每切一个组件就删除对应本地函数，避免 import 了 extracted 但实际没用。
5. 最后做 targeted i18n 清理，用户可见英文 label 统一中文或明确保留为技术词。

### 必补测试样例

- `ExecutionDock`：运行任务、只运行 workflow、只运行节点按钮的 disabled、文案、click handler 与当前行为一致。
- `WorkbenchShell`：`durableTasksReady` 会写出 `data-durable-tasks-ready="true"`。
- `SelectionDetailsDock`：evidence action button 会调用 `onReadEvidence(path, title)`；assistant mode 保留 `.selection-details-body.assistant-console-body`。
- `LiveOutputViewer`：保留当前 `输出/日志/stdout/stderr/错误/raw` filter、ACC transcript、pinned scroll、跳到最新。
- `NodeDetailOverlay`：chrome 包住输入、属性、输出三个 pane，不吞 children。
- targeted mojibake smoke：展示组件渲染文本不包含 `�`、`鐢`、`杩`、`鎵`、`鑺` 等明显乱码。

### 静态门禁

```bash
rg -n "function WorkbenchShell|function SaveWorkflowDialog|function ExecutionDock|function TaskWorkspaceSwitcher|function TaskOverviewPage|function TaskRail|function TopBar|function NodeDetailOverlay|function SelectionDetailsDock|function LiveOutputViewer" web/src/components/WorkflowViewer.tsx
rg -n "Extracted" web/src/components/WorkflowViewer.tsx
rg -n "[�]|鐢|杩|鎵|浠|鑺|璇|鍙|鏈|钃|甯|浜" web/src/components/execution web/src/components/inspector web/src/components/workbench web/src/i18n
```

预期：前两条无结果；第三条无用户可见组件乱码。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

### Commit / Push

- 禁止 `git add .`。如果 `WorkflowViewer.tsx` 同时有其他 plan 的改动，使用 `git add -p web/src/components/WorkflowViewer.tsx` 分块 stage。
- 只 stage `web/src/components/execution/*`、`web/src/components/inspector/SelectionDetailsDock*`、`web/src/components/workbench/*`、必要的 `WorkflowViewer.tsx` 替换 hunk、相关 tests 和本文档。
- commit message 建议：`refactor(web): replace WorkflowViewer presentational components`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果抽取版组件比内联版本少 evidence action、live output filter、assistant class 或 durable readiness marker，停止，先补等价功能和测试。
- 如果为了切换展示组件需要改 canvas/run/boundary/assistant 语义，停止并移交对应 plan。
