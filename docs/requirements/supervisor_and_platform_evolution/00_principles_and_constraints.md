# 00 — 第一性原理、护城河与约束

本文档定义本需求包的全局约束。所有阶段需求 **不得** 与本文冲突；冲突时以 [AGENTS.md](../../../AGENTS.md) 与 [CURRENT_ARCHITECTURE.md](../../CURRENT_ARCHITECTURE.md) 为准。

---

## 第一性原理（四条基本问题）

| 基本问题 | ACC 答案（必须保持） |
|----------|----------------------|
| 谁决定下一步 | **人** 固定 DAG；supervisor 仅产出**计划/提案**，不替代确定性执行引擎 |
| 控制流形态 | 静态 control edges + 可选数据-driven 展开（实例化节点，非涌现路由） |
| 数据流 | 显式 port / inbox / outbox / artifact；**sender 不写 receiver** |
| 复用单元 | 无状态 `AgentClassTemplate` / `ToolClassTemplate` / `WorkflowFunctionTemplate` |

借鉴来源：[04_synthesis §一、§二](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)。

---

## ACC 护城河（三条，选择性吸收时不得侵蚀）

### REQ-PRIN-001: 无状态可复用类为一等公民

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §二 |
| 阶段 | principles |
| 优先级 | P0（约束） |
| 依赖 | — |

**问题陈述**  
Supervisor 与多 backend 接入不应把 agent 变成带会话记忆的持久实体；复用必须指向 ClassTemplate，运行时证据进 ScopeFrame/SessionInstance。

**当前 ACC 现状**  
- `AgentClassTemplate` / `ToolClassTemplate`：`acc/domain.py:191-214`  
- `CallableRef` + `NodeInvocationSpec`：`acc/domain.py:174-288`  
- `CallableInvocationService` 按 `callable_ref` 解析：`acc/app/invocation.py:38-115`  
- 兼容层 `capsule_spec_to_callable_ref`：`acc/app/legacy_compat.py`

**目标行为**  
任何新能力（supervisor roster、adapter resume）均通过 **引用 template id** 实例化，不在 template 上持久化 run_dir、session、绝对路径。

**范围 / 非范围**  
- 范围：领域模型、registry、导出校验  
- 非范围：外部 agent 进程内部记忆（由外部 agent 自有，ACC 不建模为 template 状态）

**架构约束**  
模板无状态；`acc.domain` / `acc.engine` 无 IO。

**接口/数据契约草案**  
保持 `CallableRef{kind,id,version}`；禁止在 template JSON 增加 `last_run_id` 等字段。

**健壮性要求**  
导出/导入与 GraphOps patch 须拒绝含 run 证据的 template 变更（见 REQ-B5-002）。

**验收标准**  
- Given 含 `runs/` 绝对路径的 accflow 保存请求 When validate Then 拒绝  
- `test_import_boundaries` 持续通过

**风险与缓解**  
风险：supervisor 缓存对话 → 仅存 `ScopeFrame` 事件与 manifest，不写入 template。

---

### REQ-PRIN-002: 显式类型化数据流与 workspace 隔离

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §二、§四.4 |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | — |

**问题陈述**  
多 agent 协作的误用主要来自隐式共享状态；ACC 必须用 port 契约与 materialization 保证可重放、可审计。

**当前 ACC 现状**  
- `DataEdge` / `PortContract`：`acc/domain.py:32-79`  
- `WorkflowRunStore.materialize_data_edge`：`acc/store/__init__.py:197+`  
- `validate_callable_data_edges*`：`acc/engine/__init__.py:423-426,561+`

**目标行为**  
Supervisor 动态调用仍只通过 inbox/outbox/artifact 传数据；禁止「黑板」「共享 context 对象」类 API。

**范围 / 非范围**  
- 非范围：外部 agent 读自己 workspace 内文件（边界外）

**架构约束**  
`acc.store` 独占 inbox/outbox 物化；上游不得 `write` 下游 workspace。

**验收标准**  
- 现有 port/inbox 集成测试保持通过  
- 新 supervisor 路径无跨 node_dir 直接写文件的设计评审项

**风险与缓解**  
借鉴 Multica @mention 时须转为 **结构化 CallableRef + 物化**，非评论线程。

---

### REQ-PRIN-003: GraphOps 人审治理编排结构变更

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §二 |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | — |

**问题陈述**  
LLM 改图/改 capsule 若直接落盘，会破坏可审计性与安全策略；结构变更必须 proposal → validate → dry-run → approval → apply。

**当前 ACC 现状**  
- `acc/graphops.py`：`validate_patch_file`, `dry_run_patch`, `apply_patch_request`（MVP apply 需 `--human-approved`）  
- API：`acc/server/routes/graphops.py`  
- CLI：`acc/cli.py` graphops 子命令  
- 文档：`docs/concepts/GRAPHOPS_CONTROL_PLANE.md`  
- **缺口**：真实 apply 在 MVP 标注未完全实现（`graphops.py:137-138` 需确认）

**目标行为**  
Supervisor 产出的 `DynamicInvocationProposal` / 图变更同样走 GraphOps 或等价 run-scoped 提案通道，不得绕过。

**架构约束**  
默认 proposal；禁止 `remove_human_gate` 等操作（`acc/graphops.py:69-70`）。

**验收标准**  
- `tests/unit/test_graphops_patch_validation.py` 通过  
- Supervisor 相关 E2E 无「直接写 accflow」路径

**风险与缓解**  
需确认：GraphOps apply 生产就绪度 → 见 TRACEABILITY「需确认」项。

---

## 横切健壮性（贯穿所有 REQ）

### REQ-PRIN-004: Feature flag 与字节/行为兼容

| 属性 | 值 |
|------|-----|
| 来源 | P0 MIGRATION_NOTES |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | P0 callable |

**问题陈述**  
新路径必须可关闭，以免破坏现有 manifest 与 CI 基线。

**当前 ACC 现状**  
- `use_callable_dispatch()`：`acc/app/__init__.py:1053-1054`（`ACC_USE_CALLABLE_DISPATCH`）  
- `CallableInvocationService` 仅在 flag on：`acc/app/invocation.py:42-43`

**目标行为**  
所有本包新增运行时行为均有 env flag 或显式 opt-in；flag off 时与当前默认路径 manifest 字段兼容（additive-only 字段除外需文档化）。

**验收标准**  
- flag off：`uv run pytest -q` 全绿  
- flag on：callable 集成测试绿

---

### REQ-PRIN-005: Hermetic 默认测试

| 属性 | 值 |
|------|-----|
| 来源 | AGENTS.md 不变量 2 |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | — |

**当前 ACC 现状**  
`validate_clean_workflow_template(..., hermetic=True)` 默认拒绝 network：`acc/engine/__init__.py:327-333,392-393`

**目标行为**  
本包新增测试不得依赖真实 Codex/Claude/网络；外部 smoke 仅 opt-in。

**验收标准**  
默认 `pytest -q` 无外部依赖。

---

### REQ-PRIN-006: 分层边界

| 属性 | 值 |
|------|-----|
| 来源 | AGENTS.md 不变量 8 |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | — |

**当前 ACC 现状**  
`acc.engine` 纯函数校验；`acc.app` 协调；`web/` 非 runtime truth。

**目标行为**  
新 domain 类型在 `acc.domain`；调度队列在 `acc.store` 或 `acc.app`，不进入 `web/` 持久真相。

**验收标准**  
`test_import_boundaries`（若存在）不破。

---

### REQ-PRIN-007: 机器可读 stdout 契约

| 属性 | 值 |
|------|-----|
| 来源 | AGENTS.md 不变量 1 |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | — |

**目标行为**  
`acc run --emit-conductor-json` / `acc workflow run --emit-json` 仍只向 stdout 输出单一 JSON；日志走 stderr/文件。

**验收标准**  
现有 CLI 契约测试保持通过。

---

### REQ-PRIN-008: 轻量本地优先（无 DB）

| 属性 | 值 |
|------|-----|
| 来源 | AGENTS.md 不变量 4 |
| 阶段 | principles |
| 优先级 | P0 |
| 依赖 | — |

**目标行为**  
调度、交互、审计均落 **文件 manifest / jsonl**；不引入 Postgres/K8s/分布式 worker。

**验收标准**  
架构评审拒绝将 wakeup 队列定为 DB 优先方案。

---

## 非目标（「不要借鉴」→ 正式约束）

以下四条来自 [04_synthesis §四](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)，实现 **禁止** 违反。

### REQ-NONGOAL-001: 不引入 Paperclip 级重量级控制平面

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §四.1 |
| 阶段 | principles |
| 优先级 | P0（禁止） |
| 依赖 | REQ-PRIN-008 |

**问题陈述**  
Paperclip 的数十服务 + 嵌入式 Postgres + 372KB heartbeat 与 ACC「轻量本地优先」根本冲突。

**禁止行为**  
- 将 run 真相迁入数据库  
- 多服务 SaaS 化控制面  
- 以 DB 队列替代本地 manifest 队列（见 REQ-A4-001 的 **文件队列** 设计）

**允许**  
借鉴 **模式**（wakeup 单入口、coalesce、logRef），用 `runs/` + jsonl 实现。

**验收标准**  
设计评审清单：无新增 DB 依赖的 PR 一律拒绝。

---

### REQ-NONGOAL-002: 不采用有状态 agent 实体

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §四.2 |
| 阶段 | principles |
| 优先级 | P0（禁止） |
| 依赖 | REQ-PRIN-001 |

**禁止行为**  
- 持久化「Agent 实例」ORM 实体承载对话记忆  
- Template 与 Session 合并存储  

**允许**  
Multica/Paperclip 式 **Template/Skill 无状态附件**（见 REQ-B5-003）。

---

### REQ-NONGOAL-003: 不内联 agent、不共享内存/黑板数据流

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §四.3–4 |
| 阶段 | principles |
| 优先级 | P0（禁止） |
| 依赖 | REQ-PRIN-002 |

**禁止行为**  
- Conductor 式 workflow 内联 agent 定义（跨流程复制 prompt）  
- 共享 context / Jinja 全局黑板作为节点间主数据通道  
- Multica 评论黑板式触发

**允许**  
节点 `CallableOverride.prompt` 仅 invocation 作用域；类级 prompt 在 `AgentClassTemplate`。

---

### REQ-NONGOAL-004: 不用纯涌现式编排替代确定性骨架

| 属性 | 值 |
|------|-----|
| 来源 | 综合 §四.5 |
| 阶段 | principles |
| 优先级 | P0（禁止） |
| 依赖 | REQ-PRIN-003, REQ-A3-* |

**禁止行为**  
- Supervisor 每步自由选边、无 manifest 的随机路由  
- 无提案/无审计的图结构突变

**允许**  
LLM 产出 **SupervisorPlan / DynamicInvocationProposal** → 确定性引擎 + GraphOps 人审后执行（见 [03_phase_supervisor.md](03_phase_supervisor.md)）。

---

## 与路线图的关系

| 阶段文档 | 遵守的本页约束 |
|----------|----------------|
| 01 near | PRIN-004~008, NONGOAL-001 |
| 02 adapter | PRIN-001, 004 |
| 03 supervisor | PRIN-001~003, NONGOAL-002~004 |
| 04 scheduling | PRIN-008, NONGOAL-001 |
| 05 ux | PRIN-006~007 |
| 06 template | PRIN-001, NONGOAL-002 |
