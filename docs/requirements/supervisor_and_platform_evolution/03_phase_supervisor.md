# 03 — Supervisor 阶段：A2 + A3 + B2

**里程碑目标**：在确定性 DAG 之上增加 **supervisor 协调层**——LLM 只产结构化计划，ACC 路由到预注册 ClassTemplate，决策可审计，结构变更走 GraphOps。  
**借鉴来源**：Multica squad-leader 三件套 + Conductor 确定性兜底（[04_synthesis A2/A3/B2](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)）。  
**依赖**：P0 Callable、中期 A1（推荐）、[04_phase_scheduling_liveness](04_phase_scheduling_liveness.md)（wakeup 消费）。

**需确认项**（实现前探查）  
- 是否已有 `supervisor` 节点 kind 或仅规划：`rg supervisor acc/`  
- GraphOps apply 生产就绪：`acc/graphops.py` `apply_patch_request` 非 dry-run 路径  

---

## A2 — Squad-Leader 三件套 → Supervisor

### REQ-A2-001: SupervisorRoster（ClassTemplate 注册表视图）

| 属性 | 值 |
|------|-----|
| 来源 | A2 |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-PRIN-001, REQ-A1-001 |

**问题陈述**  
Supervisor 需要稳定 ID 的成员列表与能力描述，而非运行时扫描文件系统。

**当前 ACC 现状**  
- `CapsuleRegistry.discover()` / `list_capsules_payload`：`acc/control_plane.py:39-43`  
- `AgentClassTemplate` 领域类型存在，**无** roster 聚合 API  
- **缺口**：无「仅 agent_class + 能力摘要」的 roster 结构

**目标行为**  
App 层 `build_supervisor_roster(registry) -> SupervisorRoster`：

```python
@dataclass(frozen=True)
class RosterEntry:
    callable_ref: CallableRef
    title: str
    capabilities: AgentCapabilities
    input_ports: dict[str, PortContract]
    output_ports: dict[str, PortContract]

@dataclass(frozen=True)
class SupervisorRoster:
    entries: tuple[RosterEntry, ...]
    generated_at: str
```

注入 supervisor 节点 prompt 边界（仅清单 + 能力，不含他节点 workspace 路径）。

**架构约束**  
roster 为只读投影；不写入 template。

**验收标准**  
- Given registry 含 2 agents When build roster Then 2 entries 稳定排序  
- Hermetic fixture capsules

**风险与缓解**  
roster 过大 → 限制条目数 + 分页 API（P2）。

---

### REQ-A2-002: Structured DynamicInvocationIntent（禁止拼 shell）

| 属性 | 值 |
|------|-----|
| 来源 | A2 |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-A2-001 |

**问题陈述**  
编排 agent 若直接构造 CLI 命令，绕过权限与 port 契约；必须由 ACC 解析结构化意图。

**当前 ACC 现状**  
- 节点执行入口：`CallableInvocationService.execute_node`  
- **缺口**：无 supervisor 输出 schema

**目标行为**  
领域类型：

```python
@dataclass(frozen=True)
class DynamicInvocationIntent:
    target_callable_ref: CallableRef
    node_id_suggestion: str | None  # 可选，落图时用
    input_payload: dict[str, Any]   # 将通过 port 校验
    rationale: str
    correlation_id: str
```

Supervisor LLM **仅输出 JSON** 匹配 schema；ACC 校验后实例化 `NodeInvocationSpec` 或入队 wakeup（见 A4）。

**架构约束**  
schema 在 `schemas/`；校验在 `acc.engine`（纯函数）。

**验收标准**  
- Given 非法 callable_ref When parse intent Then AccError  
- Given 合法 intent When validate Then 产生 NodeInvocationSpec 等价物

**风险与缓解**  
与 GraphOps patch 混淆 → intent 仅触发 **运行时调用**，改图用 `DynamicInvocationProposal`（REQ-A3-002）。

---

### REQ-A2-003: Supervisor 协议注入边界（instructions）

| 属性 | 值 |
|------|-----|
| 来源 | A2 / Multica squad_briefing |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-A2-001 |

**问题陈述**  
Supervisor 必须「只协调不执行」，否则与 worker agent 角色冲突。

**当前 ACC 现状**  
- `AgentClassTemplate.default_prompt`：`acc/domain.py:195`  
- 节点 `CallableOverride.prompt`：invocation 级  
- **缺口**：无 supervisor 角色模板与注入规则

**目标行为**  
- 定义 `supervisor` 调用类型（node metadata `role: supervisor` 或独立 callable kind）  
- 渲染 prompt 时注入：roster JSON、禁止 shell、禁止写下游 workspace、输出必须为 `DynamicInvocationIntent` 或 `SupervisorPlan`  
- 系统 prompt 存 **ClassTemplate**（资源库），任务画布仅用户补充

**架构约束**  
与 AGENTS.md Workbench 规则一致：画布节点不编辑 class 系统 prompt。

**验收标准**  
- Given supervisor 节点 When render Then prompt 含 roster 且无 execute_tool 指令  
- 文档化注入段落模板

**风险与缓解**  
提示词漂移 → 版本化 `supervisor_protocol_version` 写入 manifest。

---

### REQ-A2-004: SupervisorRouter → CallableInvocationService.invoke

| 属性 | 值 |
|------|-----|
| 来源 | A2 |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-A2-002, REQ-A1-003 |

**问题陈述**  
结构化意图必须落到与 P0 相同的执行平面，避免第二套 runner。

**当前 ACC 现状**  
- `CallableInvocationService.execute_node` 为节点执行统一入口（flag on）  
- **缺口**：无 `invoke_from_intent(intent, frame)`

**目标行为**  
`acc.app.supervisor`（新模块，协调层）：

```text
DynamicInvocationIntent
  -> engine.validate_intent + materialize_input
  -> CallableInvocationService.execute_node(...)
  -> SessionInstance manifest + events
```

**健壮性要求**  
幂等键：`correlation_id` 重复提交返回已有 session 结果（见 A2-005）。

**验收标准**  
- Given intent 指向 fake agent When route Then node output 与直接 call 节点一致  
- flag off 时 supervisor 功能禁用或明确 AccError

**风险与缓解**  
循环调用 → A2-005。

---

### REQ-A2-005: 去重与防环（显式契约）

| 属性 | 值 |
|------|-----|
| 来源 | A2 / Multica comment 路由 |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-A2-004, REQ-A3-004 |

**问题陈述**  
动态调用易重复派单或 supervisor↔worker 环。

**当前 ACC 现状**  
- `RecursionPolicy` / `CallDepthPolicy`：`acc/domain.py:262-272`, `acc/engine` workflow call 深度校验  
- **缺口**：无 supervisor 层 dedupe / call graph

**目标行为**  
run manifest 维护 `supervisor_call_graph: list[{from,to,correlation_id}]`）  
规则：

- 同一 `correlation_id` 只执行一次（幂等）  
- 同一 run 内 `(supervisor_node, target_callable_ref)` 连续重复 N 次（默认 N=3）拒绝  
- 深度超过 `policies.supervisor_max_depth` 拒绝

**接口/数据契约草案**  
事件：`supervisor_dispatch_rejected` payload 含 reason

**验收标准**  
- Given 重复 correlation_id When dispatch Then 返回已有结果，不新起 session  
- Given 循环 A→B→A When dispatch Then rejected

**风险与缓解**  
误杀合法重试 → 允许显式 `force_retry: true` policy（默认 false）。

---

## A3 — 确定性兜底：LLM 只产计划

### REQ-A3-001: SupervisorPlan 领域类型

| 属性 | 值 |
|------|-----|
| 来源 | A3 / Conductor |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-PRIN-004, REQ-A2-002 |

**问题陈述**  
一次 supervisor 唤醒可能需调度多个 worker；计划应是可验证、可重放的对象。

**当前 ACC 现状**  
- **缺口**：无 `SupervisorPlan`

**目标行为**  
```python
@dataclass(frozen=True)
class SupervisorPlan:
    plan_id: str
    supervisor_node_id: str
    intents: tuple[DynamicInvocationIntent, ...]
    created_at: str
    status: Literal["proposed","approved","executing","completed","failed"]
```

计划落盘：`runs/<id>/supervisor_plans/<plan_id>.json`

**架构约束**  
domain 纯类型；store 写文件。

**验收标准**  
- Given plan 含 2 intents When validate Then 拓扑与 roster 一致  
- Plan JSON schema 校验测试

**风险与缓解**  
计划过大 → 限制 intents 数量 policy。

---

### REQ-A3-002: DynamicInvocationProposal 与 GraphOps 衔接

| 属性 | 值 |
|------|-----|
| 来源 | A3 / REQ-PRIN-003 |
| 阶段 | supervisor |
| 优先级 | P1 |
| 依赖 | REQ-A3-001, REQ-PRIN-003 |

**问题陈述**  
若 supervisor 需**新增节点/边**，属于结构变更，必须 GraphOps 提案而非直接改 accflow。

**当前 ACC 现状**  
- GraphOps patch ops：`add_node`, `connect_nodes`, 等（`docs/concepts/GRAPHOPS_CONTROL_PLANE.md`）  
- **缺口**：无 `DynamicInvocationProposal` → patch 转换

**目标行为**  
```python
@dataclass(frozen=True)
class DynamicInvocationProposal:
    proposal_id: str
    plan: SupervisorPlan
    graph_patch: dict[str, Any] | None  # optional GraphOps patch
```

流程：`proposal -> acc graphops validate/dry-run -> human approval -> apply`  
仅 **参数化已有节点** 可跳过 patch，走 REQ-A2-004 直接 invoke。

**验收标准**  
- Given proposal 含 add_node When dry-run Then GraphOps 返回 semantic diff  
- 无 `--human-approved` 不写 accflow

**风险与缓解**  
GraphOps apply MVP 未就绪 → 阻塞项，见 TRACEABILITY。

---

### REQ-A3-003: 执行引擎只消费已批准计划

| 属性 | 值 |
|------|-----|
| 来源 | A3 |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-A3-001, REQ-A2-004 |

**问题陈述**  
LLM 产出计划后，执行须确定性、可重放，与 Conductor for-each 同理（零 token 执行段）。

**当前 ACC 现状**  
- `run_workflow_template_instance` level 调度：`acc/app/__init__.py:396+`  
- **缺口**：supervisor plan 执行器

**目标行为**  
`execute_supervisor_plan(plan, store)` 按 intents 顺序/并行策略执行；不再次调用 LLM。  
并行策略默认：无依赖 intents 可同 level 执行（受 `max_concurrent` policy 约束）。

**架构约束**  
执行段用现有 `CallableInvocationService`；调度并发见 A4。

**验收标准**  
- Given 批准 plan When execute Then 每个 intent 有 session manifest  
- 重放：只读 plan JSON 可离线 audit

**风险与缓解**  
与静态 DAG 冲突 → supervisor 节点不参与普通 topological level，或单独 phase。

---

### REQ-A3-004: 静态 DAG 与数据驱动展开边界

| 属性 | 值 |
|------|-----|
| 来源 | A3 / Conductor for-each |
| 阶段 | supervisor |
| 优先级 | P1 |
| 依赖 | REQ-A3-001 |

**问题陈述**  
「动态」应限于实例化 N 个预定义节点或填参，而非运行时发明拓扑。

**当前 ACC 现状**  
- 静态 `control_edges` / `data_edges`：`WorkflowFunctionTemplate`  
- workflow call 子图：`execute_clean_workflow_call_node`  
- **缺口**：无 for-each 式 N 实例化

**目标行为**  
- **允许**：plan 引用模板子图 ID + `instance_count` 来自上游 artifact（数据驱动）  
- **禁止**：plan 含未在 registry/accflow 注册的 callable  
- 数据驱动展开在 **engine** 预计算实例列表，写入 dry-run plan（REQ-B4-004 扩展）

**验收标准**  
- Given instance_count=3 When expand Then 3 个可追踪 node instance id  
- 不引入共享内存 context

**风险与缓解**  
与 GraphOps 新增节点混淆 → 展开仅克隆预注册 invocation 模板。

---

## B2 — 决策审计

### REQ-B2-001: supervisor_decision 事件 schema

| 属性 | 值 |
|------|-----|
| 来源 | B2 / Multica squad activity |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-A2-004 |

**问题陈述**  
黑盒 LLM 编排无法监管；每次评估/派单必须落 events/manifest。

**当前 ACC 现状**  
- `WorkflowEvent` / `NodeEvent`：`acc/domain.py:357-374`  
- `write_workflow_event` / `write_node_event`：`acc/store/__init__.py:161-194`  
- **缺口**：无 `supervisor_decision` type

**目标行为**  
```json
{
  "type": "supervisor_decision",
  "timestamp": "...",
  "node_id": "supervisor_1",
  "status": "recorded",
  "payload": {
    "decision": "action|no_action|failed",
    "target_callable_ref": {"kind":"agent_class","id":"..."},
    "correlation_id": "...",
    "rationale": "...",
    "plan_id": "..."
  }
}
```

写入 `workflow_events.jsonl` 与 supervisor 节点 `events.jsonl`。

**验收标准**  
- Given supervisor 选择 no_action When run Then 存在 decision 事件且 decision=no_action  
- Workbench 时间线可过滤 `supervisor_decision`

**风险与缓解**  
rationale 过长 → 截断 + artifact ref（A5）。

---

### REQ-B2-002: action | no_action | failed 语义与强制记录

| 属性 | 值 |
|------|-----|
| 来源 | B2 |
| 阶段 | supervisor |
| 优先级 | P0 |
| 依赖 | REQ-B2-001 |

**问题陈述**  
「评估过但未行动」与「失败」必须区分，避免沉默。

**当前 ACC 现状**  
- **缺口**：无强制每轮 decision 的协议

**目标行为**  
| decision | 含义 | 后续 |
|----------|------|------|
| action | 已派单或已生成 plan | 必有 intent/plan_id |
| no_action | 评估后刻意不调用 | 无 session 创建 |
| failed | 无法解析/违反 policy | run 或 plan 标记 failed |

Supervisor 节点 **每轮唤醒结束** 必须 emit 恰好一条 `supervisor_decision`（engine 校验）。

**验收标准**  
- Given LLM 未输出 decision When validate Then schema_error  
- Given no_action When audit trail Then 人类可看到 rationale

**风险与缓解**  
LLM 漏字段 → 重试一次后 failed，不静默。

---

## Supervisor 阶段 Done 定义

- [ ] Roster + Intent + Router 打通（fake supervisor + fake workers）  
- [ ] SupervisorPlan 落盘 + 批准执行（无 GraphOps 改图的最小路径）  
- [ ] 每条唤醒有 supervisor_decision 事件  
- [ ] REQ-NONGOAL-004 评审：无涌现式路由  
- [ ] Feature flag：`ACC_ENABLE_SUPERVISOR=1`（建议，与 callable dispatch 正交）
