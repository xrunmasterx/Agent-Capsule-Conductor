# Goal 02: Fixed RunPlan Dispatch

## 一句话目标

把当前 fixed workflow 热路径接入 control ledger: `ExecutionPlan -> RunPlan -> PlanStep ->
DispatchEnvelope -> execute_core_v2_node()`, 保持 fixed workflow 输出行为等价。

## 第一性原理

先用确定性 fixed DAG 验证 control ledger, 因为它没有 LLM 随机性, 最容易证明新账本不改变现有执行语义。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/01_RUNTIME_CONTROL_LEDGER.md`
- `docs/Design/02_FIXED_RUNPLAN_DISPATCH.md`
- `docs/Design/Goals/GOAL_01_RUNTIME_CONTROL_LEDGER_ABI.md`
- 本文件

## 前置条件

Goal 01 completed, focused tests passed。

## 允许修改

- `acc/engine/*` fixed `ExecutionPlan -> RunPlan/PlanStep` pure conversion
- `acc/app/core_v2_runtime.py` 最小 wrapper 集成
- `acc/store/*` control ledger writer 调用
- focused runtime/integration tests

## 禁止修改

- 不实现 supervisor/handoff/human gate。
- 不把 `acc/app/scheduler.py` wakeup queue 当 PlanStep scheduler。
- 不扩大 `CallableInvocationService`。
- 不改 Workbench UI。
- 不新增 GraphOps runtime dispatch。

## 任务

1. 新增 pure conversion: `ExecutionPlan -> RunPlan + PlanStep[]`。
2. fresh fixed run 初始化时写 `run_plan.json` 和 initial `plan_steps.jsonl`。
3. dispatch 前写:
   - `DecisionRecord(kind="dispatch", actor="system")`
   - `DispatchEnvelope`
   - `dispatch_started` control event
4. node success 后写:
   - dispatch completed transition
   - step success transition
   - result refs: `session_id`、`artifact_bundle_id`
5. node failure 后写:
   - dispatch failed transition
   - step failed transition
   - failure refs
6. 保留现有:
   - payload materialization
   - result store
   - artifact bundle
   - nested workflow path
   - run summary
   - cancel/failure behavior
7. ledger writer failure after node success 不标普通 node failed; 使用 `crashed` 或明确 audit failure projection。

## 验收标准

- fixed one-node/two-node workflow 输出等价。
- 每个实际执行 node 有 `PlanStep`、`DispatchEnvelope`、`DecisionRecord(kind="dispatch")`。
- failure node 写 ledger failure refs。
- nested `workflow_function` 仍走 Core v2 nested path。
- CLI JSON stdout 合同不被 ledger logging 污染。

## 建议测试

```bash
uv run pytest -q tests/integration tests/unit/test_control_ledger_domain.py tests/unit/test_control_ledger_store.py
uv run ruff check .
```

可用更小 focused set, 但必须覆盖 fixed success、fixed failure、nested workflow、CLI JSON stdout 合同。

## 完成后进入

`GOAL_03_FIXED_ONLY_PROJECTION.md`

