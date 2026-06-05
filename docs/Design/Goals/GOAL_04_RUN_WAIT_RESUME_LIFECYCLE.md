# Goal 04: Run Wait/Resume Lifecycle

## 一句话目标

实现 non-destructive wait/resume 生命周期, 让 run 可以进入等待态并在 answer/wakeup 后恢复,
不删除 run dir, 不重跑已成功 step。

## 第一性原理

Human gate 和 handoff acceptance 都不是“重新跑一次”。它们需要恢复同一次 run 的剩余控制步骤。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/03_RUN_WAIT_RESUME_LIFECYCLE.md`
- `docs/Design/Goals/GOAL_02_FIXED_RUNPLAN_DISPATCH.md`
- 本文件

## 前置条件

Goal 02 completed。Goal 03 建议已完成, 但 wait/resume 可先用 backend tests 验证。

## 允许修改

- runtime/app resume service
- `WorkbenchRunManager` status classification 最小修改
- `acc/app/scheduler.py` wakeup consumer/helper 最小扩展
- focused tests

## 禁止修改

- 不引入 durable distributed scheduler。
- 不把 `WorkbenchRunManager` 变成 runtime truth。
- 不实现 human gate UI。
- 不实现 supervisor/handoff。
- resume path 不调用 destructive fresh init。

## 任务

1. 定义 run statuses:
   - `waiting_interaction`
   - `waiting_handoff`
   - `waiting_timer`
   - `resuming`
2. 这些状态是 non-terminal, 不能被折算成 `success`。
3. resume service:
   - load existing run dir。
   - load `run_plan.json` / `plan_steps.jsonl` / `decisions.jsonl`。
   - validate run waiting and not terminal。
   - do not delete run dir。
   - do not rerun success steps。
4. `WorkbenchRunManager`:
   - waiting/resuming 属于 active/non-terminal projection。
   - background task 因 waiting 返回时, 不写 terminal success。
   - restart reconcile 不把 waiting run 改 crashed。
5. `WakeupRequest` consumer 最小实现:
   - human reason 可触发 resume service 或 resume job。
   - wakeup queue 是 signal, 不是真相。

## 验收标准

- fresh fixed run 行为不变。
- waiting run 不被标记为 success。
- waiting run 不删除 run dir。
- resume 不重跑已成功 step。
- terminal run answer/wakeup 被拒绝。
- restart reconcile 保留 waiting run, running/resuming 才按 interrupted 规则处理。

## 建议测试

```bash
uv run pytest -q tests/unit/test_workbench_run_manager.py tests/unit tests/server
uv run ruff check .
```

必须包含 run status classification、resume non-destructive、terminal answer/wakeup rejection。

## 完成后进入

`GOAL_05_HUMAN_GATE_BARRIER.md`

