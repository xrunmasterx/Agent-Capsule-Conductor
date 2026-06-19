# WorkflowViewer Refactor Goal Execution Prompt

下面这份 prompt 用于交给 Goal 模式逐个执行 `PLAN_01` 到 `PLAN_09`。推荐一次只执行一个 plan；每个 plan 完成后必须验证、提交并 push 到当前 `dev_v3` 分支，再进入下一个 plan。

## 单个 Plan 执行 Prompt

```text
你现在在 F:\Agent-Capsule-Conductor-v2 的 Goal 模式中工作。目标是执行 WorkflowViewer 重构专项中的一个 plan，并在完成后提交且 push 到当前 dev_v3 分支。

本次执行的计划：
- PLAN_ID: <填写 PLAN_01 到 PLAN_09，例如 PLAN_01>
- PLAN_FILE: docs/workflow-viewer-refactor/<填写对应文件名，例如 PLAN_01_TYPES_AND_CONSTANTS.md>

必须先阅读并遵守：
1. AGENTS.md
2. docs/workflow-viewer-refactor/WORKFLOW_VIEWER_REFACTOR_STRATEGY.md
3. docs/workflow-viewer-refactor/PLAN_00_BASELINE_GUARDS.md
4. 本次 PLAN_FILE 的完整内容，尤其是 “Goal 模式执行契约”

执行规则：
1. 先检查 `git status --short --branch`，记录当前脏工作树。不要 revert、checkout、reset 用户或其他任务已有改动。
2. 只改 PLAN_FILE 允许的写集合。遇到必须越界修改的情况，先停止并说明原因，不要顺手扩大范围。
3. 不要使用 `git add .`。提交前只 stage 本 plan 的代码、测试和文档文件。
4. 不要提交 `.acc/`、`.codex_runtime_logs/`、运行产物、临时 canvas、无关后端或其他 plan 的改动。
5. 先补测试再做高风险迁移。每个迁移分片结束后跑 targeted tests；最终必须跑该 plan 要求的全部验证命令。
6. `WorkflowViewer.tsx` 是被拆分对象，不允许新模块为了省事从它 import 类型、helper 或组件，除非该 plan 明确允许短期 compatibility export，并且必须标注 PLAN_09 删除。
7. 保持核心语义不回退：
   - boundary control transfer 不进入 runtime `control_edges`
   - 后端 canonical compiler 是 boundary transfer 权威裁判
   - 显式 data edge 永远优先于 control fallback
   - 已存在显式 `main -> main` data edge 必须显示、保存、roundtrip
   - 多 run 状态不能退回全局 singleton
   - assistant 普通 chat 不能触发 authoring draft validation
   - GraphOps destructive apply 必须经过 validation、dry-run、approval
8. 如果当前 plan 的前置条件不满足，停止并报告应先执行哪个前置 plan。不要用临时复制代码绕过前置条件。

验证要求：
1. 最低前端验证：
   ```bash
   cd web
   npx tsc --noEmit
   npm run test -- --run
   npm run build
   ```
2. 如果本 plan 文件列出后端或 targeted 测试，也必须运行。
3. 如果某项测试无法运行，必须说明具体命令、失败原因、影响范围和下一步，而不是静默跳过。
4. 如果涉及浏览器验收，刷新 http://127.0.0.1:5173/，确认无 Vite overlay、无新增 console error，并按 plan 的手工验收清单检查。

提交与 push：
1. 验证通过后运行：
   ```bash
   git status --short --branch
   git diff --cached --name-only
   git diff --cached --stat
   ```
2. 使用本 plan 推荐的 commit message。如果没有推荐，使用 `refactor(web): execute <PLAN_ID>`。
3. 提交后执行：
   ```bash
   git push origin dev_v3
   ```
4. 最终回复必须包含：
   - 执行的 PLAN_ID
   - 改动摘要
   - 新增/修改的关键测试
   - 实际运行的验证命令和结果
   - commit hash
   - push 结果
   - 若有未完成项或风险，明确列出
```

## 全序列执行顺序

不要并行实现这 9 个 plan。推荐顺序如下：

1. `PLAN_01_TYPES_AND_CONSTANTS.md`
2. `PLAN_02_PURE_MODEL_EXTRACTION.md`
3. `PLAN_03_EFFECT_HOOKS.md`
4. `PLAN_04_PRESENTATIONAL_COMPONENTS.md`
5. `PLAN_05_INSPECTOR.md`
6. `PLAN_06_ASSISTANT_GRAPHOPS.md`
7. `PLAN_07_REACTFLOW_CANVAS.md`
8. `PLAN_08_STORE_OWNERSHIP.md`
9. `PLAN_09_FINAL_CLEANUP.md`

每个 plan 都必须独立验证、独立 commit、独立 push。后一个 plan 如果发现前一个 plan 没有真正完成，必须停止并回补前置 plan，不能继续叠加半迁移。

## Plan 文件名映射

```text
PLAN_01 -> docs/workflow-viewer-refactor/PLAN_01_TYPES_AND_CONSTANTS.md
PLAN_02 -> docs/workflow-viewer-refactor/PLAN_02_PURE_MODEL_EXTRACTION.md
PLAN_03 -> docs/workflow-viewer-refactor/PLAN_03_EFFECT_HOOKS.md
PLAN_04 -> docs/workflow-viewer-refactor/PLAN_04_PRESENTATIONAL_COMPONENTS.md
PLAN_05 -> docs/workflow-viewer-refactor/PLAN_05_INSPECTOR.md
PLAN_06 -> docs/workflow-viewer-refactor/PLAN_06_ASSISTANT_GRAPHOPS.md
PLAN_07 -> docs/workflow-viewer-refactor/PLAN_07_REACTFLOW_CANVAS.md
PLAN_08 -> docs/workflow-viewer-refactor/PLAN_08_STORE_OWNERSHIP.md
PLAN_09 -> docs/workflow-viewer-refactor/PLAN_09_FINAL_CLEANUP.md
```

## 每次执行前的快速自检

```bash
git status --short --branch
git branch --show-current
rg -n "from '../WorkflowViewer'|from './WorkflowViewer'|components/WorkflowViewer" web/src/components web/src/hooks web/src/stores
```

这组命令不是每个 plan 的完整验收，只用于帮助 Goal 在开始前识别当前处于哪个迁移阶段。
