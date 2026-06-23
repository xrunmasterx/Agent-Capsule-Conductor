# ACC Superpower Architecture Package

生成日期: 2026-06-21

本目录是基于当前代码与多智能体 workflow 深度剖析生成的 Superpower 风格项目文档包。它的目标不是继续堆叠功能，而是把 ACC 收敛回一个轻量、高性能、低耦合、可扩展的 agent 编排内核。

## 产品一句话

ACC 是本地优先的 agent/tool/workflow 编排运行时：它负责定义、调度、边界、显式数据传递、证据、投影和受治理的工作流变更；外部 agent 和工具负责自己的内部推理与执行。ACC 不实现自定义 LLM loop，也不教 agent 如何工作。

## 文档清单

| 文档 | 用途 |
| --- | --- |
| `SPEC.md` | 目标架构规范：使命、对象模型、不可变原则、边界、控制模式、数据流、性能约束。 |
| `DESIGN.md` | 高层设计：低耦合服务/端口拆分、运行时内核、控制模式、投影与 Workbench 边界。 |
| `FINDINGS.md` | 当前架构问题清单：不合理设计、冗余、低性能、状态泄漏和兼容债。 |
| `IMPLEMENTATION_ORDER.md` | 分阶段落地顺序：先文档/证明，再显式数据流、端口化、控制模式收敛、投影性能、删除兼容债。 |
| `TEST_PLAN.md` | 验证计划：单元、集成、架构静态检查、性能回归和 UI 投影契约。 |
| `ACCEPTANCE.md` | 验收标准：完成本架构收敛后必须满足的可观察条件。 |
| `MIGRATION_PLAN.md` | 从当前实现迁移到目标架构的路线图和删除条件。 |
| `RISK_REGISTER.md` | 风险登记：哪些改动可能破坏现有行为，如何缓解。 |
| `SECOND_PASS_CLEANUP_AUDIT.md` | 第二轮 ultracode 查漏补缺结论：当前架构过重的根因、delete-ready / migrate-then-delete / consolidate buckets。 |
| `LIGHTWEIGHT_REFACTOR_PLAN_PACK.md` | 后续 workflow 重构总索引：多个 Superpower 计划的执行顺序、第一性原理目标与开放决策。 |

## 与 active architecture docs 的关系

- `docs/architecture/*` 是长期架构权威。
- 本目录是 Superpower goal 包，用于指导重构执行、验收与问题收敛。
- 本包中的结论已同步拆分为 `docs/architecture/03-control-modes.md` 到 `08-architecture-proof-obligations.md`，用于补齐当前被 `AGENTS.md` / `README.md` 引用但缺失的 active architecture docs。

## Superpower Refactor Plans

后续如果使用 workflow 模式做删减重构，按 `LIGHTWEIGHT_REFACTOR_PLAN_PACK.md` 的顺序执行这些计划：

1. `docs/superpowers/plans/2026-06-21-p0-freeze-and-prove-cleanup.md`
2. `docs/superpowers/plans/2026-06-21-status-and-submission-canonicalization.md`
3. `docs/superpowers/plans/2026-06-21-explicit-dataflow-and-evidence.md`
4. `docs/superpowers/plans/2026-06-21-lightweight-runtime-kernel.md`
5. `docs/superpowers/plans/2026-06-21-invocation-and-adapter-harness.md`
6. `docs/superpowers/plans/2026-06-21-control-mode-scheduler-convergence.md`
7. `docs/superpowers/plans/2026-06-21-workbench-projection-storage-graphops-cleanup.md`

## 执行约束

1. 默认中文汇报，技术名保留英文。
2. 每个实现阶段必须先读 `AGENTS.md`、`docs/CURRENT_ARCHITECTURE.md`、相关 `docs/architecture/*.md` 与本目录对应文档。
3. 不恢复旧 runtime、旧 graph runner、隐藏 fallback 或兼容注册表。
4. 不新增 database、cloud backend、distributed worker、marketplace、SaaS surface 或团队权限系统作为核心执行前提。
5. 不实现自定义 LLM reasoning loop 或 tool-calling loop。
6. 默认测试 hermetic，不依赖真实 Claude/Codex/Cursor/Gemini、网络、浏览器凭证、云服务或付费服务。
7. 每次修复必须同步更新证据、测试和文档；不能只改代码不改契约，也不能只改契约不改行为。
