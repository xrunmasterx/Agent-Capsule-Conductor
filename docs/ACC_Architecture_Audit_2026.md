# ACC v2 架构深度审计报告

> 审计日期：2026-06-10  
> 审计方法：15 agent 并行扫描 + 3 agent 深度验证 + 人工源码验证  
> 代码基线：commit 0aece8d (dev_v2 branch)  
> 代码规模：~28K 行 Python + ~24K 行 TypeScript（不含测试和 legacy docs）  
> 验证状态：✅ 所有 Critical/High 结论已二次验证

---

## 执行摘要

| 维度 | 评分 (1-10) | 关键结论 |
|------|:-----------:|----------|
| 架构健壮性 | 5/10 | 状态机非形式化、控制账本过度工程化、大量代码重复 |
| 用户体验 | 3/10 | WorkflowViewer 17K 行巨石组件、交互功能缺失、暴露内部实现 |
| 设计原则 | 4/10 | God Module 问题严重、关注点混合、偶然复杂度高、广泛函数重复 |
| 前端工程 | 3/10 | 无模块化 CSS、i18n 覆盖 <20%、无障碍缺失、测试覆盖极低 |
| **综合健康度** | **4/10** | 核心执行引擎可用但偶然复杂度远超本质复杂度 |

### 最紧迫的 3 个问题

1. **`WorkflowViewer.tsx` (17,521 行) 是史诗级巨石组件** — 包含 80+ 函数、全部 canvas 状态管理、SSE 流、authoring 逻辑、多个子组件内联定义。任何改动都触发完整 re-parse，多人协作必然冲突
2. **`core_v2_runtime.py` (2,422 行) 是 God Module** — 混合了控制账本管理、节点执行、payload 解析、文件 I/O、三个 75-80% 相同的 dispatch 函数
3. **7+ 套状态机全部是字符串 Literal，运行时无转换守卫** — `transition_step()` 不检查转换合法性，codec 层的 `PLAN_STEP_TRANSITIONS` 仅在加载时验证

---

## 产品决策与重构约束（2026-06-11 确认）

### 产品定位

| 维度 | 决策 |
|------|------|
| 目标用户 | 有技术基础的用户，通过提示词驱动工作流，不需要写代码 |
| 信息展示 | 不需要呈现复杂调试信息 |
| 目标市场 | 面向中国用户（UI zh-CN，底层 English） |
| 部署形态 | 单用户本地部署，未来打包为 exe |

### 功能范围决策

| 功能 | 决策 | 说明 |
|------|------|------|
| Workflow DAG | **当前核心** | 主要使用模式 |
| Supervisor/Handoff dispatch | 暂不实现，保留接口定义 | 后续作为新功能增加 |
| Control Ledger | 降级为 verbose/可选 | 用户不看，AI 助手可读取辅助排查问题 |
| Hermetic mode | 最轻量快速验证用途 | 用户聚焦联网真实 agent 模式 |
| 历史数据 | **全量删除** | 旧架构数据无用，已有 git 备份 |
| 未使用的内联组件 | 拆分时一并删除 | 减少代码量 |

### 技术架构决策

| 决策点 | 选择 | 理由 |
|-------|------|------|
| domain.py 拆分 | 一次性大规模 import 重写 | 配合测试用例保障，不保留旧路径兼容 |
| 状态机模式 | **严格模式**（非法转换 raise） | ACC 内部管理，用户不感知，正常定义不应出现阻塞 |
| ControlLedger 架构 | **三层分离** | Layer 1: Immutable domain records (RunPlan/PlanStep/DispatchEnvelope/DecisionRecord/TransitionRecord); Layer 2: Mutable writer (FixedRunControlLedgerWriter); Layer 3: Pure transition helpers — `transition_plan_step(current, next_status, context) -> (TransitionRecord, updated_PlanStep)` |
| GraphOps | **统一为单一 API** | 内部支持多种 typed operation handler (create_agent_class/update_workflow_graph/create_workflow/delete_node 等)；用户/API/审计只认一个 GraphOps |
| LLM 输出类型 | 保留 `[key: string]: unknown` | 成熟 API 用强类型，LLM 开放性输出保留灵活性 |
| 前端状态管理 | 结合架构推荐最优方案 | 要求：高性能、健壮性高 |
| i18n | 底层 English + UI 层 zh-CN 转译 | 代码健壮性 + 中国用户友好 |
| 测试策略 | 重构时同步补关键路径测试 | 平衡速度和安全 |
| 分支策略 | 每完成一个 feature 自行 commit + push | 无 CI 管线，dev_v2 分支 |

### 详细重构计划

各 feature 详细计划文档见 `docs/refactoring-plan/` 目录。

---

## 一、架构健壮性分析

### 1.1 状态机审计

#### 发现的状态机

| # | 状态机名称 | 定义位置 | 状态数 | 形式化程度 |
|---|-----------|---------|:------:|-----------|
| 1 | RuntimeStatus | `domain.py:32-45` | 12 | Literal 类型，无转换表 |
| 2 | PlanStepStatus | `domain.py:475-485` | 9 | Literal 类型，codec 中有部分转换表 |
| 3 | DispatchStatus | `domain.py:486` | 5 | Literal 类型，codec 中有部分转换表 |
| 4 | RunPlanStatus | `domain.py:473` | 5 | Literal 类型，无转换表 |
| 5 | Run Status (lifecycle) | `run_lifecycle.py:20-31` | ~10 | frozenset 分组，无转换表 |
| 6 | InteractionStatus | `domain.py:752` | 4 | Literal 类型 |
| 7 | SupervisorPlanStatus | `domain.py:753` | 5 | Literal 类型 |
| 8 | HandoffAcceptanceStatus | `domain.py:504-509` | 5 | Literal 类型 |
| 9 | SessionHealth | `domain.py:755` | 4 | Literal 类型 |

#### 核心问题

**P1: 无形式化转换矩阵**

状态转换通过 `dataclasses.replace(step, status="ready")` 实现（`core_v2_runtime.py:148`, `core_v2_runtime.py:472`），本质上是字符串替换。唯一的"校验"是 `control_ledger_codec.py` 中的 `PLAN_STEP_TRANSITIONS` 和 `DISPATCH_TRANSITIONS` 字典，但这些仅在 codec 层验证，运行时的 `FixedRunControlLedger.transition_step()` **不检查转换合法性**。

```
证据: core_v2_runtime.py:460-497 — transition_step 直接 replace status，无 guard
```

**P2: 多状态机交互无同步协议**

`PlanStepStatus`、`DispatchStatus`、`RunStatus` 三者存在隐式依赖关系（dispatch 完成 → step 成功 → run 可能完成），但没有任何形式化的跨状态机一致性验证。唯一的保护是 `asyncio.Lock`（`audit_lock`），这只防竞态，不防逻辑错误。

**P3: "幽灵状态"问题**

Run 状态的 "resuming" 状态（`run_lifecycle.py:24`）既不是终态也不是活跃态，它是一个过渡态，但没有超时保护。如果 resume 过程崩溃，run 会永久停留在 "resuming" 状态。

#### 转换完整性缺口

- `PlanStepStatus` 允许 "pending" → "ready" → "waiting_interaction" → "ready"（loop），但无 loop 检测
- `DispatchStatus` 缺少 "started" → "cancelled" 的直接转换路径（需要先 fail？）
- Run 从 "waiting_interaction" 恢复时，先到 "resuming"，但 "resuming" → "running" 的转换在哪里？（在下一次 ready queue 循环隐式发生，没有显式转换记录）

### 1.2 技术债务盘点

| 债务类型 | 位置 | 规模 | 说明 |
|---------|------|------|------|
| V2 Binding 死代码 | `domain.py:837-886` | ~50 行 | 注释明确写 "No current product runtime resolver consumes these V2 shapes" |
| graphops 版本共存 | `acc/graphops.py` + `acc/app/graphops_v3.py` | 353+776 行 | v3 仍 import 旧 graphops 的函数 |
| Legacy graph 兼容 | `core_v2_loader.py`, `cli.py` | ~60 行 | 拒绝 legacy graph 的代码仍存在 |
| Legacy codex event | `codex_app_server.py:424,504` | ~80 行 | `handle_legacy_codex_event` 方法 |
| Phase 1 skeleton | `binding/__init__.py:1`, `binding/selector.py:4` | 33 行 | "Phase 1 skeleton only" — 占位代码 |
| ports 模块 | `acc/ports/__init__.py` | 5 行 | 空壳模块 |
| migration 模块 | `acc/migration/__init__.py` | 2 行 | 空壳 |

**总估计可删除代码量：~600-800 行**

#### v1→v2 迁移完成度

迁移约 80% 完成。残留物：
- `graphops.py` 的 helper 函数仍被 v3 依赖（`contains_policy_value`, `validate_relative_path` 等）
- CLI 仍包含 `legacy_graph_to_accflow_payload` 转换逻辑
- `workbench_adapter.py:928` 有 `ports_from_legacy_fields` 函数
- 架构测试 `test_phase1_import_boundaries.py` 暗示分阶段迁移未彻底完成

### 1.3 代码冗余分析

#### Critical: 三函数近乎复制

`core_v2_runtime.py` 中以下三个函数结构几乎完全相同（差异不超过 10 行）：

| 函数 | 行数 | 位置 |
|------|:----:|------|
| `resume_approved_human_gate_dispatch` | 100 | L924-1027 |
| `dispatch_ready_supervisor_plan_steps` | 100 | L1029-1133 |
| `dispatch_ready_handoff_plan_steps` | 100 | L1135-1239 |

这三个函数共享相同的模式：load state → build control ledger → execute steps → finalize → write results。差异包括：step 筛选逻辑（human gate 按 interaction_id / supervisor 用 `_ready_supervisor_steps()` / handoff 用 `_ready_handoff_steps()`）、动态节点构造方式、函数签名（human gate 多一个 `interaction_id` 参数）。**结构重复度约 75-80%，~180 行可通过提取公共基函数消除。**

#### High: domain.py 混合职责

`domain.py`（1411 行）同时包含：
- 62 个 frozen dataclass 定义（纯领域模型）
- 序列化函数（`workflow_function_template_to_dict`, `_to_jsonable` 等）
- 反序列化函数（`workflow_function_template_from_dict`, `_node_invocation_from_dict` 等）
- 验证函数（`validate_core_v2_*` 系列）
- 辅助函数（`_required_string`, `_dict_or_empty` 等）

应拆分为：`domain.py`（纯模型） + `serialization.py` + `validation.py`

#### Medium: run_projection 重复

`acc/app/run_projection.py` 和 `acc/server/run_projection.py` 并存，命名暗示功能重叠。

### 1.4 底层架构替代方案

#### 当前方案的本质复杂度 vs 偶然复杂度

**本质复杂度**（agent 编排系统不可避免的）：
1. DAG 定义和调度（~200 行）
2. 节点执行与适配器调用（~300 行）
3. 数据在节点间传递（~100 行）
4. 状态持久化（~150 行）
5. Human-in-the-loop 暂停/恢复（~200 行）

**合理估计本质代码量：~1000 行**

**当前实际代码量：~28000 行（Python 部分）**

**偶然复杂度比 ≈ 28:1** — 这意味着每 1 行本质逻辑附带了 27 行脚手架。

#### 偶然复杂度来源

| 来源 | 估计行数 | 根因 |
|------|:--------:|------|
| 控制账本系统 | ~3000 | 为固定 DAG 引入了事件溯源级别的审计基础设施 |
| 多模式 dispatch (supervisor/handoff/fixed) | ~2000 | 三种模式共享 90% 逻辑但完全复制 |
| 序列化/反序列化 | ~1500 | 手写 dict↔dataclass 转换，无 Pydantic |
| 细粒度 dataclass 分解 | ~1000 | 50+ frozen dataclass 中许多只在一处使用 |
| 验证层 | ~800 | 手写校验逻辑而非声明式 schema |

#### 轻量替代方案

**方案 A：事件溯源统一状态模型**

用单一 `EventStore` + 投影替代当前分散的 JSONL 文件：
- 优点：状态机只需一个，所有状态都是事件的投影
- 缺点：需要引入事件总线，改造范围大
- 迁移成本：**Epic**（3-4 周）

**方案 B：简化 DAG 执行器（推荐）**

砍掉控制账本，保留核心执行循环：
```
while nodes_pending:
    ready = scheduler.next_batch()
    results = await asyncio.gather(*[run_node(n) for n in ready])
    update_state(results)
```
- 优点：代码量可减少 60%，复杂度大幅降低
- 缺点：失去审计追溯能力（但可通过简单 event log 恢复）
- 迁移成本：**Large**（2 周）

**方案 C：Actor 模型**

每个节点是一个 Actor，通过消息传递数据：
- 优点：天然并发，状态隔离
- 缺点：调试困难，Python 生态不成熟
- 迁移成本：**Epic**（4+ 周）

---

## 二、用户体验分析

### 2.1 信息层级审计

#### 三分类表

| 分类 | 内容 | 当前状态 |
|------|------|---------|
| **必须展示** | Workflow 图形视图、节点执行状态（成功/失败/等待）、人类审批入口、最终输出/artifacts | ✅ 已展示 |
| **可以折叠** | 节点详细日志、输入/输出 JSON、callable 浏览器、运行历史列表 | ⚠️ 直接平铺展示 |
| **应该隐藏** | Control Plane 面板、Control Ledger 事件、Dispatch 记录、PlanStep 转换序列号、scope_frame_id、correlation_id | ❌ 直接暴露给用户 |

#### 需要"翻译"的术语

| 内部术语 | 用户友好翻译 |
|---------|------------|
| PlanStep | 执行步骤 |
| DispatchEnvelope | 任务分配 |
| ControlLedger | 执行记录 |
| ScopeFrame | 执行环境 |
| CallableRef | Agent/工具引用 |
| waiting_interaction | 等待你的确认 |
| human_gate | 人工审批点 |
| artifact_bundle | 输出文件包 |

### 2.2 布局与导航

当前导航结构（6 个 tab）：

```
[任务] [资源] [运行记录] [Artifacts] [决策] [控制面板]
```

**问题**：
1. "控制面板" 是纯开发者调试面板，不应对终端用户可见
2. "决策" 面板（DecisionInboxPanel）的概念对非技术用户不直观
3. "资源" 面板（CallableBrowser）是配置工具，不是日常操作面板
4. 6 个平级 tab 没有主次之分

**建议重构为**：

```
主视图：[Workflow 编辑器] [运行监控] [审批队列]
折叠区：[资源管理] [历史记录]
开发者模式（隐藏）：[控制面板] [决策日志]
```

### 2.3 UI 状态管理

**前端状态策略**：`App.tsx` 使用 `useState` + `useCallback` + `useEffect` 管理全局状态，没有使用状态管理库（Redux/Zustand）。

**核心问题**：
1. **实时更新局部存在但不一致** — `WorkflowViewer.tsx` 有 SSE（EventSource）和 1 秒轮询用于 assistant turn 更新和 run stream 事件（`node_log_delta`、`agent_event`、`summary`），但 `DecisionInboxPanel` 和 `InteractionPanel` 仅在挂载时 fetch 一次，永不刷新
2. **App.tsx 级别无实时更新** — 顶层资源（runs/callables/workflows）仅在 mount 时加载，子组件变更后通过 `onChanged` 回调手动 refresh
3. **资源状态冗余** — `runsResource`, `callablesResource`, `workflowsResource` 三个独立 state，各自管理 loading/error/data，模式重复
4. **无乐观更新** — 所有操作都是 fire-and-forget + 手动 refresh

**前端与后端状态机不同步风险**：`DecisionInboxPanel` 和 `InteractionPanel` 存在数据过期问题 — 后端决策/交互状态变化后前端不会自动刷新。

### 2.4 产品化差距

| 缺失能力 | 影响 | 修复成本 |
|---------|------|---------|
| 实时状态更新一致性 | Inbox/Interaction 面板数据过期 | Medium |
| 操作确认/undo | 误操作无法恢复（如 Callable 删除无确认） | Medium |
| 空状态引导 | 新用户不知道从哪开始 | Small |
| 通知系统 | 人工审批等待无提醒 | Medium |
| 响应式布局 | 移动端不可用，grid 固定 300px 侧栏 | Large |
| 错误恢复引导 | 失败后只显示错误，无修复建议 | Medium |
| 键盘快捷键 | 无高效操作方式 | Small |
| 无障碍支持 | 缺少 ARIA 标签、焦点管理、屏幕阅读器支持 | Large |
| ask/suggest 交互 | InteractionPanel 只支持 approval/confirm，ask/suggest 无输入机制 | Medium |

---

## 三、设计原则分析

### 3.1 自顶向下设计评估

**当前层次结构**：

```
acc/server/ (HTTP API)
    ↓ imports
acc/app/ (Application Layer)
    ↓ imports
acc/engine/ (Engine)
    ↓ imports
acc/domain.py (Domain Models + Serialization + Validation)
```

**问题**：
- `domain.py` 不纯 — 它同时承担了序列化和验证职责，违反了领域层应该最稳定的原则
- `acc/app/` 过于肥大（16 个模块），没有清晰的子领域划分
- `acc/engine/control_ledger.py` 只有 125 行且几乎全是 re-export — 实际逻辑在 `control_ledger_codec.py` 和 `core_v2_runtime.py:FixedRunControlLedger` 中，层次混乱
- 循环依赖风险：`app/` 中多个模块互相 import

### 3.2 SOLID 原则符合度

| 原则 | 评分 | 关键违反 |
|------|:----:|---------|
| **S** (Single Responsibility) | 3/10 | `core_v2_runtime.py` 承担 5+ 职责；`domain.py` 混合 3 种关注点 |
| **O** (Open/Closed) | 6/10 | 适配器模式允许扩展新 agent 类型；但添加新 dispatch 模式需要在 runtime 中新增完整函数 |
| **L** (Liskov Substitution) | 7/10 | 适配器继承 `BaseAgentAdapter` 且可替换 |
| **I** (Interface Segregation) | 4/10 | `FixedRunControlLedger` 暴露了过多内部方法给调用方 |
| **D** (Dependency Inversion) | 5/10 | `callable_registry` 通过参数注入（好），但 `write_json`/`load_json` 直接调用文件系统（坏） |

### 3.3 关注点分离

| 关注点 | 分离程度 | 说明 |
|--------|---------|------|
| 业务逻辑 vs I/O | ❌ 混合 | `core_v2_runtime.py` 中业务逻辑（调度决策）和 I/O（`write_json`, `shutil.rmtree`）交织 |
| 领域模型 vs 序列化 | ❌ 混合 | `domain.py` 同时定义模型和 `_from_dict` / `_to_dict` |
| HTTP 路由 vs 业务 | ✅ 良好 | `server/routes/` 薄层委托给 `app/` |
| 前端展示 vs 数据获取 | ⚠️ 一般 | `App.tsx` 混合了导航逻辑和数据获取逻辑 |

### 3.4 性能问题

| 问题 | 位置 | 影响 | 严重度 |
|------|------|------|:------:|
| Control ledger JSONL 无界增长 | `store/control_ledger.py` | 大 workflow 的 append log 无限增长，读取变慢 | High |
| 每次 run 完成重建全量 index | `core_v2_runtime.py:2314` | `rebuild_run_index()` 遍历所有 run 目录，每目录尝试 4 次文件读取 | High |
| O(n) session 查找 | `agent_sessions.py:1008-1020` | `_find_session_dir` glob 扫描所有 session 目录再逐个读 JSON | High |
| 同步 JSON 文件读写在 async 上下文中 | `core_v2_runtime.py` 全文 | `write_json`/`load_json` 是 `path.read_text()`/`path.write_text()` 直接调用，阻塞事件循环 | Medium |
| Engine 双重拓扑排序 | `engine/__init__.py:696-720` | `compile_execution_plan` 先在 `validate_*` 中调一次 `callable_topological_levels`，再直接调一次 | Medium |
| Busy-polling 审批等待 | `agent_sessions.py:1175-1196` | `asyncio.sleep(0.5)` 循环等待文件出现，并发审批时浪费 CPU | Medium |
| `_to_jsonable` 递归遍历所有 dataclass 字段 | `domain.py:1069-1078` | 深层嵌套对象序列化开销 | Low |

### 3.5 第一性原理审视

#### ACC 的本质需求是什么？

从零开始思考一个 "agent workflow conductor" 需要什么：

1. **Graph 定义**：节点（agent 任务）+ 边（依赖关系）
2. **调度器**：拓扑排序后按 ready-set 分批执行
3. **执行器**：调用 agent adapter，获取结果
4. **数据流**：节点间传递 payload
5. **Human gate**：暂停/等待/恢复
6. **持久化**：保存执行状态以便恢复/查看
7. **API**：外部控制和观测

**本质上是 ~7 个独立概念，可以用 ~1500 行清晰代码实现。**

#### 当前实现中的偶然复杂度

| 偶然复杂度 | 它解决什么问题 | 是否必要 |
|-----------|-------------|---------|
| 控制账本 (ControlLedger) | 审计追溯 | 对产品化非必要，可用简单 event log 替代 |
| Decision 记录 | 解释为什么调度了某节点 | 对固定 DAG 无意义（答案永远是"依赖满足"） |
| Dispatch Envelope | 记录每次分派的元数据 | 过度工程化，只有可重放需求时才有意义 |
| PlanStepTransitionRecord | 记录每次状态变化 | 调试用，不应在正常路径上产生开销 |
| 三种 dispatch 模式 (fixed/supervisor/handoff) | 支持动态调度 | supervisor 和 handoff 是高级功能，但不应在 core runtime 中与 fixed 混合 |
| scope_frame, environment_frame | 嵌套 workflow 的环境隔离 | 必要但可大幅简化 |

#### 如果从零设计

```
acc_core/
  graph.py          # DAG 定义 (~100 行)
  scheduler.py      # Ready-set scheduler (~80 行)
  executor.py       # Node executor + adapter dispatch (~200 行)
  state.py          # Run state management (~150 行)
  persistence.py    # Event log + state snapshot (~200 行)
  
acc_extensions/
  human_gate.py     # Human-in-the-loop (~150 行)
  supervisor.py     # Dynamic dispatch (~200 行)
  handoff.py        # Agent handoff (~200 行)
  
acc_server/
  api.py            # FastAPI routes (~300 行)
  
acc_web/
  (React frontend)
```

**核心 ~730 行，扩展 ~550 行，API ~300 行 = ~1580 行** vs 当前 ~28000 行

---

## 四、问题优先级矩阵

| # | 问题 | 严重度 | 修复成本 | 优先级 | 建议 |
|---|------|:------:|:-------:|:------:|------|
| 1 | WorkflowViewer.tsx 17,521 行巨石组件 | Critical | Epic | **P0** | 按功能域拆分为 8-12 个独立模块 |
| 2 | core_v2_runtime.py God Module | Critical | Large | **P0** | 拆分为 scheduler + executor + ledger + io |
| 3 | 三个 dispatch 函数 ~80% 重复 | High | Small | **P0** | 提取公共 `_dispatch_ready_steps(source_filter)` |
| 4 | 状态机无运行时转换守卫 | High | Medium | **P1** | 引入 transition guard + 拒绝非法转换 |
| 5 | InteractionPanel ask/suggest 无输入机制 | High | Small | **P1** | 为 ask/suggest 类型添加文本输入 UI |
| 6 | ClaudeSdkAdapter 是永远失败的死代码 | High | Small | **P1** | 实现或从 dispatcher 移除 |
| 7 | agent_sessions.py O(n) 全扫描查找 session | High | Small | **P1** | 建立 session_id → path 索引 |
| 8 | routes/workflows.py 业务逻辑在路由层 | High | Medium | **P1** | 移至 WorkflowAppService |
| 9 | domain.py 混合关注点（62 dataclass + 序列化 + 验证） | Medium | Medium | **P1** | 拆分为 models / serialization / validation |
| 10 | 广泛函数重复（6 个 utility 2-5 份副本） | Medium | Small | **P2** | 提取到共享 utils 模块 |
| 11 | ControlPlanePanel 暴露内部 | Medium | Small | **P2** | 隐藏到开发者模式 |
| 12 | 前端 i18n 覆盖 <20% | Medium | Medium | **P2** | 统一翻译键，所有组件接入 |
| 13 | ArtifactViewer 仅显示首节点 artifacts | Medium | Small | **P2** | 添加节点选择器 |
| 14 | styles.css 6,574 行全局单文件 | Medium | Large | **P2** | 引入 CSS Modules 或组件级样式 |
| 15 | 无 session 清理/TTL 机制 | Medium | Medium | **P2** | 添加过期清理逻辑 |
| 16 | CallableBrowser 删除无确认 | Medium | Small | **P2** | 添加 confirm dialog |
| 17 | V2 Binding 死代码 | Low | Small | **P3** | 删除 |
| 18 | graphops/graphops_v3 共存 | Medium | Medium | **P3** | 合并为单一模块 |
| 19 | 同步 I/O 在 async 上下文 | Medium | Large | **P3** | 使用 aiofiles 或 run_in_executor |
| 20 | rebuild_run_index 全量扫描 | Medium | Small | **P3** | 改为增量更新 |
| 21 | AgentTurnTaskManager 潜在内存泄漏 | Medium | Small | **P3** | 添加定期清理或 WeakValueDictionary |
| 22 | 前端无障碍（ARIA）缺失 | Medium | Large | **P3** | 逐步补充 role/aria 属性 |
| 23 | 前端测试覆盖极低（2 个文件 / 12 组件） | Medium | Large | **P3** | 为关键组件补充单元测试 |

---

## 五、深度验证与补充发现

> 以下为二次审计（3 agent 深度验证）的新增发现

### 5.1 后端模块深度审计

#### authoring.py (2,067 行) — 工作流创作服务

| # | 行号 | 严重度 | 问题 | 建议 |
|---|------|:------:|------|------|
| 1 | 433-1152 | Medium | **God Class: `AuthoringSessionService`** (720 行) — 混合 session CRUD、LLM 调用、proposal 验证、operation-level 错误检查 | 拆为 `OperationValidator` + `AuthoringAgentInvoker` |
| 2 | 846-1109 | Medium | **Monster method: `_operation_errors`** (263 行) — 单函数含 5+ 闭包（`reserve_node_id`、`node_exists_in_scope` 等）互相修改父作用域 | 提取为 `ProposalOperationValidator` 类 |
| 3 | 1222/1427 | Medium | **`permission_payload()` 重复** — authoring.py 和 agent_sessions.py 各有一份，字段集合已开始分化 | 移至共享模块 |
| 4 | 1316-1413 | Low | **`hermetic_canvas_proposal` 过度工程化** — 100 行真实感 proposal 生成逻辑。如果与真实 agent 输出漂移，测试通过但生产失败 | 改用 golden fixture |
| 5 | 1483-1499 | Low | **`PROMPT_FIELD_HINTS` 硬编码双语字段** — 后端耦合 UI 语言 | 移至 i18n/配置文件 |

#### agent_sessions.py (1,487 行) — Agent 会话管理

| # | 行号 | 严重度 | 问题 | 建议 |
|---|------|:------:|------|------|
| 1 | 1008-1020 | High | **O(n) session 查找** — `_find_session_dir` glob 扫描所有目录后逐个读 JSON 匹配 session_id | 建索引或将 session_id 编码到路径中 |
| 2 | 1066-1100 | High | **`AgentTurnTaskManager` 潜在内存泄漏** — `self.tasks` dict 累积任务引用，异常时条目可能残留，无定期清理 | 用 `WeakValueDictionary` + 容量上限 |
| 3 | 505-668 | Medium | **`execute_agent_turn` 163 行** — 混合 hermetic 分支、workbench-assistant 分支、输出验证、状态转换 | 拆为 `_execute_hermetic_turn()` / `_execute_production_turn()` |
| 4 | 1175-1196 | Medium | **审批 busy-polling** — `asyncio.sleep(0.5)` 循环等待文件出现 | 改用 `asyncio.Event` 或 watchfiles |
| 5 | 71-68 | Low | **5 种职责混合** — `AgentTurnService` + `AgentTurnTaskManager` + `FilesystemAgentApprovalBridge` + `StreamingAgentAdapterDispatcher` + 20+ 工具函数 | 拆为 3 个文件 |

#### callable_runner.py (725 行) — Callable 执行器

| # | 行号 | 严重度 | 问题 | 建议 |
|---|------|:------:|------|------|
| 1 | 180-194 | Medium | **`AgentAdapterDispatcher` 无状态类** — 单方法类，实际是伪装成类的函数 | 改为普通函数 `resolve_adapter()` |
| 2 | 291-452 | Low | **`DEFAULT_AGENT_OUTPUT_SCHEMA` 162 行内联 dict** — 噪音大，难以独立验证 | 移至 `.json` schema 文件 |
| 3 | 220-246 | Low | **permission 优先级链隐式** — `invocation_policy → overrides → runtime_policy → template.default` 无文档 | 添加注释或建模为显式 provider 列表 |

#### workbench_adapter.py (1,037 行) — Workbench 适配器

| # | 行号 | 严重度 | 问题 | 建议 |
|---|------|:------:|------|------|
| 1 | 72-77 | Medium | **常量重复** — `CODEX_EXECUTION_MODES` 在此文件和 `callable_runner.py` 各定义一次 | 抽到 `acc/constants.py` |
| 2 | 96, 205 | Medium | **`json.loads(json.dumps(x))` 深拷贝** — 已 import `copy` 模块却不用，此写法丢失元组/int key | 用 `copy.deepcopy()` |
| 3 | 584-657 | Medium | **`split_internal_edges_for_child_workflow` 返回 4-tuple** — 74 行含交织的边界检测和去重逻辑 | 返回 `@dataclass` bundle |
| 4 | 488-529 | Low | **空 prompt 回退** — 无 input 节点用 label 作为 prompt（如 "Step 1"），语义为空 | 标记为"需用户补充"状态 |

#### engine/__init__.py (818 行) — 模板编译器

| # | 行号 | 严重度 | 问题 | 建议 |
|---|------|:------:|------|------|
| 1 | 696-720 | Medium | **`callable_topological_levels` 被调用两次** — validate 和 compile 各一次，同样的图遍历 | 缓存 validate 结果传给 compile |
| 2 | 583-598 | Low | **死参数** — `validate_callable_workflow_function` 接收 `call_depth` 和 `parent_stateful` 后立即 `_ = call_depth` | 移除或标注规划用途 |
| 3 | 554-561 | Low | **严格拒绝未知字段** — 未来 schema 版本的新字段会导致硬错误而非警告 | 对 minor 版本用 warning |

#### server/routes/workflows.py (921 行) — Workflow API 路由

| # | 行号 | 严重度 | 问题 | 建议 |
|---|------|:------:|------|------|
| 1 | 166-213 | High | **48 行业务逻辑在路由 helper 中** — `prepare_runtime_graph` 执行 bundle 编译、ref 解析、manifest 写入 | 移至 `WorkflowAppService` |
| 2 | 835-839 | Medium | **`os.chmod(target_path, 0o666)`** — Linux 上设置 world-writable 权限 | 用 `0o644` 或仅清除只读标志 |
| 3 | 870-880 | Medium | **`subprocess.Popen` 无资源清理** — Popen 对象泄漏 | 用 `start_new_session=True` + 关闭 handle |
| 4 | 119-163 | Low | **每请求创建新 service/registry 实例** — 非单例 | 用 FastAPI 依赖注入 |

#### adapters/claude_sdk.py (81 行) — 死代码适配器

| 严重度 | 问题 |
|:------:|------|
| High | **生产环境中的永远失败的适配器** — 两个错误路径：(1) SDK 未安装返回 "unavailable"；(2) SDK 已安装但返回 "not implemented"。`AgentAdapterDispatcher` 会将 `claude_sdk` runtime 解析到此适配器，然后静默失败 |
| 建议 | 实现功能或在 dispatcher 中加 feature flag 阻止选择 |

#### adapters/base.py (109 行) — 适配器协议

| 严重度 | 问题 |
|:------:|------|
| Medium | **`AgentAdapter` Protocol 无 `cancel()` 方法** — 取消只能通过 `cancel_path` 文件轮询实现，无协议级显式取消 |
| Low | **`AgentRunResult` 无计时字段** — 无 `started_at`/`ended_at`/`duration_seconds`，调试慢 run 需关联外部日志 |

### 5.2 跨模块系统性问题

#### A. 广泛函数重复 (High)

以下 utility 在代码库中存在 2-5 份几乎相同的实现：

| 函数 | 重复位置 | 已分化？ |
|------|---------|:-------:|
| `update_runtime_json` | `callable_runner.py:715`, `agent_sessions.py:1468` | 否 |
| `permission_payload` | `authoring.py:1222`, `agent_sessions.py:1427` | **是**（字段集已不同） |
| `validate_session_id` | `authoring.py:2029`, `agent_sessions.py:1422` | 否（仅前缀不同） |
| `read_jsonl` / `read_events` | 5+ 处实现 | 部分 |
| `_callable_ref_key` / `_callable_ref_payload` | `engine/supervisor.py:264`, `engine/handoff.py:295` | 否 |
| `CODEX_EXECUTION_MODES` 常量 | `callable_runner.py:38`, `workbench_adapter.py:72` | 否 |

**风险**：`permission_payload` 已出现分化（authoring 版本多了 `env_policy`、`allowed_env`、`timeout_seconds`），一个更新另一个不跟，将产生 silent 权限差异。

#### B. 无 Session 清理/TTL 机制 (High)

- `AuthoringSessionService` 的 `AUTHORING_SESSION_ROOT` 只创建不删除
- `AgentTurnService` 的 `AGENT_SESSIONS_ROOT` 同理
- 无最大 session 数限制、无 TTL、无定期清理
- **后果**：磁盘无限增长，`_find_session_dir` 的 O(n) 扫描随 session 增多线性变慢

#### C. 两个独立的适配器 Dispatcher (Medium)

- `callable_runner.py:AgentAdapterDispatcher` — 解析一次性执行的适配器
- `agent_sessions.py:StreamingAgentAdapterDispatcher` — 解析流式执行的适配器
- 两者支持的 runtime 集合不同（streaming 把 `codex_cli` 静默映射到 `codex_app_server`）
- **无统一适配器注册表**

#### D. json.loads(json.dumps(x)) 反模式 (Medium)

`workbench_adapter.py` 行 96 和 205 用 JSON 序列化做深拷贝，但模块首行已 import `copy`。此写法：
- 比 `copy.deepcopy()` 慢 ~3x
- 静默将 tuple → list, int key → string key
- 遇到非 JSON 序列化类型时 silent data loss

### 5.3 前端深度审计

#### WorkflowViewer.tsx — 17,521 行史诗级巨石

**这是整个代码库最严重的单一问题。** 一个文件包含：
- 80+ 函数和内联子组件（WorkbenchShell、AssistantDrawer、AgentClassEditor、TaskOverviewPage、TaskRail、TopBar、ExecutionDock 等）
- 全部 canvas 状态管理
- 全部 authoring 逻辑
- 全部 SSE 流处理和 1s 轮询
- 全部 run overlay 逻辑
- 100+ 行硬编码 demo agent ID（行 145-158）
- 导出 `__workflowViewerTestables` 测试表面

**影响**：任何 commit 触发完整 re-parse/re-bundle；多人并行开发必然冲突；`memo()`/`useMemo()` 无法补偿巨大闭包。

#### RunInspector.tsx (272 行) — 暴露原始路径

- `NodeDetail` 组件（行 205-270）向用户展示原始文件系统路径：`input_path`、`prompt_path`、`output_path`、`event_log`、`stdout_log`、`stderr_log`
- `artifact_dir` 显示绝对路径
- Artifacts 显示 `size_bytes` 原始整数（如 "1024 bytes"），无友好格式化
- `RunDebuggerPanel`（行 163-196）暴露 "Replay" 按钮和原始 `replay.json` — 开发者工具嵌入生产 UI

#### InteractionPanel.tsx (117 行) — UX 功能缺失

- 仅处理 `approval` 和 `confirm` 两种交互类型
- `ask` 和 `suggest` 类型在 `kindLabels` 中定义了标签但**无输入字段或操作按钮** — 用户收到 ask 请求时无法响应
- 加载一次不刷新，新交互不会自动出现
- `busyId` 状态只锁一个交互的按钮，并发提交可能互相覆盖错误信息

#### ArtifactViewer.tsx (359 行) — 只显示首节点

- `const firstNode = run?.nodes[0]` — 多节点 run 时节点 2-N 的 artifacts 完全不可访问
- `MarkdownPreview` 是手写 Markdown 解析器，只支持 `#`/`##`/`-`，代码块/表格/链接/粗体全部渲染为原文
- `LogPreview` 截断到最后 200 行，无 "加载全部" 按钮
- `briefValue()` 有死代码 bug（行 326-329 重复了行 317-320 的 null 检查，永远不执行）

#### CallableBrowser.tsx (701 行) — 破坏性操作无保护

- `AgentClassEditor` 弹窗用 `role="presentation"` — 屏幕阅读器不识别为 dialog，无焦点陷阱
- **删除按钮无确认** — `onDelete?.()` 直接执行，误点即永久删除
- `AGENT_OPTIONS` 模型列表含占位字符串（"默认模型"/"高能力模型"等）作为实际 model ID 发送给后端
- `normalizeModelForProvider` 用中文显示字符串反向映射回 model ID — 显示层与数据层强耦合

#### DecisionInboxPanel.tsx (206 行) — 混合受众

- 向终端用户展示原始 `run_id`（UUID）、`node_id`、`proposal_id / operation_count ops`
- `decisionIcon()` 用 GitPullRequest 图标映射 `graphops_persistence_proposal` — 开发者隐喻
- 加载一次不刷新，新决策到达后需手动导航离开再返回
- `selected` useMemo 有 `|| inbox?.items[0]` 兜底 — 无 "未选中" 状态

#### WorkflowEvidenceDock.tsx (191 行) — 图标逻辑反转

- Chevron 方向错误：`state.open ? <ChevronDown> : <ChevronUp>` — 打开时应向上（关闭），不是向下
- `EventTimeline` 只显示最后 12 条事件，无分页
- `FailureSummaryCard` 向用户暴露原始 `evidencePath`、`stderrPath`、`outputPath` 路径

#### styles.css (6,574 行) — 全局无模块化

- 所有组件样式在一个全局平文件中，无 CSS Modules/BEM 命名空间
- 首条规则 `.failure-summary-card`（行 10-25）出现在 CSS reset（行 27-29）之前 — 顺序错误
- 颜色全部硬编码 hex（`#0d1117`、`#202833`、`#182026` 等），无 CSS 变量，不支持主题切换
- 无 `@media (prefers-color-scheme)` 或 `@media (prefers-reduced-motion)`
- 无响应式断点 — grid 固定 `300px minmax(0, 1fr)`

#### i18n 覆盖率 < 20%

- `zh-CN.ts` 仅 61 行 / ~35 个字符串
- 只有 3 个组件使用 `zhCN as t` 导入（RunInspector、ControlPlanePanel、WorkflowViewer）
- 其他所有组件直接硬编码中文字符串
- 英中混合：同一组件内 "CALLABLE ASSETS"（英）与 "资源"（中）并存

#### types.ts — TypeScript 类型安全被破坏

- `AgentSessionRecord` 使用 `[key: string]: unknown` index signature（行 113）
- `AgentTurnRecord` 同理（行 137）
- `RunEvent` 同理（行 232）
- `api.ts` 的 `getJson<T>()` 直接 cast 无运行时验证 — 后端 schema 变更静默产生畸形对象
- `api.approveGraphOpsProposal` 硬编码 `approver: 'workbench_user'`（行 463）— 身份信息烧入前端代码

### 5.4 测试覆盖率分析

#### 前端：覆盖极度不足

| 有测试 | 无测试 |
|--------|--------|
| `App.test.tsx` (3,605 行 — 集成式) | `RunInspector` |
| `WorkflowViewer.drag.test.tsx` (3,555 行 — canvas 交互) | `InteractionPanel` |
| | `DecisionInboxPanel` |
| | `ArtifactViewer` |
| | `CallableBrowser` |
| | `ControlPlanePanel` |
| | `format.ts` |
| | `palette.ts` |
| | `workflowConnectionState.ts` |

**12 个可审计的前端模块中仅 2 个有测试文件。** `App.test.tsx` 的 mock server（~370 行硬编码 fixture）使其对 API 变更极度脆弱。

#### 后端：覆盖尚可但关键路径有缺口

**已覆盖**：
- Run lifecycle、human gate、interaction 流程（含边界情况）
- Authoring service（1,211 行测试，最大测试文件）
- Core v2 workflow run（20+ 测试函数）
- Import 边界架构测试

**未覆盖**：
| 缺失测试 | 影响 |
|---------|------|
| `ask`/`suggest` interaction 类型的 API 行为 | 可能后端也有 bug 但无测试发现 |
| `DecisionInbox` 边界情况（空 inbox、缺失 run ref、畸形 evidence） | 生产崩溃风险 |
| Control ledger 并发写入 / 损坏恢复 | 审计追溯可能丢失 |
| `diffRuns`/`replayRun` debugger 端点 | 调试功能可能 broken 无人知 |
| `nodeLog` SSE stream | 流式日志可能 broken 无人知 |
| Workbench run manager 部分失败场景 | 仅 4 个测试覆盖复杂组件 |
| 并发压力测试（scheduler + wakeup queue） | 竞态条件可能隐藏 |

---

## 六、行动建议

### 短期（1-2 周）

1. **拆分 WorkflowViewer.tsx** — 按功能域拆分为独立模块：canvas 渲染、authoring 逻辑、SSE 流处理、AssistantDrawer、AgentClassEditor、TaskOverviewPage 等。优先分离文件以解除多人协作瓶颈。

2. **修复 InteractionPanel ask/suggest** — 为 `ask` 和 `suggest` 交互类型添加文本输入框和提交按钮。当前用户收到这类请求时完全无法响应。

3. **消除 dispatch 重复** — 提取公共函数，三个 dispatch 合并为参数化版本。预计减少 ~180 行。

4. **修复 ClaudeSdkAdapter** — 要么实现功能，要么从 dispatcher 中移除并在配置层阻止选择。

5. **删除确认死代码** — 移除 V2 Binding、`ports/__init__.py` 空壳、`migration/__init__.py` 空壳。

6. **隐藏开发者面板** — 将 ControlPlanePanel 和 DecisionInboxPanel 移入 `?dev=true` 条件渲染。

7. **修复 ArtifactViewer** — 添加节点选择器，使多节点 run 的所有 artifacts 可访问。

8. **添加 Callable 删除确认** — CallableBrowser 删除操作前弹出确认 dialog。

### 中期（1-2 月）

9. **拆分 core_v2_runtime.py** — 按职责拆分为：
   - `acc/runtime/scheduler_loop.py` — ready queue 执行循环
   - `acc/runtime/node_executor.py` — 单节点执行
   - `acc/runtime/control_ledger.py` — FixedRunControlLedger 类
   - `acc/runtime/payload_resolution.py` — 节点 payload 解析
   - `acc/runtime/io_helpers.py` — 文件读写辅助

10. **拆分 domain.py** — 分为：
   - `acc/models.py` — 纯 dataclass（62 个）
   - `acc/serialization.py` — to_dict / from_dict
   - `acc/validation.py` — validate_* 函数

11. **消除函数重复** — 将 6 组重复 utility 提取到共享模块：
   - `acc/utils/serialization.py`（JSONL 读写）
   - `acc/constants.py`（执行模式常量）
   - `acc/domain.py`（CallableRef utility）

12. **形式化状态机** — 为 PlanStepStatus 和 DispatchStatus 在 `transition_step()` 中引入转换表 + guard 函数，拒绝非法转换。

13. **重构 Session 管理** — 建立 session_id → path 索引消除 O(n) 扫描；添加 TTL 清理机制。

14. **前端 i18n 统一** — 所有组件接入翻译键，消除内联中文硬编码和中英混用。

15. **路由层瘦身** — 将 `routes/workflows.py` 中的业务逻辑（`prepare_runtime_graph` 等）移至 `WorkflowAppService`。

16. **styles.css 模块化** — 引入 CSS Modules 或按组件拆分样式文件，添加 CSS 变量支持主题。

### 长期（季度级）

17. **简化控制账本** — 评估是否真正需要 DecisionRecord/DispatchEnvelope 级别的审计追溯。考虑将其降级为可选 verbose logging。

18. **合并 graphops** — 将 `graphops.py` 中仍被使用的函数迁移到 `graphops_v3.py`，删除旧文件。

19. **前端架构升级** — 引入 TanStack Query 替代手动 fetch + useState，统一实时更新策略（SSE 已有但不一致）。

20. **补充测试覆盖** — 优先为 InteractionPanel、DecisionInboxPanel、ArtifactViewer、format.ts 补充单元测试；后端补充 ask/suggest 交互、控制账本并发、debugger 端点测试。

21. **无障碍合规** — 逐步补充 ARIA 角色（dialog、tab、live region）、焦点管理、键盘导航。

22. **统一适配器注册表** — 合并 `AgentAdapterDispatcher` 和 `StreamingAgentAdapterDispatcher` 为单一注册表，消除 runtime 映射不一致。

---

## 附录

### A. 审计方法

1. **Phase 1 (Discovery)**: 8 个并行 agent（3×haiku + 5×sonnet）扫描后端状态机、领域模型、适配器、应用层、API、前端组件、前端状态、遗留代码
2. **Phase 2 (Analysis)**: 6 个并行 agent（3×opus + 3×sonnet）交叉分析状态机健壮性、冗余、UX 层级、OOP 设计、性能、替代方案
3. **Phase 3 (Synthesis)**: 手动验证 agent 发现 + 源码直读 + 综合撰写
4. **Phase 4 (Deep Verification)**: 3 个 agent（2×opus + 1×sonnet）二次验证所有 Critical/High 结论、深度审计未覆盖文件、前端组件逐个审查

### B. 声明验证结果

| # | 原始声明 | 验证结果 | 说明 |
|---|---------|:-------:|------|
| 1 | transition_step() 不检查转换合法性 | ✅ TRUE | codec 层有 PLAN_STEP_TRANSITIONS 但运行时不调用 |
| 2 | 三个 dispatch 函数近乎复制 | ⚠️ PARTIALLY TRUE | 结构重复度 ~75-80%，差异含 step 筛选逻辑、动态节点构造、函数签名 |
| 3 | V2 Binding 是死代码 | ✅ TRUE | 仅在 domain.py 定义，engine 使用 V1 类型 |
| 4 | graphops.py 是"旧版" | ⚠️ PARTIALLY TRUE | 实际是 patch-based GraphOps（Option A），v3 是 transaction-based，两者服务不同目的，共享 3 个 utility |
| 5 | 前端无实时更新 | ❌ FALSE | WorkflowViewer.tsx 有 SSE + 1s polling；但 DecisionInbox/InteractionPanel 确实无刷新 |
| 6 | "resuming" 状态无超时保护 | ✅ TRUE | RESTART_INTERRUPTED_RUN_STATUSES 承认问题但无自动恢复 |
| 7 | domain.py 有 50+ frozen dataclasses | ✅ TRUE | 精确计数：62 个 |
| 8 | rebuild_run_index 扫描所有 runs | ✅ TRUE | 遍历所有子目录，每目录最多 4 次文件读取 |
| 9 | 同步 I/O 在 async 函数内 | ✅ TRUE | write_json/load_json 是 path.read_text()/write_text() |
| 10 | ports/__init__.py 是空壳 | ✅ TRUE | 5 行，`__all__ = []` |

### C. 代码量统计（修正）

| 模块 | 文件数 | 总行数 | 最大文件 |
|------|:------:|:------:|---------|
| acc/ (backend) | 71 | ~28,000 | core_v2_runtime.py (2,422) |
| web/src/ (frontend) | 22 | ~24,000 | **WorkflowViewer.tsx (17,521)** |
| tests/ | 55 | ~15,000 | App.test.tsx (3,605) |
| **合计** | **148** | **~67,000** | — |

> **注**：前端行数远超初始估计的 ~5K，原因是 WorkflowViewer.tsx 单文件 17,521 行 + styles.css 6,574 行。

### D. 关键文件索引

| 文件 | 行数 | 职责 | 健康度 |
|------|:----:|------|:------:|
| `web/src/components/WorkflowViewer.tsx` | 17,521 | 全部前端核心逻辑 | 🔴 史诗巨石 |
| `acc/app/core_v2_runtime.py` | 2,422 | 核心运行时 + 控制账本 + 执行 + I/O | 🔴 God Module |
| `acc/app/authoring.py` | 2,067 | Workflow 创作服务 | ⚠️ God Class |
| `acc/app/agent_sessions.py` | 1,487 | Agent 会话管理 | ⚠️ 混合职责 + O(n) 查找 |
| `acc/domain.py` | 1,411 | 领域模型 + 序列化 + 验证 | ⚠️ 混合关注点 |
| `acc/app/workbench_adapter.py` | 1,037 | Workbench 适配 | ⚠️ 反模式 |
| `acc/server/routes/workflows.py` | 921 | Workflow API | ⚠️ 路由含业务逻辑 |
| `acc/engine/__init__.py` | 818 | 引擎入口 + 编译 | ✅ 合理 |
| `acc/control_ledger_codec.py` | 792 | 控制账本编解码 | ✅ 合理 |
| `acc/app/graphops_v3.py` | 776 | 图操作 v3 | ⚠️ 与旧版共存 |
| `acc/callable_runner.py` | 725 | Callable 执行 | ⚠️ 无状态类反模式 |
| `web/src/components/CallableBrowser.tsx` | 701 | Callable 浏览/编辑 | ⚠️ 无确认删除 |
| `web/src/styles.css` | 6,574 | 全部 CSS 样式 | 🔴 全局无模块化 |
