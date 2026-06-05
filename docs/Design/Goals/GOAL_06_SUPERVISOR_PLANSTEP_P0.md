# Goal 06: Supervisor PlanStep P0

## 一句话目标

Supervisor P0: approved `SupervisorPlan` 编译成 validated `PlanStep[]` 和 `DecisionRecord`,
**不执行 worker**。

## 第一性原理

先证明 supervisor 只产生结构化控制事实, 再让动态 step 接入执行。否则会形成第二套 runner。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/05_SUPERVISOR_PLANSTEP.md`
- `docs/Design/Goals/GOAL_02_FIXED_RUNPLAN_DISPATCH.md`
- 本文件

## 前置条件

Goal 02 completed。Goal 01 control ledger 可用。

## 允许修改

- `acc/engine/supervisor.py` pure compile/validation
- `acc/app/supervisor.py` plan-to-step coordination, 但不执行 worker
- focused supervisor tests

## 禁止修改

- 不调用 `CallableInvocationService.execute_node()`。
- 不调用 `execute_core_v2_node()`。
- 不执行 worker。
- 不实现 replay。
- 不实现 GraphOps apply。
- 不让 supervisor shell 或写 downstream workspace。

## 任务

1. Reuse existing parser/validator:
   - `DynamicInvocationIntent`
   - `SupervisorPlan`
   - `SupervisorRoster`
2. Define `SupervisorControlPolicy` or typed `ControlPolicy(mode="supervisor")` payload。
3. Implement approved plan -> dynamic `PlanStep[]`。
4. Validate:
   - plan approved。
   - target in roster/allowed targets。
   - node id suggestion sanitized/unique。
   - repeat/depth policy。
5. Write `DecisionRecord(kind="supervisor_plan")`。
6. Append dynamic plan steps。
7. Stop. No dispatch.

## 验收标准

- approved fake `SupervisorPlan` produces decisions/steps。
- unapproved plan rejects。
- invalid roster target rejects and produces no step。
- repeat/depth limit enforced。
- no worker output created in P0。
- no call to `CallableInvocationService.execute_node()`。

## 建议测试

```bash
uv run pytest -q tests/unit/test_supervisor_validation.py tests/unit tests/integration
uv run ruff check .
```

必须有 P0 test 断言 no worker execution。

## 完成后进入

`GOAL_07_SUPERVISOR_DISPATCH_INTEGRATION.md`

