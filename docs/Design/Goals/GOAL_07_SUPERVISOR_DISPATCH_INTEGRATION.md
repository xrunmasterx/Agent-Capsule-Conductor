# Goal 07: Supervisor Dispatch Integration

## 一句话目标

Supervisor P1: 让 P0 生成的 dynamic `PlanStep` 接入统一 `DispatchEnvelope -> execute_core_v2_node()`
路径, 用 hermetic fake E2E 验证 worker output。

## 第一性原理

Supervisor 只能产生下一步; 执行仍必须回到 Core v2 callable substrate。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/05_SUPERVISOR_PLANSTEP.md`
- `docs/Design/Goals/GOAL_06_SUPERVISOR_PLANSTEP_P0.md`
- 本文件

## 前置条件

Goal 06 completed, dynamic steps 可生成但尚不执行。

## 允许修改

- dynamic PlanStep ready/dispatch integration
- app/runtime coordination
- hermetic fake supervisor E2E tests

## 禁止修改

- 不扩大 `CallableInvocationService`。
- 不新增 supervisor runner。
- 不调用真实外部 agent。
- 不实现 replay。
- 不实现 handoff。
- 不实现 GraphOps apply。

## 任务

1. Take dynamic `PlanStep(source="supervisor")`。
2. Mark ready based on dependencies。
3. Dispatch via existing fixed dispatch wrapper:
   - `DispatchEnvelope`
   - `execute_core_v2_node()`
4. Write dispatch/step/decision result refs。
5. On worker failure, write normal failure ledger。
6. Use hermetic fake agents/tools only。

## 验收标准

- approved fake supervisor plan -> dynamic step -> fake worker output。
- worker executed through Core v2 dispatch evidence path。
- output/result store/artifact bundle written。
- invalid target still rejects before dispatch。
- no real external agent required。

## 建议测试

```bash
uv run pytest -q tests/integration tests/unit
uv run ruff check .
```

必须覆盖 fake E2E 和 worker failure。

## 完成后进入

`GOAL_08_SUPERVISOR_REPLAY.md`

