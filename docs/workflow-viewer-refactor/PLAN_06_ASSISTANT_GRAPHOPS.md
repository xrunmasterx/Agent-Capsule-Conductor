# PLAN 06 - Assistant 与 GraphOps 拆分

## 目标

把 assistant UI、assistant session lifecycle、authoring proposal、GraphOps proposal/validation/dry-run/apply 从 `WorkflowViewer.tsx` 中拆出。完成后，主文件不再直接管理 assistant turn、proposal apply、GraphOps review 的完整流程。

## 前置条件

- PLAN 02 已抽出 authoring proposal pure functions。
- PLAN 03 已抽出 assistant session/turn hooks。
- PLAN 05 已能提供 selection/canvas view model 给 assistant。

## 写集合

允许新增/修改：

- `web/src/components/assistant/AssistantDrawer.tsx`
- `web/src/components/assistant/AssistantDockContent.tsx`
- `web/src/components/assistant/AssistantGraphOpsReview.tsx`
- `web/src/components/assistant/AssistantProposalSummary.tsx`
- `web/src/components/authoring/ProposalReview.tsx`
- `web/src/workbench/model/authoringProposal.ts`
- `web/src/workbench/model/graphOpsProposal.ts`
- `web/src/hooks/useAssistantSession.ts`
- `web/src/hooks/useAssistantTurnStream.ts`
- `web/src/hooks/useGraphOpsReview.ts`
- `web/src/stores/assistantStore.ts`
- `web/src/components/WorkflowViewer.tsx`
- assistant/authoring tests

禁止修改：

- ReactFlow canvas。
- Store ownership 大迁移，除 assistant store 必要接入外。
- 后端 GraphOps API。

## 任务清单

1. 统一 assistant 类型：
   - `AssistantChatMessage`
   - `CanvasAuthoringProposal`
   - `CanvasAuthoringValidationResult`
   - `AssistantGraphOpsReview`
   - `AssistantApplyUndoToken`

2. 迁 authoring pure model：
   - capture authoring snapshot。
   - stable hash。
   - deterministic proposal build。
   - proposal validation。
   - proposal apply command。

3. 迁 GraphOps pure model：
   - temporary resource -> GraphOps transaction。
   - proposal id generation。
   - review view model。

4. 迁 hooks：
   - create/reuse assistant session。
   - submit workbench assistant turn。
   - stream assistant turn events。
   - validate assistant draft。
   - create/validate/dry-run/apply GraphOps proposal。

5. 迁 UI：
   - `AssistantDrawer`
   - `AssistantDockContent`
   - proposal summary。
   - GraphOps review controls。
   - required actions list。

6. 主文件收口：
   - `WorkflowViewer.tsx` 只渲染 Assistant 入口。
   - 删除本地 `AssistantDrawer` / `AssistantDockContent`。
   - 删除本地 GraphOps apply 流程。

## 必须覆盖的测试

- 普通 chat turn。
- canvas revision turn。
- selected node revision turn。
- authoring proposal validation。
- proposal apply 更新 canvas 且产生 undo token。
- undo token 恢复 before state。
- temporary agent proposal。
- GraphOps create -> validate -> dry-run -> approve -> apply。
- GraphOps validation failure 不允许 approve/apply。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

并满足：

- `WorkflowViewer.tsx` 不再定义 `AssistantDrawer`。
- `WorkflowViewer.tsx` 不再定义 `AssistantDockContent`。
- `WorkflowViewer.tsx` 不直接调用 assistant/GraphOps API。
- assistant proposal 类型只有一个 authoritative definition。

## 手工浏览器验收

- 打开 assistant drawer。
- 发送普通 chat。
- 发送 canvas revision 请求。
- 对 selected node 发 revision 请求。
- 查看 proposal。
- apply proposal。
- undo apply。
- 创建 temporary agent 并走 GraphOps review。

## 不可回退语义

- 普通 chat turn 不触发 draft validation。
- authoring turn 才触发 draft validation。
- GraphOps destructive apply 仍需 validation + dry-run + approval。
- proposal apply 不能绕过 Workbench canvas mutation 规则。

## 交接给下一 plan

PLAN 07 可以迁 ReactFlow canvas。进入 PLAN 07 前，assistant 不再依赖 `WorkflowViewer.tsx` 本地函数，只通过 hooks/store/actions 与 canvas 交互。

## Goal 模式执行契约

### Goal

把 Assistant drawer/dock、authoring proposal、assistant session stream、GraphOps review/apply flow 从 `WorkflowViewer.tsx` 中拆出，并保持 authoring 与普通 chat 的语义差异。完成后 authoring/assistant 模块不再从 `WorkflowViewer.tsx` re-export 类型或函数。

### Non-goals

- 不迁移 ReactFlow canvas 或 inspector。
- 不把 full canvas/task store ownership 一次性迁走，这属于 PLAN 08。
- 不把 GraphOps destructive apply 简化成绕过 validation/dry-run/approval。

### 执行分片

1. 建立 authoritative 类型：GraphOps API DTO 继续来自 `web/src/types.ts`；authoring/canvas 类型放入 `web/src/workbench/model/authoringProposal.ts` 和 `graphOpsProposal.ts`；UI/store/hook 只 import。
2. 真实迁出 authoring pure functions，不再通过 `components/authoring/*` 从 `WorkflowViewer.tsx` re-export。
3. 抽 `useAssistantSession`：session key 必须包含 `task_id + selectedAuthoringAgentId + provider_session policy`；task/agent switch 要 reset 或按 task scope 保存。
4. 修正并接入 `useAssistantTurnStream`：普通 `workbench_chat` 不 validate draft；authoring turn 只有 turn id 匹配才 validate。
5. 抽 `useGraphOpsReview` 状态机：`idle -> creating -> validating -> dryRunning -> reviewReady -> approving -> applying -> applied | failed | rejected`。
6. 明确 discard 策略：要么调用后端 reject endpoint，要么文案明确只是本地关闭；推荐调用 reject 并补测试。
7. GraphOps apply 成功后的 canvas replacement 通过显式 callback/action 完成，UI 组件内不散落 API 与 canvas mutation。
8. 替换主路径 `AssistantDrawer` / `AssistantDockContent`，删除本地定义和 `*Extracted` 别名。

### 必补测试样例

- `authoringProposal.test.ts`：capture snapshot strip runtime state；hash stable；stale base hash invalid；selected node revision 只改目标节点；temporary agent 只产生 canvas-local resource；replacement 不能指向 real callable。
- 如果保留 deterministic 字样，提供固定 `idFactory` 的 determinism test；否则把目标改成 stable validation/apply，不承诺随机 id deterministic。
- `useAssistantTurnStream.test.ts`：普通 chat 不 validate；canvas revision 且 turn id 匹配 validate；malformed SSE 后 polling 恢复；terminal 后 close stream、clear pending、busy=false。
- `useAssistantSession.test.ts`：drawer open create/reuse；同 task 同 agent reuse；切 task/agent reset；submit turn 带 `expected_provider_session_id`；失败时保留错误并不污染 proposal。
- `graphOpsProposal.test.ts`：temporary draft 生成 safe target path；absent base hash；路径逃逸/非法 id 被拒。
- `useGraphOpsReview.test.ts`：validate/dry-run failure 不允许 approve；approve payload 包含 dryRun 的 `target_paths`、`dry_run_digest`、`base_hashes`；apply failure 不丢 review；discard/reject 策略可观测。
- `AssistantGraphOpsReview.test.tsx`：reviewReady 显示 target/warnings；busy disabled；invalid/dryRun missing 不显示 approve。
- 保留 App 集成：canvas proposal apply/undo、chat 不 validate、temporary agent GraphOps approve/apply，断言 approve 在 apply 前发生。

### 静态门禁

```bash
rg -n "function AssistantDrawer|function AssistantDockContent" web/src/components/WorkflowViewer.tsx
rg -n "api\\.(submitWorkbenchAssistantTurn|validateAssistantDraft|createGraphOpsProposal|validateGraphOpsProposal|dryRunGraphOpsProposal|approveGraphOpsProposal|applyGraphOpsProposal)" web/src/components/WorkflowViewer.tsx
rg -n "from '../WorkflowViewer'|from './WorkflowViewer'" web/src/components/authoring web/src/components/assistant web/src/hooks web/src/workbench
rg -n "type CanvasAuthoringProposal|type TemporaryResourceDraft|type AssistantGraphOpsReview|type AssistantApplyUndoToken" web/src
```

预期：前三条无结果；第四条只出现在 authoritative model 或必要 barrel。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

如改动 GraphOps API contract mock，补跑相关 server tests。

### Commit / Push

- 只 stage `web/src/components/assistant/*`、`web/src/components/authoring/*`、相关 hooks、`web/src/workbench/model/*`、`assistantStore.ts` 中本 plan 的 assistant state、必要 `WorkflowViewer.tsx` 删除 hunk、相关 tests 和本文档。
- 不 stage unrelated backend/server、ReactFlow canvas、inspector、`.acc/`、`.codex_runtime_logs/`。
- commit message 建议：`refactor(web): extract assistant graphops workflow`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果普通 chat 会触发 draft validation，停止。
- 如果 GraphOps approve/apply 能绕过 validation 或 dry-run，停止。
- 如果 GraphOps apply 后 UI 暗示可以撤销持久文件，但实际只撤销 canvas local replacement，停止并修正文案/语义。
