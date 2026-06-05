# Master Goal Prompt

将下面整段 prompt 设为 Codex 的 goal。

```text
目标：按顺序完整落地 ACC Control Architecture Goal Package 中的 10 个 goals。每完成一个 goal，必须运行该 goal 要求的 focused verification，更新 F:\Agent-Capsule-Conductor\docs\Design\Goals\PROGRESS.md，然后只有在 verification 通过时才进入下一个 goal。如果任一 goal 阻塞、测试失败或发现当前设计与代码事实冲突，必须停止连续执行，记录证据并汇报，不要硬推进后续 goal。

工作目录：
F:\Agent-Capsule-Conductor

总控文件：
- F:\Agent-Capsule-Conductor\AGENTS.md
- F:\Agent-Capsule-Conductor\docs\CURRENT_ARCHITECTURE.md
- F:\Agent-Capsule-Conductor\docs\CONTROL_ARCHITECTURE_GAP_REVIEW.md
- F:\Agent-Capsule-Conductor\docs\Design\README.md
- F:\Agent-Capsule-Conductor\docs\Design\Goals\README.md
- F:\Agent-Capsule-Conductor\docs\Design\Goals\PROGRESS.md

按顺序执行这些 goal 文件：
1. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_01_RUNTIME_CONTROL_LEDGER_ABI.md
2. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_02_FIXED_RUNPLAN_DISPATCH.md
3. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_03_FIXED_ONLY_PROJECTION.md
4. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_04_RUN_WAIT_RESUME_LIFECYCLE.md
5. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_05_HUMAN_GATE_BARRIER.md
6. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_06_SUPERVISOR_PLANSTEP_P0.md
7. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_07_SUPERVISOR_DISPATCH_INTEGRATION.md
8. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_08_SUPERVISOR_REPLAY.md
9. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_09_HANDOFF_P0.md
10. F:\Agent-Capsule-Conductor\docs\Design\Goals\GOAL_10_GRAPHOPS_GOVERNANCE_OPTION_A.md

全局硬约束：
- 默认中文汇报，代码/API/类型名/函数名/文件名/命令保留英文。
- 每个 goal 开始前必须运行 git status --short，并识别已有未提交/未跟踪变更。
- 只改当前 goal 直接需要的文件，不回滚用户已有改动。
- 每个 goal 都要先读对应 goal 文件和对应 design 文档。
- 不实现自定义 LLM loop。
- 不做 fixed / supervisor / handoff 三套 runtime。
- Core v2 callable execution substrate 仍是生产执行路径。
- 不扩大 CallableInvocationService 成生产执行器。
- 不把 WorkbenchRunManager 变成 durable scheduler truth。
- 不把 Workbench localStorage、SSE chunk、canvas status 或 /api/decisions 当 runtime truth。
- 不把 GraphOps 放进 runtime dispatch/handoff 主链。
- 不引入数据库、云队列、分布式 worker、云后端或新外部依赖，除非某个 goal 明确要求且经过当前架构约束允许。
- 默认 tests 必须 hermetic，不依赖真实 Codex/Claude/Cursor/Gemini、网络、浏览器凭证或付费服务。
- 不声称运行了未实际运行的测试。

每个 goal 的执行协议：
1. 将 PROGRESS.md 中当前 goal 标记为 in_progress。
2. 阅读当前 goal 文件、对应 docs/Design 文件、AGENTS.md、docs/CURRENT_ARCHITECTURE.md。
3. 用 rg / rg --files 检查当前实现，确认代码事实。
4. 制定最小修改路径，只改当前 goal 范围内的文件。
5. 实现当前 goal。
6. 运行当前 goal 要求的 focused verification。
7. 如果 verification 失败，修复本 goal 范围内的问题并重跑；如果无法修复，标记 failed 或 blocked，停止后续 goal。
8. verification 通过后，将 PROGRESS.md 当前 goal 标记为 completed，并记录实际验证命令。
9. 进入下一个 goal。

跨 goal 规则：
- 不提前实现后续 goal 的能力。例如 Goal 1 不接 runtime hot path；Goal 6 不执行 supervisor worker；Goal 9 不实现 resume_session/timeout/fallback/replay。
- 如果为了当前 goal 必须触碰后续 design 的内容，先停下来汇报原因，不要自行扩大范围。
- 如果发现 goal 文档和当前代码事实冲突，以代码事实和 AGENTS.md 当前 contract 为准，并最小更新 goal/design 文档说明冲突。
- 如果工作树中有 unrelated user changes，忽略它们；如果它们影响当前 goal，和它们协作，不要回滚。

最终完成全部 10 个 goals 后：
1. 运行 full regression：
   uv run pytest -q
   uv run ruff check .
   如果 web/ 有变更：
     cd web
     npm run test -- --run
     npm run build
2. 更新 PROGRESS.md 所有 goal 为 completed。
3. 汇报：
   - 每个 goal 的完成状态。
   - 每个 goal 改了哪些核心文件。
   - 运行了哪些测试及结果。
   - 哪些风险仍然 deferred。
   - 是否仍有未提交变更，以及哪些是本轮新增/修改。
```

