# Goal 09: Handoff P0

## 一句话目标

Handoff P0: typed policy validation、illegal target reject、`new_session` 和 `route_only`。
不实现 `resume_session`、timeout/fallback/replay 的完整执行。

## 第一性原理

Handoff 是局部控制权转移, 不是“agent 随便叫另一个 agent”。P0 先把 target/mode/payload 边界定义清楚。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/06_HANDOFF_SEMANTICS.md`
- `docs/Design/03_RUN_WAIT_RESUME_LIFECYCLE.md`
- 本文件

## 前置条件

Goal 05 completed for human/wait semantics。Goal 07/08 建议已完成。

## 允许修改

- handoff domain/policy validation
- handoff plan-step generation
- app coordination
- focused tests

## 禁止修改

- 不实现 arbitrary agent-to-agent free call。
- 不共享 conversation memory 作为默认语义。
- 不让 source agent 写 target workspace。
- P0 不实现 `resume_session`。
- P0 不实现 timeout/fallback execution。
- P0 不实现 replay。

## 任务

1. Define `HandoffControlPolicy` or `ControlPolicy(mode="handoff")` payload。
2. Define handoff decision/record schema fields:
   - source
   - target
   - mode
   - payload refs
   - artifact refs
   - acceptance refs
3. Validate target:
   - outgoing edge target or approved roster target only。
4. Implement `new_session`:
   - generate target `PlanStep`。
   - dispatch through Core v2 wrapper。
5. Implement `route_only`:
   - select existing outgoing target。
   - do not create new session。
6. Reject `resume_session` explicitly in P0。
7. Keep timeout/fallback/replay as schema-only/deferred。

## 验收标准

- illegal target reject and no step generated。
- `new_session` creates target step and output via Core v2 dispatch。
- `route_only` selects existing outgoing target。
- `resume_session` rejected with explicit reason。
- no workspace direct write。
- no conversation memory implicit sharing。

## 建议测试

```bash
uv run pytest -q tests/unit tests/integration
uv run ruff check .
```

必须覆盖 illegal target、new_session、route_only、resume_session rejected。

## 完成后进入

`GOAL_10_GRAPHOPS_GOVERNANCE_OPTION_A.md`

