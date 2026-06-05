# Goal 05: Human Gate Barrier

## 一句话目标

让 human gate 成为 runtime barrier: step 等待人类 answer, approve 后 resume, reject 后不执行 callable,
并写 `DecisionRecord(kind="approval")`。

## 第一性原理

人类参与必须是 runtime truth, 不是 UI card。answer 之后的控制结果必须可审计、可 replay。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/04_HUMAN_GATE_BARRIER.md`
- `docs/Design/03_RUN_WAIT_RESUME_LIFECYCLE.md`
- 本文件

## 前置条件

Goal 04 completed, run wait/resume lifecycle 可用。

## 允许修改

- control policy or canonical node typed field for human approval
- app interaction/human gate service
- server interaction route thinning if needed
- runtime dispatch barrier integration
- focused tests

## 禁止修改

- 不用 `metadata` / `raw` 承载执行语义。
- 不写 `DecisionRecord(kind="wait")`。
- 不让 Workbench 决定 approve 后执行什么。
- 不实现 supervisor/handoff。
- 不新增 `workflow_events.jsonl` writer。

## 任务

1. 用 typed `ControlPolicy` 或 canonical `NodeInvocationSpec` 扩展表达 requires approval。
2. dispatch wrapper 遇到 approval step:
   - 不执行 callable。
   - step -> `waiting_interaction`。
   - create `InteractionRequest(status=pending)`。
   - write canonical event。
   - run summary -> non-terminal waiting status。
3. answer service:
   - validate interaction pending。
   - approve/reject option validation。
   - write `DecisionRecord(kind="approval")`。
   - append canonical event。
   - enqueue `WakeupRequest(reason="human")`。
4. approve path resumes and dispatches step。
5. reject path skips/fails step with explicit evidence。
6. route stays thin。

## 验收标准

- pending approval step 不执行 callable。
- pending interaction 可读取。
- approve 写 approval decision + wakeup, 并 resume。
- reject 不执行 callable, 有 step/decision evidence。
- duplicate answer defined as idempotent same-answer or rejected different-answer。
- terminal run answer rejected。

## 建议测试

```bash
uv run pytest -q tests/unit tests/server tests/integration
uv run ruff check .
```

必须覆盖 pending -> approve -> resume, pending -> reject -> not executed。

## 完成后进入

`GOAL_06_SUPERVISOR_PLANSTEP_P0.md`

