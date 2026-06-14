# ACC SDD 04: Authoring And Governance

## 1. Purpose

本文件定义 ACC 的作者ing与治理模型。它回答一个核心问题：

> 当人类或 LLM 想创建、修改、调度、恢复 workflow/callable 时，ACC 如何保证变更是显式、可验证、可审计、可回放、可拒绝的？

当前 ACC 不是一个让 LLM 自由写文件、自由起进程、自由修改 workflow 的系统。它的治理边界分成两层：

1. **定义态治理**：`AuthoringSessionService` 让 LLM 产生 canvas proposal；`GraphOpsService` 让持久化资产变更进入 proposal -> validation -> dry-run -> human approval -> apply。
2. **运行态治理**：human gate、supervisor、handoff、decision/replay 在 run dir 内写入 `InteractionRequest`、`DecisionRecord`、`PlanStepTransitionRecord`、`WakeupRequest` 等证据，避免运行时动态行为变成不可追踪的隐式副作用。

本文件不是 UI 使用说明，也不是 GraphOps API 列表。它是治理契约：后续实现、重构、测试和 AI 生成代码必须服从这里的边界。

## 2. First Principles

ACC 治理模型建立在几个第一性原理上。

第一，**LLM 的输出不是事实，只是候选意图**。

LLM 可以提出 workflow 分解、节点新增、临时 agent draft、GraphOps transaction、supervisor plan 或 handoff intent，但这些内容在通过 schema、policy、dry-run、人审和 ledger 写入前，都不是 durable truth。

第二，**可复用定义和运行事实必须分离**。

`workflows/*.accflow.json`、`callables/agents/*.yaml`、`callables/tools/*.yaml` 是定义态资产；`runs/<run_id>/...` 是运行态证据。GraphOps 只能治理定义态资产的持久化变更；human gate、supervisor、handoff 只能在 run-scoped evidence 中记录运行态决策。两者不能互相伪装。

第三，**所有跨边界行为必须有证据链**。

用户批准、拒绝、supervisor 选择、handoff 选择、wakeup、resume、apply、apply failure，都必须留下文件或 JSONL 记录。ACC 后续要能回答：谁做了决定、基于什么输入、选择了什么、拒绝了什么、产生了哪些后果、是否可 replay。

第四，**dry-run 和 approval 不是 UI 装饰，而是 mutation gate**。

对持久化资源的写入必须先产生可审查 evidence。GraphOps `approval` 绑定 `target_paths`、`base_hashes` 和 `dry_run_digest`，目的就是防止“用户批准的是 A，实际 apply 的是 B”。

第五，**运行态恢复不是 fresh run**。

waiting/resume 路径必须读取已有 `run_plan.json`、`plan_steps.jsonl`、`decisions.jsonl`、`interactions/*.json`，不能删除 run dir，不能重跑已经成功的 step，不能重新询问 supervisor LLM 来替代已有 `DecisionRecord`。

## 3. Scope And Ownership

本板块拥有以下治理能力：

- Authoring session：面向 Workbench canvas 的 AI 辅助编辑会话。
- GraphOps：面向 workflow/callable 持久化资产的受控变更事务。
- Human gate：面向运行中 node dispatch 的人工批准/拒绝。
- Decision inbox：面向待处理 run failure、manual review、GraphOps proposal 的聚合视图。
- Supervisor：面向运行态动态计划的结构化意图、roster 校验、PlanStep 物化和 replay。
- Handoff：面向运行态任务移交的受控 PlanStep 生成和证据快照。
- Decision/replay：面向治理决策的 durable record 和复用规则。

本板块不拥有以下事情：

- 不定义 Core v2 workflow 执行主循环；那属于 `03-runtime-and-evidence.md`。
- 不定义 Workbench 组件布局；那属于 `05-interfaces-and-workbench.md`。
- 不定义 domain model 字段全集；那属于 `02-domain-and-contracts.md`。
- 不允许引入自定义 LLM reasoning loop。
- 不允许把 Workbench UI state 当作 durable truth。
- 不允许 GraphOps 修改 run evidence 后把它伪装成 reusable template。

## 4. Authoring Session Model

### 4.1 Current Code Ownership

当前实现入口：

- `acc/app/authoring.py`
- `acc/server/routes/authoring.py`

持久化目录：

```text
runs/_authoring_sessions/<session_id>/
  session.json
  context_snapshot.json
  messages.jsonl
  agent_output.json
  agent_output_raw.txt
  validation.json
  agent_run/
  workspace/
```

HTTP API：

```text
GET  /api/authoring/agents
POST /api/authoring/sessions
GET  /api/authoring/sessions/{session_id}
POST /api/authoring/sessions/{session_id}/messages
POST /api/authoring/proposals/validate
POST /api/authoring/proposals/dry-run
```

### 4.2 Mechanism

Authoring session 的输入不是整个项目源码，而是一个受控 context：

```text
user message
  + latest canvas_snapshot
  + canvas_hash
  + selection
  + callable_catalog
  + workflow_catalog
  + previous proposal/validation
  -> authoring agent
  -> CanvasAuthoringProposal
  -> validate_proposal()
  -> dry_run_proposal()
```

`AuthoringSessionService.create_session()` 创建 session 目录，写入 `session.json` 和 `context_snapshot.json`。`post_message()` 写入用户消息，运行 authoring agent，解析输出，再把 `last_proposal`、`validation`、`required_actions` 写回 `session.json`。

Authoring agent 的输出契约是 `AUTHORING_OUTPUT_SCHEMA_VERSION = "acc.authoring.output.v1"`。核心规则写在 `AUTHORING_CORE_RULES` 中，其中最关键的治理约束是：

- 只能生成 `CanvasAuthoringProposal` operations。
- 不能运行 workflow。
- 不能写文件。
- 不能调用 persistence API。
- 不能直接修改 `workflows/`、`callables/`、`AGENTS.md` 或 skills。
- 只能使用 `callable_catalog` 中存在的 callable id。
- 新 agent 只能走 `create_temporary_agent_template`，在 GraphOps 持久化前不可运行。
- 持久化 agent/tool/workflow 创建必须走 GraphOps proposal。

这意味着 authoring session 的职责是“生成可审查的 canvas 变更建议”，不是“替用户直接保存项目资产”。

### 4.3 Proposal Operation Boundary

当前允许的 authoring operations 是：

```text
add_existing_callable_node
add_workflow_container
update_invocation_input
update_invocation_label
update_output_schema
set_ports
add_control_edge
add_data_edge
remove_edge
create_temporary_agent_template
replace_temporary_template_with_existing_callable
```

这些 operation 只描述 canvas 层变更，不等于 durable GraphOps transaction。

`validate_proposal()` 会检查：

- `base_task_id` 是否匹配当前 task。
- `base_canvas_hash` 是否匹配当前 canvas。
- `operations` 是否存在且非空。
- operation 是否在 allowlist 中。
- scope workflow 是否存在且是 workflow container。
- 新 node id 是否重复。
- `add_existing_callable_node` 引用的 callable 是否存在。
- `create_temporary_agent_template` 的 `draft_id` 是否以 `tmp_agent_` 开头。
- `replace_temporary_template_with_existing_callable` 引用的临时资源是否存在。
- update/set ports 的目标 node 是否存在。
- control/data edge endpoints 是否存在。
- `main -> main` data edge 是否被误用。
- `output_schema` 是否是 ACC 支持的 strict subset。
- `output_schema` 是否和 `user_prompt` 明显不匹配。
- 若请求意图是多步骤 workflow，proposal 是否低配成过少 callable nodes 或缺少并行结构。

`dry_run_proposal()` 当前不写文件，只返回：

```text
status
validation
operation_counts
semantic_summary
writes: { workflows: 0, callables: 0, runs: 0 }
```

这是刻意设计：authoring dry-run 验证 canvas 操作语义，不承担 durable persistence。

### 4.4 Draft-To-Publish Boundary

Authoring proposal 和 GraphOps transaction 的边界必须按“草稿编辑”和“正式发布”分层处理，不能把每一次 canvas 操作都升级成持久化审批，也不能让 UI 直接把临时 canvas proposal 写成 project asset。

直观规则：

```text
Draft Mode:
  AI/user edit canvas quickly
  -> validate canvas operations
  -> apply to in-memory/workbench task state
  -> allow undo/redo and manual adjustment
  -> no writes to workflows/* or callables/*

Publish Boundary:
  user chooses save/publish/apply-to-project-assets
  -> compute final canvas diff against durable base
  -> convert final diff into GraphOps transaction
  -> validate + dry-run once for the whole batch
  -> show semantic diff and risk flags
  -> human approve/reject

Governed Apply:
  approved GraphOps transaction
  -> re-check base hashes and dry_run_digest
  -> apply to workflows/*.accflow.json or callables/*
  -> write apply_manifest.json or failure evidence
```

因此 `undo` / `redo` 属于 Workbench 草稿层能力，只能撤销当前编辑会话中的 canvas state change。它不能替代 GraphOps，因为它不回答这些持久化问题：

- 这次正式写入改了哪些 target files？
- 写入基于哪个 base hash？
- 是否覆盖了其他用户或 agent 的并发修改？
- 变更后的 workflow/callable schema 是否合法？
- 是否删除 human gate、提升 permission、加入 dangerous policy 或写入 runtime state？
- 谁批准了这次 durable mutation？
- apply 后产生了哪些 manifest、diff、failure evidence？

风险分级规则：

| Change Type | Governance |
| --- | --- |
| canvas pan/zoom/selection/layout-only state | Workbench local state; no GraphOps |
| unsaved node/edge/prompt edits in current task canvas | Authoring validation + undo/redo; no durable write |
| saving a workflow `.accflow.json` from final canvas state | at least canonical validation + semantic diff; GraphOps transaction when AI-assisted or replacing durable asset |
| creating/updating callable templates, permissions, system prompts, human gates, destructive graph changes | full GraphOps validate -> dry-run -> human approval -> apply |

实现上，Authoring 层只能产生 canvas proposal 或 temporary resource draft。真正要写入 `workflows/`、`callables/agents/` 或 `callables/tools/` 时，必须通过一个显式转换层把最终 canvas diff materialize 成 GraphOps transaction。这个转换层至少要绑定：

- source authoring session / proposal id。
- base task id 和 base canvas hash。
- target paths。
- expected base hashes。
- canonical `.accflow.json` 或 callable template payload。
- semantic diff summary。
- risk flags。

这条规则的目的不是增加操作负担，而是把快节奏试错限制在草稿层，把长期可执行资产的写入放在可审计边界上。

### 4.5 Hermetic Mode

当 `acc_run_mode() == HERMETIC_RUN_MODE` 时，authoring 不调用真实外部 agent，而是使用 `hermetic_authoring_output()`。这是为了保证默认测试不依赖 Codex、Claude、Cursor、Gemini、网络或付费服务。

非 hermetic 模式下，`_invoke_external_authoring_agent()` 会构造临时 `ScopeFrame`、`SessionInstance` 和 `NodeInvocationSpec`，将 authoring agent 当作受限 agent_class 运行。其 `PermissionProfile` 由 `authoring_permission_profile()` 提供，且 input payload 明确包含：

```text
no_custom_llm_loop: true
no_persistent_writes: true
output_schema: acc.authoring.output.v1
```

## 5. GraphOps Control Plane

### 5.1 Current Code Ownership

当前实现入口：

- `acc/graphops.py`
- `acc/server/routes/graphops.py`
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`

持久化目录：

```text
runs/_graphops_proposals/<proposal_id>/
  proposal.json
  validation.json
  dry_run.json
  semantic_diff.json
  approval.json
  apply_manifest.json
  apply_error.json
  stale_base.json
  rejection.json
```

HTTP API：

```text
POST /api/graphops/proposals
GET  /api/graphops/proposals
GET  /api/graphops/proposals/{proposal_id}
POST /api/graphops/proposals/{proposal_id}/validate
POST /api/graphops/proposals/{proposal_id}/dry-run
POST /api/graphops/proposals/{proposal_id}/approve
POST /api/graphops/proposals/{proposal_id}/apply
POST /api/graphops/proposals/{proposal_id}/reject
```

### 5.2 Transaction Shape

当前 GraphOps transaction schema version：

```text
acc.graphops.transaction.v1
```

顶层字段只允许：

```text
schema_version
proposal_id
author
source
base
rationale
targets
```

当前支持的 operation 是 create-only：

```text
create_agent_class
create_tool_class
create_workflow
```

target 类型和路径约束：

```text
agent_class -> callables/agents/*.yaml
tool_class  -> callables/tools/*.yaml
workflow    -> workflows/*.accflow.json
```

`base.content_hashes[target_path]` 对 create operation 必须是 `"absent"`。如果目标文件已经存在，validation 或 apply 会产生 `stale_base`。

### 5.3 Lifecycle

GraphOps 的状态流如下：

```text
create_proposal()
  -> proposal.json status=drafted
validate()
  -> validation.json
  -> status=validated | validation_failed
dry_run()
  -> materialize in staging
  -> semantic_diff.json
  -> dry_run.json
  -> status=awaiting_human_approval
approve()
  -> verify target_paths/base_hashes/dry_run_digest
  -> approval.json
  -> status=approved
apply()
  -> re-check stale base
  -> materialize in apply staging
  -> write temp files
  -> atomic replace into target paths
  -> apply_manifest.json
  -> status=applied
```

拒绝路径：

```text
reject()
  -> rejection.json
  -> status=rejected
```

失败路径：

```text
validate() invalid -> validation_failed
dry_run() validation invalid -> AccError, status remains validation_failed
apply() target exists -> stale_base.json, status=stale_base
apply() exception after temp write -> apply_error.json, cleanup, status=apply_failed
```

### 5.4 Why LLM Can Only Propose

GraphOps 存在的原因不是“让 LLM 改文件更方便”，而是防止 LLM 在没有证据和人审的情况下成为持久化状态所有者。

直接写文件会带来这些风险：

- 删除或绕过 human gate。
- 开启 `danger-full-access`。
- 打开 `network=true`、`write_files=true`、`dangerous=true` 等危险策略。
- 写 secret-like path。
- 破坏 workflow schema、port contract 或 callable ref。
- 创建 workflow cycle 或引用不存在的 callable。
- 把 `run_id`、`session_id`、workspace binding 等 runtime state 写进 template。
- 修改 class-level prompt 后没有 review evidence。
- 覆盖已有用户文件。

因此 GraphOps 把“意图”和“写入”分离：

```text
LLM proposal != project mutation
dry-run evidence != human approval
human approval != stale-safe apply
```

### 5.5 Validation And Policy Gates

`validate_transaction()` 当前会执行：

- transaction 必须是 object。
- 顶层、source、base、target 不允许未知字段。
- `schema_version` 必须匹配。
- `proposal_id` 必须匹配 `^[A-Za-z0-9_.-]+$`。
- source 若存在，必须有 `kind` 和 `id`。
- targets 必须是非空 list。
- target 必须是 object。
- operation 必须在 create allowlist 中。
- target type 必须在 allowlist 中。
- operation 必须和 target type 匹配。
- target path 不能 absolute，不能包含 `..`。
- target path 必须落在对应目录下。
- target path 不能是 secret-like path。
- target path 不能重复。
- target 文件不能已存在。
- base hash 必须声明为 `"absent"`。
- target template 必须是 object。
- target 里不能包含 `"danger-full-access"`。
- target 里不能包含 `network=true`、`write_files=true`、`dangerous=true`。
- materialization 必须成功。

`materialize_transaction()` 会在 staging 中写 callable overlay，再构造 overlay `CallableRegistry`。这让同一个 proposal 可以先创建 callable，再创建引用这些 callable 的 workflow，并通过 `collect_callable_validation_issues()` 检查 callable refs。

### 5.6 Dry-run Evidence

`dry_run()` 不修改 project root。它在 proposal 目录下创建临时 staging，materialize transaction，生成：

```text
semantic_diff:
  created_files
  created_callable_ids
  created_workflow_ids
  workflow_node_refs
  warnings
  validation_errors

dry_run:
  status=dry_run_ready
  mutated=false
  target_paths
  semantic_diff
  dry_run_digest
```

`dry_run_digest` 是 `proposal + semantic_diff` 的 hash。approval 必须带回这个 digest，防止 dry-run 后 proposal 被换包。

### 5.7 Approval Binding

`approve()` 只允许在 `awaiting_human_approval` 状态执行。它会验证：

- approval payload 的 `proposal_id` 与 path 参数一致。
- `target_paths` 完全等于最新 dry-run 的 target paths。
- `dry_run_digest` 完全等于最新 dry-run digest。
- `base_hashes` 等于当前 proposal targets 的 expected base hashes。
- terminal proposal 不能再 approve。

批准后写入：

```text
approval.json:
  status=approved
  proposal_id
  approver
  target_paths
  base_hashes
  dry_run_digest
  approved_at
```

### 5.8 Apply Boundary

`apply()` 只允许在 `approved` 状态执行。执行前再次调用 `stale_base_errors()`，确保 create target 仍然不存在。

写入策略：

1. 在 `apply_staging` materialize transaction。
2. 对每个目标先写 `*.tmp`。
3. 再用 `replace()` 写入最终路径。
4. 任何异常都会删除 pending temp files 和已创建目标文件。
5. 成功后写 `apply_manifest.json`。

当前 GraphOps 是 create-only，所以 apply 不覆盖已有文件。后续若加入 update/delete，必须重新定义 base hash、semantic diff、人审和 rollback 语义。

### 5.9 Legacy Patch Boundary

`acc/server/routes/graphops.py` 仍保留 legacy endpoints：

```text
POST /api/graphops/validate
POST /api/graphops/dry-run
POST /api/graphops/apply
```

这些 endpoint 只读取 `examples/graphops` 下的 patch。当前 apply 明确返回错误：

```text
GraphOps apply is not implemented in Option A
```

因此当前可用的持久化治理路径是 `/api/graphops/proposals/*`，不是 legacy patch apply。

## 6. Human Gate And Interaction Governance

### 6.1 Current Code Ownership

当前实现入口：

- `acc/app/human_gate.py`
- `acc/app/human_gate_service.py`
- `acc/app/interactions.py`
- `acc/app/run_lifecycle.py`
- `acc/app/runtime/dispatch_gate.py`

运行证据文件：

```text
runs/<run_id>/
  interactions/<interaction_id>.json
  decisions.jsonl
  wakeup_queue.jsonl
  wakeup_state.json
  plan_steps.jsonl
  run_summary.json
  events.jsonl
```

### 6.2 Mechanism

node 是否需要人审由 `NodeInvocationSpec.control.require_human_approval` 决定。若需要，dispatch path 会创建 `InteractionRequest`：

```text
create_pending_human_gate()
  -> create_human_gate_interaction()
  -> interactions/<interaction_id>.json
  -> PlanStep.status = waiting_interaction
  -> run_summary.status = waiting_interaction
```

`InteractionRequest` 的关键字段：

```text
interaction_id
run_id
node_id
kind
status
prompt
options
payload
created_at
answered_at
answer
```

approval kind 的默认选项是：

```text
approve
reject
```

### 6.3 Answer Path

`answer_human_gate()` 的流程：

```text
idempotent_answer_payload()
  -> reject_terminal_run_for_wakeup()
  -> get_interaction()
  -> validate_approval_answer()
  -> answer_interaction()
  -> append DecisionRecord(kind="approval")
  -> append control event decision_recorded
  -> enqueue WakeupRequest(reason="human")
  -> if run is waiting:
       approve -> resume_waiting_run()
       reject  -> reject_waiting_human_gate()
  -> optionally resume_approved_human_gate_dispatch()
```

幂等语义：

- 如果 interaction 已经 answered，且 answer 完全相同，则返回当前 payload 并标记 `idempotent=true`。
- 如果 interaction 已经 answered，但 answer 不同，则抛出 `AccError`。

这防止重复点击或网络重试生成多个互相冲突的审批结果。

### 6.4 Approve Path

approve 会：

- 记录 `DecisionRecord(kind="approval", actor="human")`。
- 写 `wakeup_queue.jsonl`。
- 将匹配的 `waiting_interaction` PlanStep 转成 `ready`。
- 将 `run_summary.status` 写为 `resuming`。
- 尝试调用 `resume_approved_human_gate_dispatch()` 调度该 interaction 对应的 ready step。

resume 时必须满足：

- run dir 存在。
- run 不是 terminal。
- run status 属于 waiting status。
- reason 当前必须是 `"human"`。
- interaction 必须已 answered。
- `run_plan.json` 存在。
- `plan_steps.jsonl` 可读。
- `decisions.jsonl` 可读且没有 warnings。
- 至少一个 waiting PlanStep 匹配 interaction。

### 6.5 Reject Path

reject 会：

- 记录 `DecisionRecord(kind="approval", selected.action="reject")`。
- 将匹配的 `waiting_interaction` PlanStep 转成 `skipped`。
- 将 `run_summary.status` 写为 `failed`。
- 写 control event `human_gate_rejected`。

reject 不应该继续 dispatch 下游 step，因为 human gate 的语义是人类拒绝本次执行。

### 6.6 Waiting Status Boundary

`acc/app/run_lifecycle.py` 当前定义：

```text
TERMINAL_RUN_STATUSES = success, failed, cancelled, crashed
WAITING_RUN_STATUSES  = waiting_interaction, waiting_handoff, waiting_timer
RESUMING_RUN_STATUSES = resuming
```

但 `PlanStepStatus` 当前模型只包含：

```text
pending
ready
waiting_interaction
dispatching
running
success
failed
skipped
cancelled
```

因此当前代码事实是：human gate 已落地到 `waiting_interaction`；`waiting_handoff` 和 `waiting_timer` 是 run-level lifecycle 预留，尚未成为 `PlanStepStatus`。

## 7. Supervisor Governance

### 7.1 Current Code Ownership

当前实现入口：

- `acc/app/supervisor.py`
- `acc/engine/supervisor.py`
- `docs/Design/05_SUPERVISOR_PLANSTEP.md`
- `acc/app/runtime/dispatch_gate.py`

运行证据文件：

```text
runs/<run_id>/
  supervisor_state.json
  supervisor_plans/<plan_id>.json
  supervisor_plans/<plan_id>/intents/<correlation_id>.json
  supervisor_replay_manifest.json
  decisions.jsonl
  plan_steps.jsonl
  events.jsonl
```

### 7.2 Model

Supervisor 的职责不是成为第二套 callable runner。它的职责是把动态调度意图结构化：

```text
Supervisor output
  -> DynamicInvocationIntent / SupervisorPlan
  -> validate against SupervisorRoster + ControlPolicy
  -> DecisionRecord(kind="supervisor_plan")
  -> PlanStep(source="supervisor")[]
  -> unified DispatchEnvelope / Core v2 execution substrate
```

`build_supervisor_roster()` 只从 registry 中收集 `AgentClassTemplate`，形成 `SupervisorRoster`。`render_supervisor_prompt()` 明确要求：

- 只能协调 registered agents。
- 不能执行 shell commands。
- 不能写 downstream workspaces。
- 输出必须匹配 `DynamicInvocationIntent` 或 `SupervisorPlan`。

### 7.3 Plan Materialization

`materialize_supervisor_plan_steps()` 当前会：

1. 读取已有 PlanStep。
2. 调用 `compile_supervisor_plan_to_steps()`。
3. 写 `supervisor_plans/<plan_id>.json`。
4. 写每个 intent 的 snapshot。
5. append `DecisionRecord(kind="supervisor_plan")`。
6. append control event `decision_recorded`。
7. 对每个 compiled step append initial `PlanStepTransitionRecord`。

这条路径把 supervisor 输出变成 ledger evidence，而不是直接让 supervisor 写 workspace 或直接修改 workflow template。

### 7.4 Runtime Dispatch

`dispatch_ready_supervisor_plan_steps()` 会选择 source 为 `supervisor` 的 PlanStep：

- dependency 全部 success 才能 ready。
- pending step 在 dependency 满足后转 ready。
- ready step 通过 `_node_invocation_from_supervisor_step()` 构造动态 `NodeInvocationSpec`。
- 实际执行仍走 `execute_core_v2_node_with_fixed_ledger()`。

这保持了统一执行基座：supervisor 只产生动态 step，不拥有单独的生产 runner。

### 7.5 Repeat/Depth Policy

`SupervisorRouter.check_dispatch_policy()` 当前使用 run-scoped `supervisor_state.json` 维护：

```text
call_graph
correlation_ids
repeat_counts
```

限制：

- 同一个 `correlation_id` 已存在时，非 force retry 不重复派发。
- 每个 target 的 repeat count 不能超过 `DEFAULT_REPEAT_LIMIT = 3`。
- call graph depth 不能超过 `DEFAULT_MAX_DEPTH = 4`。

这些规则防止 supervisor 递归派发失控。

### 7.6 Replay

`replay_supervisor_plan_from_recorded_decision()` 的语义是：

- 必须存在 `run_plan.json`。
- 必须验证 template snapshot 存在、schema compatible、workflow id compatible。
- 必须找到历史 `DecisionRecord(kind="supervisor_plan")`。
- decision 的 `run_id` 和 `run_plan_id` 必须和当前 run plan 匹配。
- selected step ids 和 node ids 必须存在且一一对应。
- replay step 必须仍然是 source=`supervisor`，node_id 必须兼容。
- 写 `supervisor_replay_manifest.json`。

核心原则：replay 复用 recorded decision，不重新询问 supervisor LLM。

## 8. Handoff Governance

### 8.1 Current Code Ownership

当前实现入口：

- `acc/app/handoff.py`
- `acc/engine/handoff.py`
- `acc/app/runtime/dispatch_gate.py`

运行证据文件：

```text
runs/<run_id>/
  handoffs/<handoff_id>/payload.json
  decisions.jsonl
  plan_steps.jsonl
  events.jsonl
```

### 8.2 Model

Handoff 是运行时任务移交，不是 workflow template 修改。它的输入是 `HandoffRequest`，受 `HandoffControlPolicy` 约束。

`HandoffRequest` 包含：

```text
handoff_id
run_id
run_plan_id
source_plan_step_id
source_node_id
target_node_id
target_callable_ref
mode
input_payload
payload_ref
artifact_refs
acceptance_refs
scope_ref
```

当前 handoff mode：

```text
new_session
resume_session
route_only
```

`HandoffControlPolicy` 约束 allowed targets、allowed modes、acceptance、human approval、timeout、depth、repeat、replay mode 等。

### 8.3 Materialization

`materialize_handoff_plan_step()` 的流程：

```text
HandoffRequest
  -> _prepare_request()
  -> validate run-relative refs
  -> compile_handoff_to_plan_step()
  -> write payload snapshot if generated
  -> append DecisionRecord(kind="handoff")
  -> append control event decision_recorded
  -> append PlanStepTransitionRecord
  -> append control event handoff_selected
```

如果 request 没有 `payload_ref`，系统会生成：

```text
handoffs/<handoff_id>/payload.json
```

payload snapshot 会保存 input payload、artifact refs、acceptance refs、target callable ref 等证据。这样 handoff 后续 dispatch 或 replay 不需要依赖不稳定的内存对象。

### 8.4 Path Safety

handoff 的所有 refs 都必须是 run-relative：

- 不能是 absolute path。
- 不能包含 `..`。
- 不能逃逸 run dir。
- `scope_ref`、`artifact_refs`、`acceptance_refs` 若声明必须存在。
- `payload_ref` 若复用必须指向 JSON object。

这条边界防止 handoff 把运行态数据引用到项目外路径或任意用户文件。

### 8.5 Dispatch

`dispatch_ready_handoff_plan_steps()` 会选择 source 为 `handoff` 的 PlanStep。dependency 满足后转 ready，然后通过 `_node_invocation_from_handoff_step()` 构造动态 node。实际执行仍走 Core v2 fixed ledger dispatch。

因此 handoff 不直接写目标 workspace，也不绕过统一 dispatch。

## 9. Decision Inbox

### 9.1 Current Code Ownership

当前实现入口：

- `acc/app/decisions.py`

Decision inbox 不是 durable truth，它是聚合投影。它从两个来源收集待处理项：

1. run index 中的 failed/manual_review/node failure。
2. `runs/_graphops_proposals` 中未 applied/rejected 的 GraphOps proposal。

输出结构：

```text
version
generated_at
counts
items[]
```

GraphOps decision item 会包含：

```text
proposal_id
proposal_path
target_paths
operation_count
status
governance_mode=persistence_proposal
requester
approver
validation_status
dry_run_status
approved_target_paths
apply_requires_human_approval=true
dry_run_only=false
```

这给 Workbench 或其他上层界面提供“需要人处理什么”的视图，但它不能替代 `proposal.json`、`validation.json`、`dry_run.json`、`approval.json` 等源文件。

## 10. Decision And Replay Contract

### 10.1 DecisionRecord

`DecisionRecord` 是运行态治理的核心审计对象。关键字段：

```text
decision_id
run_id
actor
kind
timestamp
input_evidence_refs
run_plan_id
policy_snapshot
candidates
selected
rejected
rationale
result_refs
replay_binding
correlation_id
metadata
```

当前 `DecisionKind`：

```text
compile_plan
dispatch
approval
supervisor_plan
handoff
retry
cancel
no_action
```

它的机制意义是：把“选择”从临时控制流中抽出来，变成可审计、可 replay 的事实。

### 10.2 ReplayPolicy

`ReplayPolicy` 当前模型：

```text
mode:
  deterministic_recompile
  reuse_recorded_decisions
  require_reapproval
  disabled
template_snapshot_required
reuse_human_answers
reuse_supervisor_decisions
reuse_handoff_decisions
graphops_apply_allowed
```

治理默认应该偏向：

```text
reuse_recorded_decisions
template_snapshot_required=true
graphops_apply_allowed=false
```

原因是 replay 的目标是重现已有决策，不是让 LLM 或人审流程在无提示下生成新事实。

### 10.3 Resume Is Replay-like

human gate resume 虽然不是完整 replay，但遵守同样原则：

- 使用已有 `run_plan.json`。
- 使用已有 `plan_steps.jsonl`。
- 使用已有 `decisions.jsonl`。
- 使用已 answer 的 `interactions/<id>.json`。
- 跳过已 success steps。
- 不调用 destructive fresh init。

## 11. Forbidden Operations And Hard Boundaries

以下行为默认禁止：

- LLM 直接写 `workflows/` 或 `callables/`。
- LLM 直接修改 `AGENTS.md`、skills 或 persistence API。
- LLM 运行 workflow 来证明自己的 proposal。
- GraphOps 未 dry-run 就 approve。
- GraphOps 未 approve 就 apply。
- GraphOps approval 不绑定 `target_paths`、`base_hashes`、`dry_run_digest`。
- GraphOps apply 覆盖已有 target。
- GraphOps target path absolute 或包含 `..`。
- GraphOps target path 逃出 `callables/agents`、`callables/tools`、`workflows`。
- GraphOps target 包含 `danger-full-access`。
- GraphOps target 包含 `network=true`、`write_files=true`、`dangerous=true`。
- GraphOps 写 secret-like path。
- Human gate 对 terminal run answer/wakeup。
- Human gate 同一 interaction 被不同 answer 覆盖。
- Resume 删除 run dir。
- Resume 重跑已经 success 的 step。
- Supervisor 直接 shell。
- Supervisor 直接写 downstream workspace。
- Supervisor 绕过 roster/control policy 派发。
- Supervisor replay 重新询问 LLM 替代 recorded decision。
- Handoff ref 使用绝对路径或逃逸 run dir。
- Handoff 直接写 downstream workspace 绕过 inbox/outbox/artifact materialization。
- Decision inbox 被当作 source of truth。

## 12. Failure And Audit Paths

### 12.1 Authoring Failure

Authoring session 的常见失败：

- 没有可用 authoring agent。
- message 为空。
- agent output 不是单个 JSON object。
- output schema version 不匹配。
- proposal 缺失。
- stale task/canvas。
- operation 不在 allowlist。
- unknown callable。
- duplicate node id。
- edge endpoint unknown。
- main-to-main data edge forbidden。
- output schema invalid。
- proposal under-specified。

审计文件：

```text
runs/_authoring_sessions/<session_id>/session.json
runs/_authoring_sessions/<session_id>/messages.jsonl
runs/_authoring_sessions/<session_id>/agent_output_raw.txt
runs/_authoring_sessions/<session_id>/validation.json
```

### 12.2 GraphOps Failure

GraphOps 的常见失败：

- invalid schema version。
- invalid proposal id。
- unexpected field。
- unsupported operation。
- target type/operation mismatch。
- path escape。
- target path invalid。
- target already exists。
- base hash invalid。
- permission forbidden。
- semantic invalid。
- approval digest mismatch。
- approval target paths mismatch。
- approval base hashes mismatch。
- stale base at apply。
- apply write failure。

审计文件：

```text
proposal.json
validation.json
dry_run.json
semantic_diff.json
approval.json
stale_base.json
apply_error.json
apply_manifest.json
rejection.json
```

### 12.3 Human Gate Failure

Human gate 的常见失败：

- interaction 不存在。
- answer 不包含 approve/reject。
- answer 不在 allowed options。
- terminal run 收到 answer/wakeup。
- run_summary 缺 status。
- run 不是 waiting。
- interaction 未 answered。
- 缺失 `run_plan.json`。
- `decisions.jsonl` 缺失或有 warnings。
- 找不到匹配 waiting PlanStep。
- dispatch approved step 失败。

审计文件：

```text
interactions/<interaction_id>.json
decisions.jsonl
wakeup_queue.jsonl
plan_steps.jsonl
events.jsonl
run_summary.json
run_record.json
function_invocation.json
```

### 12.4 Supervisor Failure

Supervisor 的常见失败：

- plan 未 approved。
- intent target 不在 roster。
- repeat limit exceeded。
- max dispatch depth exceeded。
- dynamic PlanStep dependency missing。
- template snapshot missing/incompatible。
- recorded decision not found。
- recorded decision run/run_plan incompatible。
- selected step ids/node ids incompatible。
- replay step source/node incompatible。

审计文件：

```text
supervisor_state.json
supervisor_plans/<plan_id>.json
supervisor_plans/<plan_id>/intents/<correlation_id>.json
decisions.jsonl
plan_steps.jsonl
supervisor_replay_manifest.json
events.jsonl
```

### 12.5 Handoff Failure

Handoff 的常见失败：

- payload/scope/artifact/acceptance ref 逃逸 run dir。
- 声明的 ref 不存在。
- payload_ref 不是 JSON object。
- target 不被 policy 允许。
- mode 不被 policy 允许。
- dynamic dependency missing。
- handoff step dispatch 失败。

审计文件：

```text
handoffs/<handoff_id>/payload.json
decisions.jsonl
plan_steps.jsonl
events.jsonl
```

## 13. Interfaces

### 13.1 Authoring API

```text
GET  /api/authoring/agents
POST /api/authoring/sessions
GET  /api/authoring/sessions/{session_id}
POST /api/authoring/sessions/{session_id}/messages
POST /api/authoring/proposals/validate
POST /api/authoring/proposals/dry-run
```

API 层只做 Pydantic request validation、调用 `AuthoringSessionService`、把 `AccError` 转成 HTTP error。业务事实在 service 和 session files。

### 13.2 GraphOps API

```text
POST /api/graphops/proposals
GET  /api/graphops/proposals
GET  /api/graphops/proposals/{proposal_id}
POST /api/graphops/proposals/{proposal_id}/validate
POST /api/graphops/proposals/{proposal_id}/dry-run
POST /api/graphops/proposals/{proposal_id}/approve
POST /api/graphops/proposals/{proposal_id}/apply
POST /api/graphops/proposals/{proposal_id}/reject
```

API 层不应该自己实现 mutation 逻辑，必须委托 `GraphOpsService`。

### 13.3 Run Interaction API

具体 route 不在本文件范围内，但 interaction answer 的 service 契约是：

```text
answer_human_gate(run_dir, run_id, interaction_id, answer)
  -> interaction payload
  -> optional decision_id
  -> optional resume payload
  -> optional dispatch payload
  -> optional rejection payload
```

### 13.4 Decision Inbox API

上层可以调用 `decision_inbox_payload(project_root, limit, include_graphops, include_events)` 获得待处理投影。该 payload 只用于 UI/assistant triage，不是 durable truth。

## 14. Verification

### 14.1 Unit Tests Required

Authoring：

- invalid output payload rejects。
- stale canvas rejects。
- unknown callable rejects。
- duplicate node id rejects。
- main-to-main data edge rejects。
- invalid output schema rejects。
- temporary agent emits warning。
- dry-run writes count remains zero。

GraphOps：

- invalid schema version rejects。
- invalid proposal id rejects。
- path escape rejects。
- wrong target directory rejects。
- dangerous permission rejects。
- target exists rejects.
- dry-run does not mutate project files。
- approval requires exact target paths。
- approval requires exact dry-run digest。
- approval requires exact base hashes。
- apply requires approved status。
- stale base at apply writes `stale_base.json`。
- apply failure writes `apply_error.json` and cleans up partial files。

Human gate：

- approve/reject answer validation。
- idempotent same answer returns idempotent payload。
- different second answer rejects。
- terminal run answer rejects。
- approve waiting interaction transitions step to ready。
- reject waiting interaction transitions step to skipped and run failed。
- resume requires `run_plan.json` and readable decisions。

Supervisor：

- roster validation rejects unknown target。
- repeat/depth policy rejects excessive dispatch。
- approved SupervisorPlan materializes decision and PlanSteps。
- replay uses recorded decision and does not re-ask LLM/parser。
- dynamic dependency missing fails dispatch.

Handoff：

- absolute or `..` refs reject。
- missing declared refs reject。
- generated payload snapshot is run-relative。
- handoff decision and PlanStep transition are appended。
- route_only selects existing target without creating invalid new step。

### 14.2 Integration Tests Required

- Authoring session produces valid proposal in hermetic mode.
- GraphOps proposal creates agent/tool/workflow through validate -> dry-run -> approve -> apply.
- GraphOps dry-run can create a workflow that references callable created in the same proposal.
- Human-gated workflow enters `waiting_interaction`, answer approve resumes without deleting run dir.
- Human-gated workflow reject records decision and terminal failure.
- Supervisor approved plan creates dynamic steps and dispatches through Core v2 substrate.
- Handoff creates run-scoped payload snapshot and dispatches through Core v2 substrate.

### 14.3 Manual Verification

默认后端验证命令：

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
```

若依赖完整：

```bash
uv run pytest -q
```

Workbench 相关验证：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

## 15. Open Risks And Design Gaps

1. **GraphOps 当前是 create-only**
   这降低了覆盖风险，但 update/delete 还没有正式 spec。未来加入 update/delete 前，必须定义 base hash、semantic diff、conflict、rollback、人审 UI 和测试矩阵。

2. **Authoring proposal 和 GraphOps transaction 还不是同一种对象**
   Authoring 当前生成 canvas operations，GraphOps 当前生成 durable create transaction。目标流程不是让每个 canvas 小操作都走 GraphOps，而是先允许用户在 Draft Mode 中快速 apply/undo/redo，等用户选择 save/publish/apply-to-project-assets 时，再把最终 canvas diff 转成一笔 GraphOps transaction。两者之间需要一个显式转换层，不能让 UI 直接把 canvas proposal 当 GraphOps transaction apply，也不能绕过 GraphOps 直接把 AI-assisted draft 写入 `workflows/` 或 `callables/`。

3. **Design 文档中的 waiting_handoff/waiting_timer 还未成为 PlanStepStatus**
   run lifecycle 已预留 run-level status，但模型层当前只有 `waiting_interaction`。后续实现 handoff acceptance 或 timer wait 时，需要同步模型、state machine、projection 和 tests。

4. **Supervisor 仍保留直接 invoke scaffold**
   `SupervisorRouter.invoke_from_intent()` 仍可直接调用 `CallableInvocationService.execute_node()`。`docs/Design/05_SUPERVISOR_PLANSTEP.md` 已指出这只能作为 MVP scaffold，不应继续扩大。目标路径应是 `SupervisorPlan -> PlanStep -> DispatchEnvelope -> Core v2 dispatch`。

5. **Decision inbox 是投影，不能承载最终审批事实**
   GraphOps approval、human gate answer、supervisor decision、handoff decision 都必须落到各自 evidence 文件。Decision inbox 只能聚合和导航。

6. **非 hermetic authoring 依赖外部 agent 输出质量**
   当前通过 strict output schema 和 post-validation 限制风险，但外部 agent 仍可能输出低质量 proposal。系统必须把低质量 proposal 留在 `needs_attention`，不能自动保存或 apply。

## 16. Acceptance Criteria

本治理板块被认为实现正确，必须同时满足：

- Authoring agent 只能产生 proposal，不能直接持久化 project assets。
- Authoring validation 能拒绝 stale canvas、unknown callable、非法 edge、非法 schema。
- Workbench draft edits 必须支持草稿层 apply/undo/redo，且不得写入 `workflows/` 或 `callables/`。
- AI-assisted canvas draft 在 save/publish/apply-to-project-assets 边界必须转换为 GraphOps transaction 或等价治理事务。
- Draft-to-GraphOps 转换必须绑定 source proposal、base canvas hash、target paths、expected base hashes、semantic diff 和 risk flags。
- GraphOps 持久化变更必须经过 validate、dry-run、approve、apply。
- GraphOps apply 必须绑定最新 dry-run digest 和 base hashes。
- GraphOps dry-run 不修改 project root。
- GraphOps apply 不覆盖已有文件。
- Human gate answer 必须记录 `DecisionRecord`。
- Terminal run 不能被 answer/wakeup 重新打开。
- Resume 不删除 run dir，不重跑 success steps。
- Supervisor 动态调度必须通过 roster/policy/DecisionRecord/PlanStep。
- Supervisor replay 不重新询问 LLM。
- Handoff 必须写 run-scoped payload snapshot 并校验 refs。
- Decision inbox 只能是 projection。
- 所有失败路径都有可定位 evidence。
