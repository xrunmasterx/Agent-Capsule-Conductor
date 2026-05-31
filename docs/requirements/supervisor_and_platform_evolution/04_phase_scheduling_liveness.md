# 04 — 调度收敛、活性与恢复（A4）

**里程碑目标**：用**本地文件队列 + manifest** 实现统一 wakeup/ready-queue，定义 ScopeFrame/SessionInstance 健康语义与三级恢复，并与 `WorkbenchRunManager` 共存。  
**借鉴来源**：Paperclip `enqueueWakeup` + 三级恢复；Multica `ClaimTaskForRuntime`（[04_synthesis A4](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)）。  
**交叉引用**：[03_phase_supervisor](03_phase_supervisor.md)（supervisor 只产 wakeup 请求）、[05_ux_interactions](05_ux_interactions.md)（human escalation）。

**与 REQ-NONGOAL-001 关系**：禁止 Postgres 队列；本阶段全部基于 `runs/` 与 jsonl。

---

### REQ-A4-001: WakeupRequest 与本地文件队列（单入口）

| 属性 | 值 |
|------|-----|
| 来源 | A4 |
| 阶段 | scheduling |
| 优先级 | P1 |
| 依赖 | REQ-A2-004, REQ-PRIN-008 |

**问题陈述**  
多处直接触发节点执行会导致竞态与重复跑；需要类似 Paperclip 的**单一 enqueue 入口**。

**当前 ACC 现状**  
- Workflow 按 level 同步 gather：`acc/app/__init__.py` `run_workflow_template_instance`（逐 level 执行，**非**持久队列）  
- `WorkbenchRunManager` FIFO：`acc/server/run_manager.py:43-83`（进程内 deque，非跨进程持久）  
- **缺口**：无 `WakeupRequest` 领域类型；无 coalesce

**目标行为**  
```python
@dataclass(frozen=True)
class WakeupRequest:
    request_id: str
    run_id: str
    target_node_id: str | None
    target_callable_ref: CallableRef | None
    reason: Literal["supervisor","dependency_met","timer","human","retry"]
    priority: int  # 0=highest
    created_at: str
    coalesce_key: str | None
```

**单入口**：`acc.app.scheduler.enqueue_wakeup(request) -> request_id`  
持久化：`runs/<run_id>/wakeup_queue.jsonl`（append-only）+ `wakeup_state.json`（物化快照，原子写）。

**Coalesce**：相同 `(run_id, coalesce_key)` 未消费时合并为一条（更新 payload 时间戳）。

**架构约束**  
调度逻辑在 `acc.app` + `acc.store`；不引入 DB。

**健壮性要求**  
崩溃恢复：扫描 jsonl 重建 `wakeup_state`；重复 enqueue 幂等。

**验收标准**  
- Given 两次相同 coalesce_key When enqueue Then 队列仅 1 条 pending  
- Given 进程重启 When reconcile Then 队列状态恢复

**风险与缓解**  
文件锁 → 使用 run_dir 级 lock file 或单写者（Workbench 单进程可先简化）。

---

### REQ-A4-002: Ready-queue 消费与 level-gather 演进

| 属性 | 值 |
|------|-----|
| 来源 | A4 |
| 阶段 | scheduling |
| 优先级 | P1 |
| 依赖 | REQ-A4-001 |

**问题陈述**  
当前逐 level 阻塞 gather 无法穿插 supervisor 唤醒；消费端应统一从 ready-queue 取可执行工作。

**当前 ACC 现状**  
- Level 调度在 app 层循环；完成事件写 `workflow_events.jsonl`  
- **缺口**：完成事件不自动回灌 wakeup 队列

**目标行为**  
协调器循环：

```text
while pending:
  item = claim_next_ready(run_id)  # 拉模型，Multica 式
  execute(item)  # CallableInvocationService 或 workflow level batch
  on_complete -> enqueue_wakeup(dependency_met targets)
```

**Feature flag**：`ACC_USE_READY_QUEUE=0` 保持现有 level-gather。

**验收标准**  
- flag on：supervisor intent 入队后被消费  
- flag off：现有 integration tests 无回归

**风险与缓解**  
行为变更大 → 默认 off，分阶段开。

---

### REQ-A4-003: ScopeFrame / SessionInstance 健康判定

| 属性 | 值 |
|------|-----|
| 来源 | A4 |
| 阶段 | scheduling |
| 优先级 | P1 |
| 依赖 | REQ-A5-001 |

**问题陈述**  
卡死 session 占用并发槽位，需可观测健康状态。

**当前 ACC 现状**  
- `ScopeFrame` / `SessionInstance`：`acc/domain.py:321-354`  
- `write_scope_frame_manifest` / `session_instance_payload`：`acc/store/__init__.py:530+,947+`  
- `RuntimeStatus` 含 timeout/adapter_error：`acc/domain.py:15-24`  
- **缺口**：无 heartbeat/stale 检测

**目标行为**  
manifest 增加：

```json
{
  "health": "healthy|stale|failed|unknown",
  "last_event_at": "ISO8601",
  "stale_after_seconds": 600
}
```

协调器定时（或每次 claim 前）扫描：无事件更新超过阈值 → `stale`。

**验收标准**  
- Given session 无事件 超过阈值 When scan Then health=stale  
- stale 触发 REQ-A4-004 恢复流

**风险与缓解**  
误报 → 仅对 `running` 状态检测；adapter 声明 `status_updates` 时缩短阈值。

---

### REQ-A4-004: 三级恢复语义映射到 run manifest

| 属性 | 值 |
|------|-----|
| 来源 | A4 / Paperclip execution-semantics |
| 阶段 | scheduling |
| 优先级 | P1 |
| 依赖 | REQ-A4-003, REQ-B3-001 |

**问题陈述**  
失败与卡死需要分层恢复，避免直接失败或无限重试。

**当前 ACC 现状**  
- CLI `rerun-node` / `rerun-from`：`acc/cli.py:742+`  
- **缺口**：无 auto-recover / recovery action / human escalation 状态机

**目标行为**  

| 级别 | 名称 | 行为 |
|------|------|------|
| L1 | auto-recover | 可重试错误自动 rerun-node 一次（policy 限制） |
| L2 | recovery_action | 写入 `recovery_plan.json`，需 GraphOps 或人工确认小 patch |
| L3 | human_escalation | 创建 `InteractionRequest`（见 B3），暂停消费队列 |

`workflow_run_manifest.json` additive：`recovery_state`, `recovery_level`

**验收标准**  
- Given adapter timeout When L1 Then 自动重试 1 次  
- Given 二次失败 When L3 Then 产生 interaction 且 run 暂停

**风险与缓解**  
自动重试危险操作 → 仅 `error_class` 白名单可 L1。

---

### REQ-A4-005: WorkbenchRunManager 与统一协调器关系

| 属性 | 值 |
|------|-----|
| 来源 | A4 |
| 阶段 | scheduling |
| 优先级 | P2 |
| 依赖 | REQ-A4-001 |

**问题陈述**  
Workbench 异步提交与 workflow 内部调度需清晰边界，避免双轨竞态。

**当前 ACC 现状**  
- `WorkbenchRunManager`：进程内队列 + `service.run()`：`acc/server/run_manager.py:85-100`  
- 真相源：`runs/<run_id>` 文件

**目标行为**  
- Workbench 提交仍只创建 run_dir + 写 queued summary  
- 图内 wakeup 由 **run-scoped** 协调器消费，不经过 Workbench 全局 deque  
- `max_active_runs` 仅限制 **不同 run_id** 并行，不限制单 run 内节点并发（由 `max_concurrent_nodes` policy 约束）

**验收标准**  
- Given 2 run_id When submit Then WorkbenchRunManager 并行 2 run  
- 单 run 内并发不超过 policy

**风险与缓解**  
需确认 server 是否单进程 → 多进程部署时文件锁必选（文档标注）。

---

## 调度阶段 Done 定义

- [ ] `enqueue_wakeup` 单入口 + jsonl 持久化  
- [ ] ScopeFrame/SessionInstance health 字段  
- [ ] L1/L3 恢复路径各 1 个 hermetic 测试  
- [ ] 默认 flag off；文档说明与 WorkbenchRunManager 分工
