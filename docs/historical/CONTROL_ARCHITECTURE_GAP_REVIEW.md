# ACC Control Architecture Gap Review

生成日期：2026-06-02

本文记录一次基于当前工作树的控制架构查漏补缺。用户提到有 GPT Pro 建议，但本轮对话没有提供 GPT Pro 原文，因此本文不评价未给出的具体建议，只评价当前 ACC 架构与“fixed workflow / supervisor / handoff”目标之间的差距。

本轮使用了两个 subagent 做只读批判分析：

- Faraday：控制语义与产品架构视角。
- Beauvoir：代码事实与最小落地视角。

两个 subagent 的结论高度一致：之前“不要做三套 runtime，而是统一为 `ControlPolicy` + `DecisionRecord` + GraphOps”的方向仍成立，但现在需要补充运行期中间层，否则这个建议还不够可落地。

## 一句话结论

当前 ACC 已经从“清理旧 runtime/旧资产”的阶段进入“控制权建模”阶段。fixed DAG 是当前可工作的主路径，supervisor 已经有 domain/engine/app 的局部 scaffold，但还没有接入 Core v2 workflow 热路径；handoff 仍没有正式语义，只存在 interaction、wakeup、data transfer 的碎片能力。

最小补缺不是继续发明模式，而是把三种模式统一成一条运行期控制链：

```text
ControlPolicy
  -> RunPlan
  -> PlanStep
  -> DispatchEnvelope
  -> DecisionRecord
  -> SessionInstance / FunctionInvocation / ArtifactBundle
  -> ReplayPolicy
```

GraphOps 只处理持久 template/resource 变更，不应该成为每次 runtime dispatch 或 handoff 的执行机制。

## 当前事实

### 1. fixed workflow 是当前真实主路径

当前 canonical `.accflow.json` 会解析成 `WorkflowFunctionTemplate`，再编译成 topological `ExecutionPlan`，最后按 `plan.levels` 逐层执行。

代码证据：

- `compile_execution_plan()` 产出执行计划：`acc/engine/__init__.py:146`
- runtime 逐层执行：`acc/app/core_v2_runtime.py:148`
- 同层节点用 `asyncio.gather()` 并发：`acc/app/core_v2_runtime.py:153`
- 单节点执行入口仍是大函数 `execute_core_v2_node()`：`acc/app/core_v2_runtime.py:221`

这说明 fixed workflow 已经能跑，但它不是一个通用事件驱动 scheduler。它的本质是静态 DAG level scheduler。

### 2. supervisor 已有 scaffold，但不是产品级 runtime mode

当前已经存在以下 supervisor 相关模型：

- `AgentCapabilities`：`acc/domain.py:484`
- `SupervisorRoster`：`acc/domain.py:521`
- `DynamicInvocationIntent`：`acc/domain.py:527`
- `SupervisorPlan`：`acc/domain.py:536`
- `DynamicInvocationProposal`：`acc/domain.py:545`
- `SupervisorDecision`：`acc/domain.py:552`

纯校验位于 engine 层：

- `parse_dynamic_invocation_intent()`：`acc/engine/supervisor.py:29`
- `validate_intent_against_roster()`：`acc/engine/supervisor.py:53`
- `parse_supervisor_plan()`：`acc/engine/supervisor.py:62`
- `validate_supervisor_plan()`：`acc/engine/supervisor.py:90`
- `parse_supervisor_decision()`：`acc/engine/supervisor.py:97`

app 层也有局部实现：

- `build_supervisor_roster()`：`acc/app/supervisor.py:42`
- `render_supervisor_prompt()`：`acc/app/supervisor.py:80`
- `SupervisorRouter`：`acc/app/supervisor.py:137`
- `execute_supervisor_plan()`：`acc/app/supervisor.py:286`

但它还没有成为 Core v2 runtime 的热路径。`ACC_ENABLE_SUPERVISOR` 目前只是 policy flag，主 workflow runtime 仍然是 level gather。更关键的是，`SupervisorRouter` 走 `CallableInvocationService.execute_node()`，而该 service 对真实生产 callable 的能力不完整：它拒绝 `workflow_function`、`tool_class`，真实外部 agent 也由 Core v2 runtime adapters 拥有，不能在 supervisor path 直接完整调用。

代码证据：

- `use_supervisor()` 仅暴露 env flag：`acc/runtime/policy.py:32`
- 主 runtime 仍在 `plan.levels` 上循环：`acc/app/core_v2_runtime.py:148`
- `CallableInvocationService.execute_node()` 对非 hermetic/fake 路径能力受限：`acc/app/invocation.py:37`

因此，当前更准确的表述是：ACC 已经有 supervisor substrate，但还没有 supervisor runtime mode。

### 3. handoff 仍没有正式控制语义

当前代码有三个相关碎片：

- data transfer / materialization：上游输出通过 port、inbox/outbox、artifact 显式流动。
- `InteractionRequest`：可以表达人工交互。
- `WakeupRequest`：可以表达事件唤醒和 coalesce。

代码证据：

- `InteractionRequest`：`acc/domain.py:575`
- `create_interaction()`：`acc/app/interactions.py:52`
- `answer_interaction()`：`acc/app/interactions.py:95`
- `create_human_gate_interaction()`：`acc/app/interactions.py:122`
- `WakeupRequest`：`acc/domain.py:562`
- `enqueue_wakeup()`：`acc/app/scheduler.py:118`

但这些还不是 handoff。正式 handoff 至少要回答：

- 谁把控制权交给谁？
- 目标是 accept / reject / defer，还是自动执行？
- 传递的是 payload、artifact ref、scope ref，还是 conversation/session ref？
- 是 resume 旧 `SessionInstance`，还是创建新 `SessionInstance`？
- 超时、拒绝、失败后由谁接管？
- handoff 决策是否可 replay？

当前没有 `HandoffPolicy`、`RouteDecision`、`AcceptHandoff`、`HandoffRecord` 或等价模型。

### 4. `/api/decisions` 不是 durable DecisionRecord

当前 `acc/app/decisions.py` 是 Decision Inbox projection，它把 run failure、manual review、GraphOps examples 聚合成 UI 可展示条目。

代码证据：

- `decision_inbox_payload()`：`acc/app/decisions.py:12`
- run failure/manual review 聚合：`acc/app/decisions.py:33`
- GraphOps examples 聚合：`acc/app/decisions.py:95`
- server route 只是薄包装：`acc/server/routes/decisions.py:15`

这不是运行期决策事实源。它缺少：

- `decision_id`
- `actor`
- `policy_snapshot`
- candidate actions
- selected action
- rejected actions
- input evidence refs
- output/result refs
- replay binding

因此，应把 `DecisionInbox` 和 `DecisionRecord` 明确分开：

- `DecisionRecord` 是 runtime truth。
- `DecisionInbox` 是 UI/app projection。

### 5. GraphOps 边界是对的，但 apply 仍未实现

GraphOps 当前能 validate/dry-run/semantic diff，并且有明确安全拒绝面。

代码证据：

- `validate_patch()`：`acc/graphops.py:35`
- 禁止 schema/output schema mutation：`acc/graphops.py:49`
- workflow target 必须是 `.accflow.json`：`acc/graphops.py:53`
- 禁止 legacy shorthand：`acc/graphops.py:68`
- 禁止危险权限/network/write_files：`acc/graphops.py:76`
- 禁止删除 `human_gate`：`acc/graphops.py:83`
- apply 仍未实现：`acc/graphops.py:194`

这意味着 GraphOps 现在适合作为 proposal/dry-run/control-plane，但不适合作为“supervisor 自动改图并执行”的完成闭环。

更重要的是：GraphOps 不应该处理每次 runtime dispatch。只有持久 template/resource mutation 才应该进入 GraphOps。

```text
runtime dispatch / handoff:
  DecisionRecord -> DispatchEnvelope -> SessionInstance

persistent workflow/template change:
  GraphOps proposal -> validate -> dry-run -> human approval -> apply
```

## 需要修正的旧判断

### 修正 1：不是“没有 supervisor 模型”，而是“已有模型但未接入主路径”

上一轮如果说“当前还没有 concrete supervisor model”，现在必须修正。当前已有 `DynamicInvocationIntent`、`SupervisorPlan`、`SupervisorDecision`、`SupervisorRouter`、`InteractionRequest`、`WakeupRequest`。

但这些仍是分散 scaffold，还没有形成统一 runtime control substrate。

### 修正 2：`ControlPolicy + DecisionRecord` 方向正确，但不够

单独说 `ControlPolicy` 和 `DecisionRecord` 太抽象，缺少中间执行对象。更好的最小模型是：

| 模型 | 作用 |
| --- | --- |
| `ControlPolicy` | 定义谁有权决定下一步，以及决策边界。 |
| `RunPlan` | 一次 run 的可执行计划，可以来自 fixed DAG、supervisor plan 或 handoff recovery。 |
| `PlanStep` | 一个将被调度的步骤，绑定 node/callable/dependencies/input snapshot。 |
| `DispatchEnvelope` | 真正交给执行器的调用信封，包含 idempotency/replay/correlation。 |
| `DecisionRecord` | 记录为什么产生这些 step 或为什么不行动。 |
| `ReplayPolicy` | replay 时复用历史 decision，还是重新计算 deterministic plan。 |

这样 fixed/supervisor/handoff 的共同点就很清楚：

```text
它们本质上都是“谁可以产生或更新 PlanStep”。
```

### 修正 3：GraphOps 不应被放进 runtime handoff 主链

GraphOps 是 authoring/control-plane，不是 runtime scheduler。

错误设计：

```text
supervisor 想调用 worker
  -> GraphOps add_node
  -> apply workflow template
  -> run new graph
```

正确设计：

```text
supervisor 想调用 worker
  -> DecisionRecord(action)
  -> DispatchEnvelope
  -> SessionInstance
```

只有当 supervisor 提出“未来模板应该新增一个节点/边/工具/人审 gate”时，才走 GraphOps。

### 修正 4：handoff 比 supervisor 更缺语义，不应简单复用 supervisor

Supervisor 是中央决策者，handoff 是局部控制权转移。二者类似，但不等价。

Supervisor 的核心问题是：

```text
我作为主控，下一步派谁？
```

Handoff 的核心问题是：

```text
我当前拥有控制权，现在把什么权力、什么上下文、什么责任交给谁？
```

因此 handoff 至少需要：

- `handoff_id`
- `source_node_id`
- `target_node_id` or `target_callable_ref`
- `handoff_mode`: `new_session` / `resume_session` / `route_only`
- `payload_ref`
- `artifact_refs`
- `acceptance_required`
- `timeout_policy`
- `fallback_target`
- `decision_id`

如果不建这个语义，handoff 会退化成“Agent 随便叫下一个 Agent”，重新变成黑盒多 Agent。

## 建议的最小设计

### 1. `ControlPolicy` 只管控制权，不吞并已有 policy

不要把 `ControlPolicy` 做成大筐。当前已经有：

- `RuntimePolicy`
- `PermissionProfile`
- `InvocationPolicy`
- `CallableOverride`
- `TransferPolicy`
- adapter capability

`ControlPolicy` 应只回答这些问题：

- 谁可以产生下一步？
- 可选目标集合是什么？
- 是否必须 human approval？
- 是否允许 dynamic dispatch？
- 是否允许 handoff？
- 最大 dispatch depth / repeat limit / concurrency 是多少？
- replay 时如何处理历史 decision？

建议分成三个 typed policy：

```text
FixedControlPolicy
SupervisorControlPolicy
HandoffControlPolicy
```

不要让它管文件权限、环境变量、artifact copy、timeout、adapter capability。这些已有模型可以被引用，但不应被复制。

### 2. 固定 DAG 也应该编译成 `RunPlan`

当前 fixed DAG 直接从 `ExecutionPlan.levels` 执行。未来应保留这个确定性能力，但把它显式落成 run-scoped plan：

```text
WorkflowFunctionTemplate
  -> ExecutionPlan
  -> RunPlan(source="fixed")
  -> PlanStep[]
  -> DispatchEnvelope
```

这样 supervisor/handoff 不需要新 runtime，只需要追加或更新同一种 `PlanStep`。

### 3. Supervisor 不直接执行 callable，而是产出 `DecisionRecord` 和 `PlanStep`

当前 `SupervisorRouter.invoke_from_intent()` 直接调用 `CallableInvocationService.execute_node()`。这条路能力不完整，也容易发展成第二套 runner。

更稳的方向：

```text
Supervisor LLM output
  -> parse DynamicInvocationIntent / SupervisorPlan
  -> validate against roster + policy
  -> write DecisionRecord
  -> produce PlanStep / DispatchEnvelope
  -> Core v2 callable execution substrate
```

这样真实外部 agent/tool/workflow invocation 仍归 Core v2 runtime 负责。

### 4. Human gate 要成为 scheduler barrier

现在 `InteractionRequest` 已经可以落盘和由 Workbench 展示，但它还不是 runtime barrier。

建议机制：

```text
PlanStep requires human approval
  -> runtime writes InteractionRequest
  -> step status = waiting_interaction
  -> user answers
  -> answer writes DecisionRecord(approve/reject)
  -> enqueue WakeupRequest(reason="human")
  -> scheduler resumes or cancels step
```

这会把“人类深度参与 workflow”从 UI 概念变成 runtime 事实。

### 5. `DecisionRecord` 写入统一事件流

当前事件系统仍有多套写法。这个问题如果不解决，supervisor/handoff 的可审计性会打折。

本轮看到的事件分裂包括：

- Core v2 runtime 写 `events.jsonl`：`acc/app/core_v2_runtime.py:861`
- store helper 写 `workflow_events.jsonl` 风格事件：`acc/store/__init__.py:87`
- interaction route 也写 `workflow_events.jsonl`：`acc/server/routes/interactions.py:76`

建议先定义唯一的 runtime event ABI。`DecisionRecord` 可以独立为 `decisions.jsonl`，也可以作为 canonical event type 写入 `events.jsonl`，但不能同时出现多个真相源。

推荐：

```text
events.jsonl:
  event_id
  type
  timestamp
  run_id
  scope_frame_id
  node_id?
  session_id?
  decision_id?
  payload

decisions.jsonl:
  decision_id
  run_id
  actor
  kind
  policy_snapshot
  candidates
  selected
  rejected
  input_evidence
  result_refs
  timestamp
```

如果保留两者，`events.jsonl` 记录“发生了 decision”，`decisions.jsonl` 记录完整决策正文。

### 6. ReplayPolicy 必须前置

如果 supervisor/handoff 会引入 LLM 动态决策，replay 规则必须提前定义。

推荐规则：

- fixed replay：可以重新 compile deterministic `RunPlan`，但要校验 template snapshot 一致。
- supervisor replay：默认复用历史 `DecisionRecord`，不重新问 LLM。
- handoff replay：默认复用历史 accept/reject/route decision。
- human approval replay：默认复用历史 human answer，除非显式 request re-approval。
- GraphOps replay：只 replay proposal/dry-run evidence，不自动 apply。

否则“replay”会变成“重新跑一遍随机 workflow”，和 ACC 的可审计目标冲突。

## 优先级建议

### P0：运行期控制账本

目标：先让所有控制模式拥有同一种事实记录。

建议新增或设计：

- `RunPlan`
- `PlanStep`
- `DispatchEnvelope`
- `DecisionRecord`
- `ReplayPolicy`

验证标准：

- fixed DAG 能编译出 `RunPlan`。
- fixed DAG 执行仍保持现有 tests 通过。
- 每个实际执行的 node 都有对应 `PlanStep` 和 `DispatchEnvelope`。
- 至少 fixed scheduler 写一条 `DecisionRecord(actor="system", kind="dispatch")` 或等价 dispatch event。

### P1：Supervisor 接入同一执行 substrate

目标：supervisor 不再走第二套 incomplete runner。

建议：

- `DynamicInvocationIntent` 编译为 `PlanStep`。
- `SupervisorDecision` 升级或映射为 `DecisionRecord`。
- `execute_supervisor_plan()` 不直接执行 callable，而是提交 plan steps。
- 补 fake supervisor E2E：plan -> approved -> plan steps -> fake worker output -> decision evidence。

### P1：Human gate barrier

目标：把 `InteractionRequest` 从 UI card 升级为 scheduler barrier。

建议：

- `PlanStep` 增加 `waiting_interaction` status。
- `create_human_gate_interaction()` 在 runtime gate 处自动调用。
- answer 后写 `DecisionRecord(approve/reject)`。
- answer 后通过 `WakeupRequest(reason="human")` 恢复。

### P2：Handoff typed semantics

目标：避免 handoff 变成“Agent 随便叫下一个 Agent”。

建议：

- 新增 `HandoffControlPolicy`。
- 新增 `HandoffRecord` 或用 `DecisionRecord(kind="handoff")` 覆盖。
- 明确定义 accept/reject/resume/new-session/fallback/timeout。
- 限制 handoff 只能选择 outgoing edges 或 approved roster。

### P2：GraphOps apply 或明确长期 deferred

目标：不要让用户误以为 GraphOps 已有完整持久 apply 闭环。

建议：

- 如果短期不实现 apply，文档/API/Workbench 都明确标注 proposal/dry-run only。
- 如果实现 apply，必须先有事务化写入、schema validation、semantic validation、dry-run evidence、human approval 和 rollback story。

## 不建议做的事

### 不建议 1：为三种模式做三套 runtime

这会重复：

- artifact materialization
- permission policy
- event writing
- session manifest
- failure handling
- Workbench projection

最终会把 Core v2 callable-only 重新拆碎。

### 不建议 2：让 `ControlPolicy` 吞并所有 policy

`ControlPolicy` 只应管控制权。不要让它吞掉 `RuntimePolicy`、`PermissionProfile`、`TransferPolicy`、adapter capability、timeout/retry 这些已经有边界的概念。

### 不建议 3：让 supervisor 直接 shell 或直接写 downstream workspace

Supervisor 应该输出 structured intent/plan，由 ACC validation 和 runtime substrate 执行。它不能拼 shell，不能绕过 callable registry，不能写 downstream workspace。

### 不建议 4：把 GraphOps 变成自动 self-modification

GraphOps 必须 human-governed。Supervisor 可以提出 GraphOps proposal，但不能无审批地 apply，更不能把一次 runtime 的临时判断写回 template。

### 不建议 5：把 Workbench 状态当 runtime truth

Workbench 是 projection。运行事实仍应来自 run dir、events、decision records、artifacts、summary。

### 不建议 6：引入数据库/云队列/分布式 worker 解决当前问题

当前缺口是语义和证据模型，不是基础设施能力。先把 local-first JSONL/manifest/plan/decision 模型做一致，比引入 DB 更重要。

## 需要补的测试

建议最小测试集：

1. fixed DAG compile -> `RunPlan` -> execute，输出与当前 fixed path 等价。
2. fake supervisor plan approved -> produces `DecisionRecord` + `PlanStep` -> fake worker output。
3. human gate step -> pending `InteractionRequest` -> answer -> `WakeupRequest` -> step resumes or cancels。
4. replay supervisor run -> uses recorded decisions，不重新解析 LLM output。
5. GraphOps supervisor proposal -> dry-run only，不 mutate `.accflow.json`。
6. event ABI test：decision/event/run summary 三者引用同一 `decision_id` / `run_id`。

## 最终共识

当前设计方向不是错的，甚至比上一轮更成熟：supervisor、interaction、wakeup、capability、GraphOps 的基础件已经出现。

但这也暴露了新的核心问题：这些基础件现在是并列碎片，不是同一条控制链。

所以最优设计不是“再加 supervisor mode / handoff mode”，而是把所有控制模式收敛成：

```text
谁有权产生下一步？
下一步以什么 PlanStep 表达？
为什么做这个决定？
这个决定如何被审计、回放、取消、恢复？
```

只要这条链成立，fixed workflow、supervisor、handoff、人审 gate 都是同一 runtime substrate 上的不同控制策略。这样才符合 ACC 的第一性原理：人类掌控 workflow 结构，AI 可以提案和调度，但所有中间过程都有可验证、可审计、可回放的运行证据。
