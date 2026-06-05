# Design 06: Handoff Semantics

生成日期: 2026-06-02

## 结论

Handoff 不是 supervisor 的别名。Supervisor 是中央主控做派发; handoff 是当前控制权持有者把
上下文、责任和下一步控制权交给另一个 agent/tool/workflow。

如果不定义 typed semantics, handoff 会退化成“Agent 随便叫下一个 Agent”, 重新变成黑盒多
Agent。

P0 范围必须收窄: 先做 typed policy validation、illegal target reject、`new_session` 和
`route_only`。`resume_session`、timeout/fallback、replay 依赖 wait/resume lifecycle 和更完整的
capability 语义, 后续再落。

## 目标

1. 定义 handoff 的 source、target、mode、payload、artifact、acceptance、timeout、fallback。
2. 让 handoff 通过 `DecisionRecord(kind="handoff")` 或 `HandoffRecord` 审计。
3. 让 handoff 产出或更新 `PlanStep`, 不新增 runner。
4. 限制 target 只能来自 outgoing edges 或 approved roster。
5. P0 只实现 `new_session` / `route_only`; replay 和 timeout/fallback 后续实现。

## 非目标

- 不做任意 agent-to-agent free call。
- 不共享 conversation memory 作为默认语义。
- 不让 source agent 直接写 target workspace。
- 不实现分布式 queue。
- 不绕过 human gate。

## HandoffControlPolicy

建议作为 `ControlPolicy(mode="handoff")` typed payload:

```text
source_node_id
allowed_target_node_ids
allowed_target_callable_refs
allowed_modes:
  - new_session
  - resume_session
  - route_only
requires_acceptance: bool
requires_human_approval: bool
timeout_seconds
fallback_target
max_handoff_depth
max_repeat_per_target
replay_mode: reuse_recorded_decisions
```

## HandoffRecord

可以独立建 `HandoffRecord`, 也可以先用 `DecisionRecord(kind="handoff")` 承载。若独立建,
建议字段:

```text
handoff_id
decision_id
run_id
run_plan_id
source_plan_step_id
source_node_id
target_node_id
target_callable_ref
mode: new_session | resume_session | route_only
payload_ref
artifact_refs
scope_ref
acceptance_required
acceptance_status: pending | accepted | rejected | timed_out | not_required
timeout_policy
fallback_target
created_at
resolved_at
result_plan_step_id
metadata
```

## Handoff modes

### new_session

创建新的 target `PlanStep` 和新的 `SessionInstance`。

适用:

- target 是另一个 agent/tool/workflow。
- 不需要复用 target 旧会话。

### resume_session

尝试恢复已存在 target `SessionInstance` 或外部 agent session。

前置条件:

- target callable capability 声明 `resumable_session=true`。
- 有 session ref。
- `ReplayPolicy` 允许 resume。

不满足则 reject, 不自动降级, 除非 policy 明确允许 fallback 到 `new_session`。

P0 不实现 `resume_session`; 只定义 schema 和 reject 行为。

### route_only

只决定已有候选 step 谁继续, 不创建新 session。

适用:

- 当前 workflow 已有 outgoing edges。
- handoff 只是选择后继分支。

## 数据边界

handoff 传递的是引用, 不是任意 workspace 写入:

- `payload_ref`: ACC materialized input reference。
- `artifact_refs`: source `ArtifactBundle` 中的 artifact 引用。
- `scope_ref`: `ScopeFrame` 引用, 不能让 target 越界读写。

target 输入仍由 ACC 通过 ports/inbox/outbox/artifact materialization 生成。

## Acceptance

如果 `requires_acceptance=true`:

```text
handoff proposed
  -> target/human acceptance pending
  -> accepted
  -> target PlanStep ready
```

Reject:

```text
handoff proposed
  -> rejected
  -> fallback target or source failure
```

Acceptance 可以由:

- target agent capability 自动接受。
- human gate approval。
- deterministic policy。

P2 推荐先实现 human/deterministic acceptance, 不实现 target agent interactive accept。

## Timeout / fallback

必须定义:

- timeout 发生后是否创建 fallback step。
- fallback target 是否也必须在 allowed target 中。
- timeout decision 如何写入 `DecisionRecord`。
- replay timeout 时是否复用历史 timeout/fallback decision。

默认建议:

- timeout 无 fallback -> workflow failed。
- timeout 有 fallback -> 生成 fallback `PlanStep`, 写 `DecisionRecord(kind="handoff")`。

P0 不实现 timeout/fallback 执行, 只保留字段和 validation。真实 timeout/fallback 需要
`03_RUN_WAIT_RESUME_LIFECYCLE.md` 的 wakeup/resume 能力。

## Replay

默认:

- 不重新选择 target。
- 不重新判断 acceptance。
- 复用历史 handoff decision。
- 如果 target artifact/session ref 缺失, replay failed。

P0 不实现 replay, 只要求 handoff decision schema 带 replay 所需字段。

## 失败路径

必须处理:

- target 不在 outgoing edges 或 approved roster。
- target callable 不存在。
- mode 不被 target capability 支持。
- `payload_ref` 或 `artifact_refs` 不存在。
- `resume_session` 缺 session ref。
- acceptance rejected。
- timeout。
- fallback target 非法。
- handoff loop 或 depth exceeded。
- replay 缺历史 decision。

## 验收标准

- handoff decision 有 `decision_id` 和 source/target/mode/payload/artifact refs。
- illegal target reject, 不生成 `PlanStep`。
- `new_session` handoff 生成 target `PlanStep` 并由 Core v2 dispatch 执行。
- `route_only` 只选择已有 outgoing target, 不创建新 session。
- P0: `resume_session` 请求被明确拒绝或标记 deferred, 不隐式降级。
- P0: timeout/fallback/replay 字段可 validation, 但不宣称完整执行能力。

## 建议测试

- unit: handoff policy allowed target validation。
- unit: mode/capability validation。
- unit: artifact ref missing reject。
- integration: source step -> handoff new_session -> target output。
- integration: route_only selects an existing outgoing target。
- integration P0: resume_session request rejected with explicit reason。
- later: handoff rejected -> fallback executes or workflow failed。
- later: timeout fallback。
- later: historical handoff decision reused in replay。
