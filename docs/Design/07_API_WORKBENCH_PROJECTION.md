# Design 07: API and Workbench Projection

生成日期: 2026-06-02

## 结论

API 和 Workbench 的设计顺序必须从“运行事实如何落盘”开始, 不是从“UI 要显示什么”开始。
Workbench 只能读取和组合 run dir 事实:

```text
run_summary.json
events.jsonl
run_plan.json
plan_steps.jsonl
dispatches.jsonl
decisions.jsonl
interactions/
artifacts/
result_store/
```

`activeRunId`、`latestRunId`、canvas node status、SSE live log 都只是 projection 或 convenience
pointer。

本 design 分阶段落地:

- P0: fixed-only control ledger read API 和可选最小 Workbench 展示。
- P1: human gate projection。
- P2: supervisor projection。
- P3: handoff projection。

## 当前事实

- Workbench async submit 入口是 `/api/workflows/run-graph/submit`。
- `WorkbenchRunManager` 是 server-scoped execution handle manager, durable facts 在 run dir。
- `/api/runs/{run_id}` 和 `/api/runs/{run_id}/events` 是当前主要读取路径。
- `/api/runs/{run_id}/stream` 是 best-effort SSE live log, 不是 source of truth。
- `/api/decisions` 当前是 inbox aggregation。
- `InteractionPanel` 当前展示 pending interactions 并调用 answer API。

## 目标

1. 新增 control ledger 的 read-only API projection。
2. 保持 submit path 不解释控制决策。
3. 让 Workbench 展示 plan/step/decision/replay audit, 但不保存这些正文。
4. SSE 只做 notification, 收到后触发 re-fetch。
5. `DecisionInbox` 和 `DecisionRecord` 明确分离。

## 非目标

- 不让 Workbench localStorage 存 `DecisionRecord` 正文或 `PlanStep` 状态。
- 不让 `WorkbenchRunManager` 承载 scheduler truth。
- 不用 SSE chunk 替代 polling/read API。
- 不把 `/api/decisions` 改成 write path。

## API 设计

新增 read-only endpoints:

```text
GET /api/runs/{run_id}/plan
GET /api/runs/{run_id}/steps
GET /api/runs/{run_id}/dispatches
GET /api/runs/{run_id}/decisions
GET /api/runs/{run_id}/replay-policy
```

可选聚合 endpoint:

```text
GET /api/runs/{run_id}/control-ledger
```

返回:

```text
run_id
plan
steps
dispatches
decisions
events_ref
warnings
```

`/api/decisions` 保持 inbox:

- 聚合 failed runs。
- 聚合 pending/manual review。
- 聚合 GraphOps proposals。
- 可引用 `decision_id`, 但不替代 `/api/runs/{run_id}/decisions`。

P0 只要求这些 endpoint 能展示 fixed run 的 plan/steps/dispatches/decisions。human、
supervisor、handoff 字段可以为空或返回 warnings, 不能伪造 truth。

## Server 边界

`acc.server.routes.*`:

- validate path components。
- call app projection service。
- shape response。
- translate errors。

不做:

- 直接写 `decisions.jsonl`。
- 直接解析 LLM plan。
- 直接推进 scheduler。

建议新增 app/service helper:

```text
acc.app.control_projection
  load_run_plan_projection()
  load_plan_steps_projection()
  load_dispatches_projection()
  load_decisions_projection()
  load_control_ledger_projection()
```

## Workbench 设计

### WorkflowViewer

继续:

- submit 走 `/api/workflows/run-graph/submit`。
- polling 读 `/api/runs/{run_id}` 和 `/api/runs/{run_id}/events`。
- run terminal 后停止高频 polling。

新增:

- 选中 run 时读取 `/api/runs/{run_id}/control-ledger` 或分 endpoint。
- node overlay 可显示 `PlanStep.status` projection。
- node inspector 可显示 `decision_id`、`dispatch_id`、`artifact_bundle_id`。

禁止:

- 把 `PlanStep.status` 写回 canvas template。
- 把 `DecisionRecord` 正文写 localStorage。
- 用 SSE 事件直接改变 durable decision 状态。

### InteractionPanel

继续:

- 读取 pending interactions。
- answer interaction。

新增:

- answer 后重新拉 `/api/runs/{run_id}/decisions` 和 `/api/runs/{run_id}/steps`。
- 显示 answer 对应的 decision audit link。

### DecisionInboxPanel

职责:

- 展示全局需要注意的事项。
- 对 run failure、manual review、GraphOps proposal、pending human gate 做聚合。

不是:

- `DecisionRecord` source of truth。
- GraphOps apply executor。

### RunInspector

新增:

- decision timeline。
- replay policy 展示。
- step/dispatch/result refs。

保留:

- raw artifacts 和 logs。
- debugger replay output。

## SSE / Polling

Polling 是 truth read path:

```text
GET /api/runs/{run_id}
GET /api/runs/{run_id}/events
GET /api/runs/{run_id}/control-ledger
```

SSE 是 notification:

```text
decision_recorded
interaction_created
step_status_changed
dispatch_completed
```

收到 SSE 后:

- UI 标记 stale。
- re-fetch read API。

SSE payload 不作为最终状态。

## 验收标准

- P0 新 API 全部 read-only, 且 fixed-only。
- `/api/workflows/run-graph/submit` 行为不变。
- `WorkbenchRunManager` 不保存 `DecisionRecord` 或 `PlanStep` truth。
- Workbench localStorage 不包含 decisions/steps/dispatches 正文。
- `/api/decisions` 仍是 inbox projection, 可链接 run-scoped decision。
- SSE 中断时 polling 仍能恢复正确 UI。

## 建议测试

后端:

- server test: `GET /api/runs/{run_id}/plan` 读取 `run_plan.json`。
- server test: `GET /api/runs/{run_id}/decisions` 读取 `decisions.jsonl`。
- server test: missing ledger returns empty/warnings, 不伪造 truth。
- server test: `/api/decisions` item 可引用 `decision_id`, 但正文来自 run endpoint。

前端:

- `api.ts` 类型: `RunPlanView`、`PlanStepView`、`DispatchView`、`DecisionRecordView`。
- WorkflowViewer: submit path still `/run-graph/submit`。
- WorkflowViewer: localStorage 不含 decision/step/dispatch 正文。
- P0 WorkflowViewer/RunInspector: fixed run decision timeline render。
- later InteractionPanel: answer 后刷新 decisions/steps。
- `cd web && npm run test -- --run`。
- `cd web && npm run build`。

浏览器 journey:

- P0 fixed run: queued -> running -> success, ledger visible。
- P0 SSE disabled/failed 时 polling 仍正确。
- later human gate: pending -> approve -> resumed, decision audit visible。
- later supervisor fake run: plan -> worker dispatch -> replay audit visible。
