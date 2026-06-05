# Design 05: Supervisor PlanStep

生成日期: 2026-06-02

## 结论

Supervisor 不应该成为第二套 callable runner。它的职责是产生结构化意图和决策:

```text
Supervisor output
  -> DynamicInvocationIntent / SupervisorPlan
  -> validate against SupervisorRoster + ControlPolicy
  -> DecisionRecord(kind="supervisor_plan")
  -> PlanStep[]
  -> DispatchEnvelope
  -> Core v2 callable execution substrate
```

当前 `SupervisorRouter.invoke_from_intent()` 直接调用 `CallableInvocationService.execute_node()`
的路线只能作为 MVP scaffold, 不应继续扩大。

本 design 分三段落地:

- P0: approved `SupervisorPlan` -> validated `PlanStep[]` + `DecisionRecord`, 不执行 worker。
- P1: dynamic `PlanStep` 接入统一 `DispatchEnvelope` / Core v2 dispatch, 用 fake E2E 验证。
- P2: supervisor replay, 复用 recorded `DecisionRecord`, 不重新问 LLM。

## 当前事实

已有可复用模型:

- `AgentCapabilities`
- `RosterEntry`
- `SupervisorRoster`
- `DynamicInvocationIntent`
- `SupervisorPlan`
- `DynamicInvocationProposal`
- `SupervisorDecision`

已有 pure engine 能力:

- `parse_dynamic_invocation_intent()`
- `validate_intent_against_roster()`
- `parse_supervisor_plan()`
- `validate_supervisor_plan()`
- `parse_supervisor_decision()`

已有 app scaffold:

- `build_supervisor_roster()`
- `render_supervisor_prompt()`
- `SupervisorRouter.check_dispatch_policy()`
- `write_supervisor_plan()`

风险点:

- `SupervisorRouter.invoke_from_intent()` 直接执行 callable。
- `CallableInvocationService` 明确不是完整生产执行器。
- `WorkflowAppService.run()` 当前没有 supervisor hot path。

## 目标

1. Supervisor 输出只能是 structured plan/intent/proposal。
2. Supervisor plan 必须经过 roster 和 `ControlPolicy` 校验。
3. Approved plan 先转成 `PlanStep[]`, P0 不执行 worker。
4. Supervisor decision 写入 durable `DecisionRecord`。
5. Replay supervisor run 时复用历史 `DecisionRecord`, 不重新问 LLM。

## 非目标

- 不实现自定义 LLM loop。
- 不让 supervisor 直接 shell。
- 不让 supervisor 直接写 downstream workspace/inbox。
- 不让 supervisor 无人审 apply GraphOps patch。
- 不扩大 `CallableInvocationService` 成生产执行器。

## SupervisorControlPolicy

建议作为 `ControlPolicy(mode="supervisor")` 的 typed payload:

```text
supervisor_node_id
allowed_roster_refs
max_dispatch_depth
max_repeat_per_target
max_plan_intents
requires_human_approval_for_dynamic_dispatch
allow_graphops_proposal: bool
allow_graphops_apply: false
replay_mode: reuse_recorded_decisions
```

`check_dispatch_policy()` 里的 repeat/depth 逻辑可以迁移或映射到这里。

## Plan 编译

新增 pure/app 协作:

```text
compile_supervisor_plan_to_steps(plan, roster, control_policy, run_plan)
  -> DecisionRecord(kind="supervisor_plan")
  -> PlanStep[]
```

规则:

- `plan.status` 必须是 `approved` 或由 policy 明确允许 auto-approved。
- 每个 intent 的 `target_callable_ref` 必须在 roster 或 allowed target 中。
- `node_id_suggestion` 只能作为建议, 必须 sanitize 并确保 run-scoped unique。
- 每个 intent 生成一个 dynamic `PlanStep(source="supervisor")`。
- `PlanStep.depends_on` 默认依赖 supervisor node 的 step, 或由 plan 显式声明。
- intent `input_payload` 只作为 step input snapshot/ref, 不直接写 downstream workspace。

## P0: Plan 编译但不执行

Supervisor 不执行 worker, 只提交 steps:

```text
execute_supervisor_plan()
  -> validate_supervisor_plan()
  -> compile_supervisor_plan_to_steps()
  -> append plan_steps.jsonl
  -> append decisions.jsonl
  -> append dynamic plan steps
  -> stop
```

P0 验收点:

- 不调用 `CallableInvocationService.execute_node()`。
- 不调用 `execute_core_v2_node()`。
- 只验证 plan/intent/policy/roster, 并写 durable decisions/steps。

## P1: Dispatch integration

P1 才把 dynamic `PlanStep` 交给统一 dispatch wrapper:

```text
dynamic PlanStep ready
  -> DispatchEnvelope
  -> execute_core_v2_node()
```

最终执行仍由 `DispatchEnvelope -> execute_core_v2_node()` 完成, 不新增 supervisor runner。

## GraphOps Proposal

Supervisor 可以提出 `DynamicInvocationProposal.graph_patch`, 但:

- runtime dispatch 不走 GraphOps。
- GraphOps proposal 只进入 validate/dry-run/human approval。
- 默认不 apply。
- 如果未来 apply, 必须走 `08_GRAPHOPS_GOVERNANCE.md`。

## P2: Replay

Replay 规则:

- 已有 supervisor `DecisionRecord` 时, 复用 selected intents/steps。
- 不重新 parse LLM output。
- 如果历史 decision 缺失或 schema 不兼容, replay failed, 不自动重新问 supervisor。
- GraphOps proposal replay 只 replay proposal/dry-run evidence。

## 失败路径

必须定义:

- plan 未 approved。
- target 不在 roster。
- node id suggestion 冲突或非法。
- repeat limit/depth limit exceeded。
- intent payload 不是 object。
- dynamic step 依赖不存在。
- supervisor plan 写入成功但 step 写入失败。
- worker dispatch failure。
- replay 找不到历史 decision。

## 验收标准

- `SupervisorPlan` 可编译为 `PlanStep[]`, 不直接执行 callable。
- P0 不执行 worker, 只写 decisions/steps。
- invalid roster target 不生成 step。
- repeat/depth policy 仍生效。
- `SupervisorDecision` 或 plan approval 映射为 durable `DecisionRecord`。
- P1 fake supervisor E2E 能产生 worker output, 且 worker 由 Core v2 dispatch 执行。
- replay 不重新调用 supervisor LLM/parser。
- GraphOps proposal 不 mutate `.accflow.json`。

## 建议测试

- unit: supervisor parser/validator 保持 pure。
- unit: `compile_supervisor_plan_to_steps()` target allow/deny。
- unit: repeat/depth limit。
- integration P0: approved fake supervisor plan -> decision -> dynamic steps, no worker execution。
- integration P1: approved fake supervisor plan -> decision -> step -> fake worker output。
- integration: unapproved plan rejects。
- integration: worker failure 写 step/dispatch failure evidence。
- replay: mock supervisor parser, 断言 replay 不调用它。
