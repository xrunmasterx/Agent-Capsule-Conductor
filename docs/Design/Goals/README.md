# ACC Control Architecture Goal Package

生成日期: 2026-06-03

本目录把 `docs/Design/*.md` 拆成 10 个可以按 goal 模式顺序执行的实现目标。

核心原则: 每个 goal 只推进一个明确的控制面能力, 完成后必须有 focused verification。不要把
runtime、API、Workbench、supervisor、handoff、GraphOps 混在同一个 goal 里。

## 执行顺序

| 顺序 | Goal | 对应 design | 本质目标 |
| --- | --- | --- | --- |
| 1 | `GOAL_01_RUNTIME_CONTROL_LEDGER_ABI.md` | `01_RUNTIME_CONTROL_LEDGER.md` | 建立控制账本 ABI、validator、store reader/writer, 不改 runtime hot path。 |
| 2 | `GOAL_02_FIXED_RUNPLAN_DISPATCH.md` | `02_FIXED_RUNPLAN_DISPATCH.md` | 让 fixed workflow 写 `RunPlan` / `PlanStep` / `DispatchEnvelope` / `DecisionRecord`, 保持输出等价。 |
| 3 | `GOAL_03_FIXED_ONLY_PROJECTION.md` | `07_API_WORKBENCH_PROJECTION.md` | 为 fixed ledger 提供只读 API/app projection, Workbench 只做最小 fixed-only 展示。 |
| 4 | `GOAL_04_RUN_WAIT_RESUME_LIFECYCLE.md` | `03_RUN_WAIT_RESUME_LIFECYCLE.md` | 建立 non-destructive wait/resume 生命周期。 |
| 5 | `GOAL_05_HUMAN_GATE_BARRIER.md` | `04_HUMAN_GATE_BARRIER.md` | 让 human gate 成为 runtime barrier, answer 后写 approval decision 并恢复。 |
| 6 | `GOAL_06_SUPERVISOR_PLANSTEP_P0.md` | `05_SUPERVISOR_PLANSTEP.md` | Supervisor P0: approved plan 编译成 steps/decisions, 不执行 worker。 |
| 7 | `GOAL_07_SUPERVISOR_DISPATCH_INTEGRATION.md` | `05_SUPERVISOR_PLANSTEP.md` | Supervisor P1: dynamic steps 接入 Core v2 dispatch, fake E2E。 |
| 8 | `GOAL_08_SUPERVISOR_REPLAY.md` | `05_SUPERVISOR_PLANSTEP.md` | Supervisor replay: 复用 recorded decisions, 不重新问 LLM。 |
| 9 | `GOAL_09_HANDOFF_P0.md` | `06_HANDOFF_SEMANTICS.md` | Handoff P0: typed validation + `new_session` / `route_only`。 |
| 10 | `GOAL_10_GRAPHOPS_GOVERNANCE_OPTION_A.md` | `08_GRAPHOPS_GOVERNANCE.md` | GraphOps Option A: 明确 proposal/dry-run only, runtime dispatch 不走 GraphOps。 |

## 总控 Prompt

把 `MASTER_GOAL_PROMPT.md` 里的完整 prompt 设为 Codex 的 goal。它会要求 Codex 按上表顺序:

1. 执行一个 goal。
2. 跑该 goal 的 focused tests。
3. 更新 `PROGRESS.md`。
4. 只有验证通过才进入下一个 goal。
5. 如果被阻塞或测试失败, 停止并汇报。

## 全局硬约束

- 默认中文汇报, 技术名保留英文。
- 每个 goal 开始前必须读 `AGENTS.md`、`docs/CURRENT_ARCHITECTURE.md`、对应 design 和对应 goal 文件。
- 每个 goal 开始前必须 `git status --short`。
- 只改当前 goal 直接需要的文件。
- 不回滚用户已有改动。
- 不实现自定义 LLM loop。
- 不做三套 runtime。
- 不把 Workbench localStorage / SSE / `/api/decisions` 当 runtime truth。
- 不把 GraphOps 放入 runtime dispatch。
- 默认测试 hermetic。

