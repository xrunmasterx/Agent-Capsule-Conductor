# Design 04: Human Gate Barrier

生成日期: 2026-06-02

## 结论

Human gate 不能只是 Workbench 里的交互卡片。它必须成为 runtime scheduler barrier:

```text
PlanStep requires approval
  -> PlanStep.status = waiting_interaction
  -> InteractionRequest(status=pending)
  -> human answer
  -> DecisionRecord(kind="approval")
  -> WakeupRequest(reason="human")
  -> resume / skip / fail
```

这样人类参与才是运行事实, 而不是 UI 状态。
本 design 依赖 `03_RUN_WAIT_RESUME_LIFECYCLE.md`; 没有 non-destructive resume, human gate
只能停住, 不能稳妥恢复。

## 当前事实

已有 scaffold:

- `InteractionRequest` 表达 run-scoped human interaction。
- `create_interaction()` / `answer_interaction()` 能落盘和回答。
- `create_human_gate_interaction()` 能创建 approval 交互。
- `WakeupRequest` 和 `enqueue_wakeup()` 能写 file-backed wakeup queue。
- interaction route answer 后会 enqueue `WakeupRequest(reason="human")`。

缺口:

- `InteractionRequest` 没有绑定 `PlanStep.status="waiting_interaction"`。
- answer 后没有 durable `DecisionRecord(kind="approval")`。
- route 直接写 `workflow_events.jsonl`, 不是 canonical event ABI。
- runtime 不会因为 pending interaction 真正暂停某个 step。

## 目标

1. 让需要人审的 `PlanStep` 在 dispatch 前进入 `waiting_interaction`。
2. 自动创建 `InteractionRequest` 并写入 run dir。
3. answer 后写 `DecisionRecord` 和 canonical event。
4. answer 后 enqueue `WakeupRequest(reason="human")`。
5. scheduler/runtime 根据 answer 继续 dispatch 或终止/跳过。

## 非目标

- 不让 Workbench 自己决定 approve 后怎么执行。
- 不把 `run_summary.status=manual_review` 当唯一 barrier truth。
- 不实现复杂团队权限或多用户审批。
- 不引入数据库。

## 触发方式

P1 最小触发方式:

- `ControlPolicy.requires_human_approval=true`。
- 或显式扩展 canonical `NodeInvocationSpec` typed field, 例如
  `control.require_human_approval=true`。

禁止:

- 不用 `node.metadata` / `raw` / `metadata.legacy_*` 承载执行语义。
- 需要新行为语义时, 必须扩展 canonical model 和 validation。

后续可扩展:

- GraphOps proposal apply 前 human approval。
- Supervisor dynamic dispatch 前 human approval。
- Handoff accept/reject approval。

## 状态机

```text
PlanStep.pending
  -> PlanStep.waiting_interaction
  -> InteractionRequest.pending
  -> answer approve
  -> DecisionRecord(kind="approval", selected="approve")
  -> WakeupRequest(reason="human")
  -> PlanStep.ready
  -> dispatch
```

Reject 路径:

```text
InteractionRequest.pending
  -> answer reject
  -> DecisionRecord(kind="approval", selected="reject")
  -> WakeupRequest(reason="human")
  -> PlanStep.skipped | failed | cancelled
```

建议 P1 选择:

- approval reject 默认让 step `skipped`, 并让 workflow failed 或 manual_review 由 explicit policy 决定。
- 如果没有 explicit policy, 更安全的默认是 workflow failed, 因为下游依赖可能不满足。

## 运行期职责

### 创建 gate

在 dispatch wrapper 发现 step 需要 approval 时:

1. 不调用 `execute_core_v2_node()`。
2. 写 `PlanStep.status="waiting_interaction"`。
3. 调用 app 层 human gate service 创建 `InteractionRequest`。
4. 写 `events.jsonl(interaction_created)`。
5. 更新 `run_summary.json` 为 non-terminal waiting projection, 具体状态由
   `03_RUN_WAIT_RESUME_LIFECYCLE.md` 定义。

pending gate 不写 `DecisionRecord(kind="wait")`。`DecisionRecord` 是决策事实, 等 human answer
产生 approve/reject 后再写 `DecisionRecord(kind="approval")`。

### 回答 gate

将现有 route 逻辑下沉到 app service:

```text
answer_human_gate(run_dir, interaction_id, answer)
  -> answer_interaction()
  -> validate answer against options
  -> write DecisionRecord(kind="approval")
  -> append canonical event
  -> enqueue WakeupRequest(reason="human")
```

server route 只做:

- request validation。
- service call。
- HTTP error translation。

### 恢复调度

P1 可以先实现 run-local resume helper, 不要求完整 ready queue:

- 读取 `InteractionRequest.answer`。
- 找到绑定的 `PlanStep`。
- approve: step 转 `ready`, 调用 non-destructive resume path 中的 fixed dispatch wrapper。
- reject: step 转 `failed` 或 `skipped`, 写 decision/result refs。

长期再接入更通用的 ready queue。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `interactions/<interaction_id>.json` | pending/answered human interaction record |
| `decisions.jsonl` | approval decision truth |
| `plan_steps.jsonl` | step barrier status |
| `wakeup_queue.jsonl` | resume signal, 不是 truth |
| `events.jsonl` | timeline |
| `run_summary.json` | projection |

## 失败路径

必须定义:

- interaction 不存在。
- interaction 已 answered, 重复 answer。
- interaction expired/cancelled。
- answer 不在 allowed options。
- answer 后找不到绑定 `PlanStep`。
- wakeup enqueue 失败。
- approve 后 dispatch 失败。
- reject 后下游依赖如何处理。
- run 已 terminal, 仍收到 answer。

重复 answer 建议:

- 相同 answer 幂等返回当前 record。
- 不同 answer 拒绝, 除非未来明确支持 amendment。

## Workbench 行为

Workbench 只负责:

- 拉取 pending interactions。
- 展示 prompt/options。
- 调用 answer API。
- answer 后重新拉 run plan/steps/decisions。

Workbench 不负责:

- 推断 approve 后哪个 step 执行。
- 写 PlanStep 状态。
- 把 answer 写入 localStorage 当 truth。

## 验收标准

- 需要 approval 的 step 不会在 pending 时执行 callable。
- pending interaction 可通过 API/Workbench 看到。
- answer approve 后写 `DecisionRecord` 和 `WakeupRequest(reason="human")`。
- answer reject 后不执行 callable, 且有可审计结果。
- `workflow_events.jsonl` 不新增 writer。
- route 保持 thin。

## 建议测试

- unit: `answer_interaction()` 幂等/非法状态。
- unit: approval answer validator。
- server: answer API 写 decision + wakeup + canonical event。
- integration: gate pending -> approve -> step executes。
- integration: gate pending -> reject -> step not executed。
- integration: terminal run answer rejects。
- web: `InteractionPanel` refreshes pending, answer 后 audit 来自 `/api/runs/{run_id}/decisions`。
