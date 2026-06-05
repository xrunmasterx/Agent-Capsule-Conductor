# Design 01: Runtime Control Ledger

生成日期: 2026-06-02

## 结论

ACC 要先补运行期控制账本 ABI, 再谈 supervisor/handoff。最小设计不是新增 runtime, 而是先
定义 run-scoped `RunPlan`、`PlanStep`、`DispatchEnvelope`、`DecisionRecord`、`ReplayPolicy`
的 schema、validator、store reader/writer 和 projection loader。

这个 design 是后续所有 design 的前置条件。
它不接 runtime hot path; fixed workflow 真正开始写 ledger 的工作属于
`02_FIXED_RUNPLAN_DISPATCH.md`。

## 当前问题

当前 fixed workflow 能运行, 但控制过程没有统一账本:

- `compile_execution_plan()` 只产出拓扑层级 `ExecutionPlan.levels`。
- `run_workflow_function_invocation()` 直接遍历 `plan.levels`, 同层 `asyncio.gather()`。
- `execute_core_v2_node()` 写 `SessionInstance`、payload、artifact、failure evidence。
- supervisor 有 `SupervisorPlan` / `DynamicInvocationIntent`, 但还没进 Core v2 热路径。
- `InteractionRequest` / `WakeupRequest` 已有, 但不是 scheduler barrier。
- `events.jsonl`、`workflow_events.jsonl`、`store.emit_event()` 的 schema 已经分裂。
- `/api/decisions` 是 UI inbox projection, 不是 durable decision truth。

本质问题是: ACC 缺少“为什么下一步会执行, 由谁决定, 按什么约束, 如何复盘”的运行期事实。

## 目标

1. 新增一套 run-scoped control ledger ABI, 作为 fixed/supervisor/handoff/human gate 的共同底座。
2. 定义 `ControlPolicy`、`RunPlan`、`PlanStep`、`DispatchEnvelope`、`DecisionRecord`、
   `ReplayPolicy` 的最小字段和状态机。
3. 明确 `run_plan.json`、`plan_steps.jsonl`、`dispatches.jsonl`、`decisions.jsonl`、
   `events.jsonl` 的职责、writer、reader 和 latest-state 规则。
4. 为新增 control ledger event 定义唯一 canonical writer; 不继续新增 `workflow_events.jsonl`
   writer。
5. 让 `events.jsonl` 只作为 timeline/index, 决策正文以 `decisions.jsonl` 为 source of truth。
6. 保持 `FunctionInvocation`、`ScopeFrame`、`SessionInstance`、`ArtifactBundle` 仍是执行证据核心。

## 非目标

- 不新增数据库、云队列、分布式 worker 或 durable server-side scheduler。
- 不替换 `ExecutionPlan`、`compile_execution_plan()` 或 `execute_core_v2_node()`。
- 不修改 runtime hot path, 不要求 fixed run 在本 design 中写 ledger。
- 不让 `ControlPolicy` 吞并 `RuntimePolicy`、`PermissionProfile`、`InvocationPolicy`、
  `CallableOverride`、adapter capability 或 file permission。
- 不把 `/api/decisions` 当成 `DecisionRecord` 的 source of truth。
- 不实现 GraphOps apply。

## 核心模型

### ControlPolicy

`ControlPolicy` 只管控制权, 不管执行权限和文件权限。

建议字段:

```text
policy_id
mode: fixed | supervisor | handoff
actor: system | supervisor:<node_id> | node:<node_id> | human
allowed_targets:
  - node_id
  - callable_ref
requires_human_approval: bool
allow_dynamic_dispatch: bool
allow_handoff: bool
max_dispatch_depth
max_repeat_per_target
max_concurrency
replay_policy_ref
metadata
```

边界:

- `ControlPolicy` 可以引用 `RuntimePolicy` / `InvocationPolicy`, 但不能复制它们的字段。
- `ControlPolicy` 只限制“能不能产生下一步”和“下一步能指向谁”。
- file write、network、timeout、adapter capability 仍由已有 runtime/callable policy 负责。

### RunPlan

一次 `FunctionInvocation` 的运行期可执行计划。

建议字段:

```text
run_plan_id
run_id
workflow_function_id
invocation_id
source: fixed | supervisor | handoff | replay
schema_version
template_snapshot_ref
control_policy_id
created_at
status: proposed | active | completed | failed | cancelled
step_count
metadata
```

持久化:

- `run_plan.json`: 当前 run 的主计划摘要。
- `plan_steps.jsonl`: 每个 `PlanStep` 的 append/update 记录。

### PlanStep

一个可调度步骤, 不是执行结果。

建议字段:

```text
plan_step_id
run_plan_id
run_id
node_id
callable_ref
depends_on: plan_step_id[]
source: fixed | supervisor | handoff | replay
status:
  pending
  ready
  waiting_interaction
  dispatching
  running
  success
  failed
  skipped
  cancelled
dependency_node_ids
input_snapshot_refs
required_interaction_id
dispatch_id
decision_id
session_id
artifact_bundle_id
failure_id
created_at
updated_at
metadata
```

状态机:

```text
pending -> ready -> dispatching -> running -> success
pending -> waiting_interaction -> ready
pending/ready/running -> failed
pending/ready/waiting_interaction -> skipped
pending/ready/running/waiting_interaction -> cancelled
```

`plan_steps.jsonl` 每行必须是 transition record, 不是局部 patch:

```text
sequence
recorded_at
plan_step_id
previous_status
next_status
snapshot
reason
decision_id?
dispatch_id?
```

projection latest-state 规则:

- 按 `sequence` 升序读取。
- 同一 `plan_step_id` 以后出现的 transition 覆盖早期状态。
- duplicate `sequence` reject。
- 非法 status transition reject。
- snapshot 必须包含完整 `PlanStep` 当前视图, 不能要求 reader 合成字段。

### DispatchEnvelope

真正交给 Core v2 execution substrate 的调用信封。

建议字段:

```text
dispatch_id
run_id
run_plan_id
plan_step_id
node_id
callable_ref
scope_frame_id
invocation_id
idempotency_key
correlation_id
input_ref
policy_snapshot_ref
created_by_decision_id
attempt
created_at
status: pending | started | completed | failed | cancelled
result_refs
```

持久化:

- `dispatches.jsonl`: append-only dispatch 记录。
- `events.jsonl` 可写 `dispatch_started` / `dispatch_completed` / `dispatch_failed`, 但只引用
  `dispatch_id` 和 `decision_id`。

`dispatches.jsonl` 每行同样是 transition record:

```text
sequence
recorded_at
dispatch_id
previous_status
next_status
snapshot
reason
decision_id
plan_step_id
```

### DecisionRecord

运行期决策事实。它回答“为什么这样做”。

建议字段:

```text
decision_id
run_id
run_plan_id
actor:
  system
  supervisor:<node_id>
  node:<node_id>
  human
kind:
  compile_plan
  dispatch
  approval
  supervisor_plan
  handoff
  retry
  cancel
  no_action
timestamp
policy_snapshot
candidates
selected
rejected
rationale
input_evidence_refs
result_refs
replay_binding
correlation_id
metadata
```

持久化:

- `decisions.jsonl` 是决策 source of truth。
- `events.jsonl` 只写 `decision_recorded` 并引用 `decision_id`。
- `/api/decisions` 只能聚合/投影, 不能写或伪造 `DecisionRecord`。

### ReplayPolicy

Replay 是控制语义的一部分, 不是 debugger 附属功能。

建议字段:

```text
replay_policy_id
mode:
  deterministic_recompile
  reuse_recorded_decisions
  require_reapproval
  disabled
template_snapshot_required: bool
reuse_human_answers: bool
reuse_supervisor_decisions: bool
reuse_handoff_decisions: bool
graphops_apply_allowed: false
metadata
```

默认规则:

- fixed replay 可重新 compile, 但要校验 template snapshot。
- supervisor replay 默认复用历史 `DecisionRecord`, 不重新问 LLM。
- handoff replay 默认复用历史 route/accept/reject decision。
- human approval replay 默认复用历史 answer, 除非显式 `require_reapproval`。
- GraphOps replay 只 replay proposal/dry-run evidence, 不自动 apply。

## 文件职责

| 文件 | Source of truth | Writer | Reader |
| --- | --- | --- | --- |
| `run_plan.json` | 是, 当前 run 的 plan 摘要 | `acc.app` runtime coordination | API, Workbench, debugger |
| `plan_steps.jsonl` | 是, step 状态历史 | `acc.app` / store helper | API, Workbench, replay |
| `dispatches.jsonl` | 是, dispatch 历史 | Core v2 runtime wrapper | API, replay |
| `decisions.jsonl` | 是, decision 正文 | runtime/supervisor/human gate app services | API, Workbench, replay |
| `events.jsonl` | 时间线索引, 不是 decision 正文 | canonical event writer | API, debugger |
| `run_summary.json` | Projection | runtime/run manager | API, Workbench |
| `workflow_events.jsonl` | Legacy/historical only | 不新增 writer | 兼容读取, 后续迁移 |

## Event ABI 子目标

本 design 只定义新增 control ledger event 的 writer 和 schema, 不负责迁移所有历史 writer。

当前代码中至少存在三类事件形状:

- Core v2 runtime `append_event()`: `event_id/type/timestamp/run_id/node_id/payload` 风格。
- `store.emit_event()`: `event_type/status/workflow_run_id/payload` 风格。
- `acc.persistence.events.EventsWriter`: `ts/event_type/payload` 风格。

新增 control ledger event 必须只走一个 canonical writer:

```text
event_id
type
timestamp
run_id
scope_frame_id?
node_id?
session_id?
plan_step_id?
dispatch_id?
decision_id?
payload
```

边界:

- 不新增 `workflow_events.jsonl` writer。
- 不让 server route 直接写 event file。
- 老 reader 可以继续兼容读旧文件, 但不能把旧 schema 当新增 truth。
- `events.jsonl` 只索引 decision/dispatch/step, 不保存 `DecisionRecord` 正文。

## 模块边界

- `acc.domain`: 新 dataclass / type aliases / payload-neutral domain objects。
- `acc.engine`: pure validation 和 pure conversion, 如 `ExecutionPlan -> RunPlan` 校验。
- `acc.store`: JSON/JSONL 写入、path protection、atomic write、append-only helper。
- `acc.app`: runtime coordination, 绑定当前 `FunctionInvocation` / `ScopeFrame` / run dir。
- `acc.server`: 只做 request parsing、service call、response shaping。
- `web/`: projection, 不写 runtime truth。

## 最小落地任务

1. 在 `acc.domain` 定义核心类型和状态 literal。
2. 在 `acc.engine` 定义 pure validators:
   - duplicate `plan_step_id` reject。
   - missing dependency reject。
   - invalid status transition reject。
   - `DecisionRecord` 缺 `actor/kind/input_evidence_refs` reject。
   - replay policy mode 校验。
3. 在 `acc.store` 或独立 app helper 定义 canonical JSON/JSONL payload helpers。
4. 定义 latest-state projection loader:
   - `load_run_plan()`
   - `load_plan_steps()`
   - `load_dispatches()`
   - `load_decisions()`
5. 定义新增 control ledger event writer, 并明确不新增 `workflow_events.jsonl` writer。
6. 增加只读 helpers, 供 server/API/Workbench projection 使用。
7. 不修改 `run_workflow_function_invocation()` 或 `execute_core_v2_node()`; runtime 集成留给
   Design 02。

## 风险

1. 如果本 design 越界接入 runtime hot path, Goal 1 会变成行为改动, 失去低风险验证价值。
2. 如果继续给 `workflow_events.jsonl` 加 writer, event schema 会进一步分裂。
3. 如果 `DecisionRecord` 同时写入多个文件为正文, replay 会失去单一事实源。
4. 如果 `ControlPolicy` 吞并 runtime permission, 会破坏现有 callable/runtime policy 边界。

## 验收标准

- 新 domain types / validators / payload helpers 可单独测试。
- `plan_steps.jsonl` 和 `dispatches.jsonl` latest-state projection 规则明确且有测试。
- 新增 control ledger event 只走一个 canonical writer。
- `workflow_events.jsonl` 不新增 writer。
- `/api/decisions` 没有被改成 truth writer。
- fixed workflow 当前输出行为不变, 因为本 design 不接 runtime hot path。
- 默认测试 hermetic。

## 建议测试

- unit: domain validator 覆盖 duplicate step、missing dependency、invalid status transition。
- unit: `DecisionRecord` 缺 `decision_id/run_id/actor/kind/input_evidence_refs` 时 reject。
- unit: duplicate JSONL sequence reject。
- unit: latest-state loader 按 sequence 得到最终 `PlanStep` / `DispatchEnvelope`。
- unit: canonical control event writer schema。
- focused regression: server route 不直接写 `decisions.jsonl`。
- focused regression: `workflow_events.jsonl` 不新增 writer。
- API focused: run plan/steps/decisions projection helpers 只读, missing files 返回 empty/warnings。
