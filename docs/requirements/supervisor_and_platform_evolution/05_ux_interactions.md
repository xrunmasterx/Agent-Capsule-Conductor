# 05 — Human-in-the-loop 交互原语（B3）

**里程碑目标**：将「人介入」从 ad-hoc 弹窗升级为 **typed、run-scoped、可审计** 的 `InteractionRequest`，Workbench 可渲染审批/追问卡。  
**借鉴来源**：Paperclip tools + Conductor human_gate（[04_synthesis B3](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)）。  
**依赖**：近期 B1 投影、[04_phase_scheduling_liveness](04_phase_scheduling_liveness.md) L3 escalation。

---

### REQ-B3-001: InteractionRequest 领域类型

| 属性 | 值 |
|------|-----|
| 来源 | B3 |
| 阶段 | ux |
| 优先级 | P1 |
| 依赖 | REQ-PRIN-006 |

**问题陈述**  
人审、追问、确认、建议任务等交互需统一 schema，供 UI 与审计复用。

**当前 ACC 现状**  
- GraphOps 决策 API 展示：`acc/server/routes/decisions.py`（graphops_proposal 等）  
- YAML `human_gate` 节点存在于示例 workflow，**非** typed InteractionRequest  
- **缺口**：`acc.domain` 无 InteractionRequest

**目标行为**  
```python
InteractionKind = Literal["approval", "ask", "confirm", "suggest"]

@dataclass(frozen=True)
class InteractionRequest:
    interaction_id: str
    run_id: str
    node_id: str | None
    kind: InteractionKind
    status: Literal["pending", "answered", "expired", "cancelled"]
    prompt: str
    options: tuple[str, ...]  # optional for confirm/approval
    payload: dict[str, Any]
    created_at: str
    answered_at: str | None = None
    answer: dict[str, Any] | None = None
```

**架构约束**  
domain 定义；store 持久化 `runs/<run_id>/interactions/<id>.json`。

**验收标准**  
- schema JSON 校验测试  
- 四种 kind 各 1 个 fixture

**风险与缓解**  
与 GraphOps 混淆 → interaction 仅 **运行时** 人审，GraphOps 仍管 **结构** 变更。

---

### REQ-B3-002: Run-scoped 交互状态存储与 API

| 属性 | 值 |
|------|-----|
| 来源 | B3 |
| 阶段 | ux |
| 优先级 | P1 |
| 依赖 | REQ-B3-001 |

**问题陈述**  
多 run 并行时交互状态必须按 `run_id` 隔离，不能全局单例。

**当前 ACC 现状**  
- Workbench 任务状态本地存储：`docs/CURRENT_ARCHITECTURE.md:106`  
- **缺口**：服务端无 interactions API

**目标行为**  
API（`acc/server/routes/interactions.py` 建议路径）：

```text
GET  /api/runs/{run_id}/interactions
GET  /api/runs/{run_id}/interactions/{interaction_id}
POST /api/runs/{run_id}/interactions/{interaction_id}/answer
```

回答后：写 manifest + `workflow_events.jsonl` 事件 `interaction_answered`；唤醒协调器（REQ-A4-001）。

**健壮性要求**  
重复 answer 幂等；过期后拒绝 answer。

**验收标准**  
- Given pending interaction When POST answer Then status=answered + 事件  
- Given 错误 run_id When GET Then 404

**风险与缓解**  
探查：`rg InteractionRequest acc/` 实现前确认无重复模块。

---

### REQ-B3-003: Workbench 交互卡渲染

| 属性 | 值 |
|------|-----|
| 来源 | B3 |
| 阶段 | ux |
| 优先级 | P1 |
| 依赖 | REQ-B3-002, REQ-B1-001 |

**问题陈述**  
用户需在 Workbench 看到待处理人审，而非读原始 json。

**当前 ACC 现状**  
- decisions 路由用于 GraphOps 提案：`decisions.py`  
- **缺口**：无 Interaction 卡 UI

**目标行为**  
- Run 视图侧边栏「待处理」列表，按 kind 渲染：  
  - approval：通过/拒绝  
  - ask：文本回答  
  - confirm：确认/取消  
  - suggest：选用建议或忽略  
- 中文标签（AGENTS.md 默认中文 UI）

**架构约束**  
`web/` 只调 API；不直接写 interactions 文件。

**验收标准**  
- Given fixture pending approval When 打开 run Then 显示审批卡  
- `npm run test -- --run` 覆盖交互提交流程

**风险与缓解**  
与浏览器 MCP 无关；hermetic 用 mock API。

---

### REQ-B3-004: human_gate / supervisor 与 Interaction 对齐

| 属性 | 值 |
|------|-----|
| 来源 | B3 / Conductor human_gate |
| 阶段 | ux |
| 优先级 | P2 |
| 依赖 | REQ-B3-001, REQ-A2-003 |

**问题陈述**  
现有 `human_gate` 节点与 supervisor 阻塞应映射到同一 Interaction 模型。

**当前 ACC 现状**  
- 示例：`workflows/engine-architecture-research.v2.yaml` 含 `human_gate`  
- GraphOps 禁止删除 human_gate：`acc/graphops.py:69-70`  
- **缺口**：运行时未统一转为 InteractionRequest

**目标行为**  
- 节点 metadata `interaction_kind: approval` 时，节点进入 `waiting_interaction` 状态并创建 InteractionRequest  
- supervisor `no_action` 且需人确认时，可创建 `ask` 类型 interaction

**验收标准**  
- Given human_gate 节点 When 执行到 gate Then 产生 pending interaction 且 run 暂停消费  
- answer 后从 gate 继续

**风险与缓解**  
需确认 clean workflow 是否解析 human_gate → 探查 `rg human_gate acc/`.

---

## UX 阶段 Done 定义

- [ ] InteractionRequest 四种 kind API + store  
- [ ] Workbench 卡面 + 中文  
- [ ] L3 escalation 创建 interaction（与 A4-004 联调）  
- [ ] 不将交互状态写入 template
