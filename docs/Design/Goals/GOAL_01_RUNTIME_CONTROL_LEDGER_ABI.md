# Goal 01: Runtime Control Ledger ABI

## 一句话目标

落地 Runtime Control Ledger 的 domain/engine/store 地基: schema、validator、JSON/JSONL
reader-writer、projection loader 和新增 control event ABI。**不修改 runtime hot path**。

## 第一性原理

后续 fixed/supervisor/handoff/human gate 的共同问题是: 谁决定下一步、下一步是什么、为什么这样做、如何审计和 replay。先定义事实结构和读取规则, 再接执行路径。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/CONTROL_ARCHITECTURE_GAP_REVIEW.md`
- `docs/Design/README.md`
- `docs/Design/01_RUNTIME_CONTROL_LEDGER.md`
- `docs/Design/Goals/README.md`
- 本文件

## 允许修改

- `acc/domain.py`
- `acc/engine/*` 中新增或最小修改 control ledger validator 模块
- `acc/store/*` 中新增 control ledger reader/writer/projection helper
- focused unit tests
- 与本 goal 事实直接相关的 docs

## 禁止修改

- 不修改 `run_workflow_function_invocation()`、`execute_core_v2_node()`、`WorkflowAppService.run()`。
- 不新增或修改 server route。
- 不修改 `web/`。
- 不新增 `workflow_events.jsonl` writer。
- 不把 `/api/decisions` 改成 runtime truth。
- 不引入外部依赖、数据库、云队列或真实外部 agent 调用。

## 任务

1. 定义最小模型:
   - `ControlPolicy`
   - `RunPlan`
   - `PlanStep`
   - `DispatchEnvelope`
   - `DecisionRecord`
   - `ReplayPolicy`
   - 对应 status/kind/source/mode Literal。
2. 实现 payload serialization、parser、validator。
3. parser 默认拒绝未知顶层字段; `metadata` 不能承载执行语义。
4. 定义 `plan_steps.jsonl` 和 `dispatches.jsonl` transition record:
   - `sequence` 在单个 JSONL 文件内单调递增且唯一。
   - 每行包含 `recorded_at`、`previous_status`、`next_status`、`snapshot`、`reason`。
   - `snapshot` 是当前完整视图。
5. 实现 latest-state projection loader:
   - `load_run_plan()`
   - `load_plan_steps()`
   - `load_dispatches()`
   - `load_decisions()`
6. missing ledger files 返回 empty/warnings, 不伪造 truth。
7. 实现新增 control ledger event canonical writer:
   - `event_id`
   - `type`
   - `timestamp`
   - `run_id`
   - optional refs: `scope_frame_id`、`node_id`、`session_id`、`plan_step_id`、`dispatch_id`、`decision_id`
   - `payload`
8. 不迁移现有历史 event writer, 只隔离新增 control event writer。

## 验收标准

- 新模型和 validator 可通过 focused tests 验证。
- latest-state loader 可从 transition JSONL 得到最终状态。
- duplicate sequence reject。
- invalid status transition reject。
- `DecisionRecord` 缺 `decision_id/run_id/actor/kind/input_evidence_refs` reject。
- 新增 control event 只走 canonical writer。
- 不修改 runtime hot path。
- 不新增 server route。
- 不修改 `web/`。

## 建议测试

```bash
uv run pytest -q tests/unit/test_control_ledger_domain.py tests/unit/test_control_ledger_store.py
uv run ruff check .
```

如果实际测试文件名不同, 运行最小 focused tests, 并在汇报中写清楚。

## 完成后进入

`GOAL_02_FIXED_RUNPLAN_DISPATCH.md`

