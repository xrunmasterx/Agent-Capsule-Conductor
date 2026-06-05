# Design 03: Run Wait/Resume Lifecycle

生成日期: 2026-06-02

## 结论

Human gate、handoff acceptance、supervisor replay 都依赖同一个前置能力: run 可以进入等待态,
之后在不删除 run dir、不重跑已完成节点的前提下恢复。

当前 fixed fresh run 的初始化会删除 `run_dir`, 这对普通 fresh run 是可接受的, 但不能用于
resume。必须先定义 wait/resume lifecycle, 再落地 human gate。

## 当前事实

当前 fresh run 路径:

```text
run_core_v2_workflow_path()
  -> run_workflow_function_invocation()
  -> if run_dir.exists(): shutil.rmtree(run_dir)
  -> recreate run dir
  -> execute plan.levels
```

当前 Workbench async model:

- `WorkbenchRunManager` 只管理进程内 task 和 queue。
- durable facts 在 `runs/<run_id>`。
- terminal statuses 当前是 `success`、`failed`、`cancelled`、`crashed`。
- unknown terminal status 可能在 projection 中被折算为 `success`。

这意味着:

- waiting run 不能走 fresh init。
- resume run 不能调用会删除 `run_dir` 的入口。
- `run_summary.status` 必须让 Workbench 和 run manager 知道它不是 terminal。
- wakeup queue 只是信号, 不是 truth。

## 目标

1. 定义 fresh run、waiting run、resumed run 三种生命周期。
2. 定义 non-terminal waiting 状态和 run summary projection。
3. 定义 resume 时如何加载 existing `RunPlan` / `PlanStep` / `DispatchEnvelope` /
   `DecisionRecord`。
4. 定义 `WakeupRequest` consumer 的最小职责。
5. 防止 terminal run 被 answer/wakeup 重新打开。

## 非目标

- 不引入 durable distributed scheduler。
- 不把 `WorkbenchRunManager` 变成 source of truth。
- 不实现完整 crash recovery。
- 不实现长期 timer/timeout scheduler。
- 不重新设计 all event writers。

## Run lifecycle

### Fresh run

Fresh run 是当前 fixed workflow 默认路径。

```text
fresh run
  -> may remove/recreate run_dir
  -> initialize FunctionInvocation / ScopeFrame
  -> initialize RunPlan / PlanStep
  -> dispatch ready steps
```

约束:

- 只能用于从未开始或明确允许 overwrite 的 run。
- 不能用于 waiting/resume。

### Waiting run

当某个 `PlanStep` 需要等待 human/acceptance/timer 时:

```text
dispatch wrapper
  -> PlanStep.status = waiting_interaction | waiting_handoff | waiting_timer
  -> create waiting record
  -> run_summary.status = waiting_interaction
  -> return control to manager without marking success
```

建议新增 non-terminal run statuses:

```text
waiting_interaction
waiting_handoff
waiting_timer
resuming
```

这些状态必须属于 active/non-terminal projection, 不能被 `_write_terminal_summary()` 折算成
`success`。

### Resumed run

Resume 不是重新运行 workflow。

```text
wakeup claimed
  -> load existing run dir
  -> load run_plan.json / plan_steps.jsonl / decisions.jsonl
  -> validate run is waiting and not terminal
  -> resolve answered interaction or accepted handoff
  -> update waiting PlanStep
  -> dispatch ready remaining steps
```

约束:

- 不调用 destructive fresh init。
- 不重跑 success steps。
- 不重新问 supervisor LLM。
- 不重新征求人审, 除非 `ReplayPolicy` / resume policy 明确要求。

## WorkbenchRunManager 边界

`WorkbenchRunManager` 仍只管理 process-local execution handles。

需要调整的契约:

- `ACTIVE_RUN_STATUSES` 增加 waiting/resuming statuses。
- `_write_terminal_summary()` 不能把 waiting/resuming status 折算成 `success`。
- 当 background task 因 waiting 状态返回时, manager 应保留 run summary 为 waiting, 并从 active
  task map 移除。
- answer/wakeup 后可以提交 resume job, 但 resume job 读取 existing run dir, 不重建 spec。
- server restart 后, waiting run 不能被 reconcile 成 `crashed`; running/resuming 才可按现有
  interrupted-run 规则处理。

## Wakeup consumer

`WakeupRequest` 是信号, 不是控制事实。

最小 consumer:

```text
claim_next_ready(run_dir)
  -> if reason == human:
       validate interaction answered
       submit resume job or call resume service
  -> if reason == supervisor/handoff/timer:
       future extension
```

P0 可先由 answer API 显式触发 resume, 但仍要写 wakeup 作为 evidence signal。长期再做后台
claim loop。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `run_summary.json` | projection, 包含 waiting/resuming status |
| `run_plan.json` | resume 加载的 plan truth |
| `plan_steps.jsonl` | resume 判断 ready/waiting/success |
| `decisions.jsonl` | resume/replay 复用决策 |
| `interactions/*.json` | human waiting 输入 |
| `wakeup_queue.jsonl` | resume signal |
| `events.jsonl` | timeline |

## 失败路径

必须定义:

- resume 时 run dir 不存在。
- run 已 terminal, 收到 answer/wakeup。
- run status 不是 waiting/resuming。
- waiting step 找不到。
- interaction 未 answered。
- answer 与 waiting step 不匹配。
- ledger 文件损坏。
- resume dispatch 失败。
- server restart 后 waiting run 保留, running run reconcile 为 crashed。

## 验收标准

- fresh fixed run 行为不变。
- waiting run 不被标记为 `success`。
- waiting run 不删除 run dir。
- answer/wakeup 后 resume 不重跑已成功 step。
- terminal run answer 被拒绝。
- `WorkbenchRunManager` 不把 waiting/resuming 当 terminal。
- restart reconcile 不把 waiting run 改成 crashed。

## 建议测试

- unit: run status classification includes waiting/resuming as active/non-terminal。
- unit: `_write_terminal_summary()` 不把 waiting status 写成 success。
- unit: interrupted run reconcile 对 waiting 保持不变, 对 running 写 crashed。
- integration: fake workflow 第一节点 success, 第二节点 waiting, resume 后只执行第二节点。
- server: terminal run answer rejects。
- server: answer waiting interaction triggers resume job or resume service。
- regression: fresh run 仍可清空并重建 run dir。
