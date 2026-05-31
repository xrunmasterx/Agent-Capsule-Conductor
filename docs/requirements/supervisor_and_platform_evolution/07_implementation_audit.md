# 07 — 平台演进实现深度审计

> **审计日期**: 2026-05-29  
> **审计范围**: `docs/requirements/supervisor_and_platform_evolution/` 全部 43 条 REQ（principles 8 + near 8 + adapter 5 + supervisor 9 + scheduling 5 + ux 4 + template 4）  
> **对照基准**: [04_synthesis_vs_acc.md](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md) A1–A5 / B1–B5 借鉴清单  
> **方法**: 源码走读 + pytest/vitest 覆盖核对 + 负面场景推演（flag off、非法 intent、含 runs/ 的 bundle、重复 correlation_id）

---

## 1. 审计范围与方法

### 1.1 范围说明

| 阶段 | 需求组 | 实现状态 |
|------|--------|----------|
| principles | REQ-PRIN / REQ-NONGOAL | 架构约束维持；无新增 DB；import boundaries 绿 |
| 近期 | REQ-B4 / REQ-A5 / REQ-B1 | **已落地**（前一 agent + 本次验证） |
| adapter | REQ-A1-* | **已落地**（能力位 + adapter 协议 + manifest） |
| supervisor | REQ-A2/A3/B2 | **核心已落地**；GraphOps **apply** 仍为 MVP deferred |
| scheduling | REQ-A4-* | **队列/健康/恢复已落地**；ready-queue **未接入** workflow 主循环 |
| ux | REQ-B3-* | **已落地**（API + Workbench 卡）；human_gate **运行时映射** 部分 |
| template | REQ-B5-* | **已落地**（export/import + 纯净性） |

### 1.2 验收证据

- `uv run pytest -q`: **364 passed**
- `uv run ruff check .`: **All checks passed**
- `cd web && npm run test -- --run`: **48 passed**
- `tests/architecture/test_import_boundaries.py`: 通过（domain/engine 纯、store 无 engine 依赖等）

---

## 2. 逐条吸收度评分表

| 借鉴项 | 要求摘要 | ACC 实现证据 | 吸收度 | 差距与风险 |
|--------|----------|--------------|--------|------------|
| **A1** 统一 adapter 契约 | 能力位 + resume/stream hooks | `acc/domain.py:378-395` AgentCapabilities；`acc/adapters/base.py:78-87` AgentAdapter Protocol；`acc/adapters/capabilities.py:8-17` 默认能力；`acc/runner.py:159-209` 合并写入 manifest；`acc/schemas.py:40-46` yaml 映射 | **完全** | codex resume 仍抛 AccError（`acc/adapters/codex_cli.py:101-104`）；真实 resume 需 opt-in smoke |
| **A2** Supervisor 三件套 | roster + 结构化 intent + router | `acc/app/supervisor.py:41-57` roster；`acc/domain.py:421-428` DynamicInvocationIntent；`acc/app/supervisor.py:133-260` SupervisorRouter；`acc/engine/supervisor.py:34-101` 纯校验 | **部分** | 未接入 workflow 热路径自动唤醒；prompt 注入需 supervisor 节点显式调用 `render_supervisor_prompt` |
| **A3** LLM 只产计划 | SupervisorPlan + 确定性执行 | `acc/domain.py:430-437` SupervisorPlan；`acc/app/supervisor.py:268-305` execute_supervisor_plan；`acc/graphops.py:125-137` dry_run_supervisor_proposal | **部分** | GraphOps **apply** 仍 blocked（`acc/graphops.py:151-152`）；workflow runner 未自动消费 plan |
| **A4** 调度/活性/恢复 | 文件队列 + 健康 + L1-L3 | `acc/app/scheduler.py:19-21` ACC_USE_READY_QUEUE；`acc/app/scheduler.py:120-138` enqueue_wakeup + coalesce；`acc/app/scheduler.py:177-195` scan_session_health；`acc/app/scheduler.py:198-228` apply_recovery_level | **部分** | ready-queue **未替换** `run_workflow_template_instance` level-gather；L2 仅写 recovery_plan.json |
| **A5** 日志分层 | events 轻量 + logRef/excerpt | `acc/events.py` sanitize；`acc/app/run_projection.py:24-27` log_ref/log_excerpt/output_preview；`acc/run_index.py:197-225` index excerpt | **完全** | transcript_ref 仍为 P2 扩展 |
| **B1** 渐进披露 | Inspector 三层 + API 投影 | `acc/app/run_projection.py:24-87`；`web/src/components/WorkflowViewer.tsx:3145-3148` output_preview；`tests/server/test_runs_projection_api.py` | **完全** | 原始 stdout 仍可通过 artifact API 拉全量 |
| **B2** 决策审计 | supervisor_decision 事件 | `acc/app/supervisor.py:241-260` emit_decision；`acc/engine/supervisor.py:107-131` action/no_action/failed 语义 | **部分** | 依赖 supervisor 路径显式调用；普通 DAG 节点无强制 decision |
| **B3** human-in-the-loop | InteractionRequest + UI | `acc/domain.py:469-482`；`acc/server/routes/interactions.py`；`web/src/components/InteractionPanel.tsx` | **部分** | `human_gate` YAML 节点未自动映射（`acc/app/interactions.py:119-131` 仅 helper） |
| **B4** 强校验 dry-run | 提交期校验 + CLI/API | `acc/engine/workflow_validation.py:81-142`；`acc/app/__init__.py:1104-1110` ACC_ENABLE_SUBMIT_VALIDATE；CLI `workflow validate --dry-run` | **完全** | strict port 类型仍为 warn 默认 |
| **B5** 模板可移植 | export/import bundle | `acc/app/template_bundle.py:49-109` export；`acc/app/template_bundle.py:111-188` import；`acc/cli.py:926-975` CLI | **完全** | secret scan 为路径/字段 denylist，非 ML |

---

## 3. 健壮性评估（1–5 分）

| 维度 | 分数 | 说明 |
|------|------|------|
| 分层边界 | **5** | domain/engine 无 IO；supervisor 校验在 engine；app 协调 store/runtime；import boundaries 测试通过 |
| feature flag 与向后兼容 | **5** | `ACC_USE_CALLABLE_DISPATCH` / `ACC_ENABLE_SUPERVISOR` / `ACC_USE_READY_QUEUE` / `ACC_ENABLE_SUBMIT_VALIDATE` 均默认 off；flag off 路径测试保留 |
| 失败模式与错误语义 | **4** | AccError 贯穿 adapter resume、intent 校验、import 纯净性；校验错误不重试；GraphOps apply 明确拒绝 |
| 幂等/去重/防环 | **4** | `supervisor_state.json` correlation_id + repeat_counts（`acc/app/supervisor.py:151-201`）；interaction answer 幂等（`acc/app/interactions.py:96-98`） |
| 可观测性 | **4** | supervisor_decision、interaction_answered、capabilities_effective 写入 events/manifest；plan 落盘 `runs/<id>/supervisor_plans/` |
| 安全 | **4** | template import 拒绝 `runs/`、绝对路径、zip 路径遍历；workspace 隔离未改；sender 不写 receiver 不变量保持 |
| 性能 | **4** | log excerpt 限 2048B；events payload sanitize；artifact 仍按需物化 |
| 测试覆盖 | **4** | 新增 24 条 focused tests；**缺口**: 端到端 supervisor+fake LLM plan 执行；ready-queue 与 workflow 集成；human_gate E2E |

### 测试 Gap 列表

1. `execute_supervisor_plan` 与真实 `CallableInvocationService` fake agent 的完整 E2E
2. `ACC_USE_READY_QUEUE=1` 下 workflow 运行与 level-gather 行为对比
3. `human_gate` 节点 → InteractionRequest 自动创建
4. GraphOps apply 实现后的 A3-002 回归

---

## 4. 护城河是否守住

| 护城河 | 证据 | 结论 |
|--------|------|------|
| 无状态 ClassTemplate | `AgentClassTemplate` 无 run_dir/session 字段（`acc/domain.py:191-202`）；export 拒绝 session 字段（`acc/app/template_bundle.py:18-25`） | **守住** |
| 显式 port/inbox/outbox | 未修改 data edge / store 物化路径；supervisor intent 仍经 CallableInvocationService | **守住** |
| GraphOps 治理 | proposal 仅 dry-run（`acc/graphops.py:125-137`）；apply 需 `--human-approved` 且 MVP 未实现 | **守住** |
| 轻量无 DB | wakeup/interaction/plan 均为 `runs/` 下 json/jsonl（`acc/app/scheduler.py:23-28`） | **守住** |

---

## 5. 非目标是否违反

| 非目标 | 检查 | 结论 |
|--------|------|------|
| 无重量级控制面 | 无 Postgres/heartbeat 服务；仅 jsonl 队列 | **未违反** |
| 无有状态 agent 实体 | SupervisorRoster 为 registry 只读投影；无 agent 持久实体表 | **未违反** |
| 无黑板/内联 agent | intent 必须指向 registry 已知 CallableRef | **未违反** |
| 无纯涌现编排 | 执行段 `execute_supervisor_plan` 不调用 LLM；dedupe/depth 限制 | **未违反** |

---

## 6. 总体结论

ACC **已在架构层吸收三方案核心优势的可迁移部分**：A1 能力位、B4 强校验、A5/B1 可观测、A2/A3/B2 supervisor 栈（feature-flag 后）、A4 文件队列与恢复语义、B3 交互原语、B5 模板 bundle。四条护城河与非目标均未被侵蚀。

**尚未完全吸收的部分（诚实标注）**：

- **P0 技术债**: GraphOps real apply（阻塞 A3-002 生产闭环）
- **P1**: ready-queue 接入 workflow 主调度循环（A4-002）；supervisor 热路径 wiring（A2-004 与 workflow 节点 kind）
- **P2**: human_gate 运行时统一（B3-004）；codex resume 真实 smoke

**是否可以说「已吸收三架构优势」**：在 **local-first、callable-first、GraphOps-governed** 前提下，**可以**说 ACC 已吸收对比研究中 **工程可迁移** 的优势；**不能**说已等价 Multica 涌现编排或 Paperclip 全控制面——这符合非目标设计。

**建议下一步**：

1. 在 `ACC_ENABLE_SUPERVISOR=1` + fake supervisor capsule 下补 E2E：plan → approve → execute → supervisor_decision 审计链
2. `ACC_USE_READY_QUEUE=1` 分支接入 `run_workflow_template_instance`，保留 flag off 回归
3. GraphOps apply MVP 或明确长期 deferred 并更新 TRACEABILITY
4. `human_gate` metadata → `create_human_gate_interaction` 挂接 `execute_app_clean_node`

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-05-29 | 初版：基于阶段 1–6 实现与 364 pytest / 48 vitest 证据 |
