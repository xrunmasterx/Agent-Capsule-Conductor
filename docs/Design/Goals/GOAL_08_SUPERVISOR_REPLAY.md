# Goal 08: Supervisor Replay

## 一句话目标

Supervisor replay 使用 recorded `DecisionRecord` 和 dynamic steps, 不重新问 LLM、不重新 parse
随机 output。

## 第一性原理

动态控制的 replay 必须复用历史决策, 否则 replay 会变成“重新随机跑一次”。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/01_RUNTIME_CONTROL_LEDGER.md`
- `docs/Design/05_SUPERVISOR_PLANSTEP.md`
- 本文件

## 前置条件

Goal 07 completed, supervisor dynamic dispatch 已可跑。

## 允许修改

- replay policy/helper
- debugger/app replay projection
- focused replay tests

## 禁止修改

- 不重新问 LLM。
- 不重新解析 supervisor LLM output。
- 不重新征求人审。
- 不实现 handoff replay。
- 不实现 GraphOps apply replay。

## 任务

1. Implement supervisor replay mode:
   - load historical `DecisionRecord(kind="supervisor_plan")`。
   - reconstruct selected dynamic steps。
   - validate template/run snapshot compatibility。
2. If historical decision missing or incompatible, replay fails explicitly。
3. Mock supervisor parser/LLM in tests and assert not called。
4. Expose replay evidence through existing debugger/projection boundary if needed。

## 验收标准

- Replay supervisor run reuses recorded decisions。
- Supervisor parser/LLM not called。
- Missing decision fails explicitly。
- Incompatible snapshot fails explicitly。
- GraphOps proposal replay is dry-run evidence only, no apply。

## 建议测试

```bash
uv run pytest -q tests/unit tests/integration
uv run ruff check .
```

必须包含 mock assertion: supervisor parser/LLM not called。

## 完成后进入

`GOAL_09_HANDOFF_P0.md`

