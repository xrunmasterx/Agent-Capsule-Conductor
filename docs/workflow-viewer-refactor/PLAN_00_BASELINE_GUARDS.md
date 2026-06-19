# PLAN 00 - 基线护栏与迁移准入

## 目标

在正式拆 `WorkflowViewer.tsx` 前，先把测试基线、噪声、关键语义护栏固定下来。这个 plan 不追求减少主文件行数，只为后续 9 个 plan 提供可比较、可失败、可定位的验收边界。

## 为什么必须先做

当前 `WorkflowViewer.tsx` 同时承载 ReactFlow、workflow boundary transfer、显式 data edge、run stream、assistant authoring、GraphOps 等关键行为。没有基线护栏就开始移动代码，会很难判断失败来自重构本身、历史测试噪声，还是已有行为缺口。

## 写集合

允许修改：

- `web/src/App.test.tsx`
- `web/src/components/WorkflowViewer.drag.test.tsx`
- `web/src/components/canvas/boundaryTransfer.test.ts`
- `web/src/components/inspector/SelectionDetailsDock.test.tsx`
- `web/src/test-utils/*` 或等价测试 helper
- `docs/workflow-viewer-refactor/*` 状态记录

禁止修改：

- `web/src/components/WorkflowViewer.tsx` 的生产逻辑
- `web/src/stores/*`
- `web/src/hooks/*`
- 后端 compiler/runtime 逻辑

## 任务清单

1. 记录当前基线：
   - `WorkflowViewer.tsx` 行数和大小。
   - `npx tsc --noEmit` 结果。
   - `npm run test -- --run` 结果。
   - `npm run build` 结果。

2. 清理测试噪声：
   - 补齐 autosave / workbench task persistence 相关 mock route。
   - 让测试失败只表示真实行为失败，不被 404 stderr 噪声干扰。

3. 标记迁移门禁用例：
   - workflow boundary control 不进入 runtime `control_edges`。
   - boundary transfer preview 使用后端结果。
   - 显式 data edge 优先于 control fallback。
   - 已存在 `main -> main` data edge 必须显示和保存。
   - ReactFlow drag/drop、focused workflow、boundary handle projection。
   - assistant authoring turn 和普通 chat turn 的差异。

4. 从 `App.test.tsx` 和 `WorkflowViewer.drag.test.tsx` 中识别纯函数测试：
   - 先加注释或 TODO 标记未来迁出位置。
   - 本 plan 不迁移 import，避免提前制造循环依赖。

5. 建立阶段记录：
   - 在 `docs/workflow-viewer-refactor/STATUS.md` 记录基线命令和结果。
   - 如果暂不创建 `STATUS.md`，至少在本 plan 执行 PR/commit 描述中记录。

## 验收标准

必须通过：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

并满足：

- 测试中没有非预期 autosave 404 stderr 噪声。
- 当前 ACC 示例相关测试仍覆盖 boundary transfer 和显式 data edge。
- 没有生产行为改动。
- 没有修改 backend runtime/compiler 语义。

## 回归护栏

本 plan 后续所有 plan 都必须继承这些护栏：

- 前端不能伪造 boundary transfer 成功结果。
- 后端 canonical compiler 仍是 boundary transfer 权威裁判。
- 显式 data edge 不能被端口名过滤误删。
- UI projection 不能成为 durable truth。
- 多 run 状态不能退回全局 singleton。

## 交接给下一 plan

进入 PLAN 01 前应满足：

- 测试基线稳定。
- 关键语义测试可重复运行。
- 已明确哪些测试是纯函数测试，后续迁到新模块。

