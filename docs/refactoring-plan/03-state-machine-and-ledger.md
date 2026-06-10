# 状态机形式化与 ControlLedger 三层架构重构

## 现状分析

### 涉及文件及行数

| 文件 | 行数 | 核心职责 |
|------|------|----------|
| `acc/domain.py` | 1412 行 | 所有 Literal 类型状态定义，域对象 frozen dataclass |
| `acc/control_ledger_codec.py` | 793 行 | `PLAN_STEP_TRANSITIONS`、`DISPATCH_TRANSITIONS` 转换表，`validate_plan_step_transition` 函数 |
| `acc/app/core_v2_runtime.py` | 2100+ 行 | `FixedRunControlLedger` 类（读写混合），`transition_step`，`ensure_step_ready` |
| `acc/app/run_lifecycle.py` | 220+ 行 | 运行状态常量，`waiting_interaction → ready` 手动转换逻辑 |
| `acc/app/handoff.py` | 190+ 行 | 直接调用 `append_plan_step_transition`，绕过中央 writer |
| `acc/app/supervisor.py` | 180+ 行 | 直接调用 `append_plan_step_transition`，绕过中央 writer |
| `acc/store/control_ledger.py` | 93+ 行 | 底层 append 函数 |

### 当前问题

**P1 — 状态机无 STRICT 模式保护**

`core_v2_runtime.py:460-497` 的 `transition_step` 方法直接调用 `replace(current, status=next_status, ...)` 而不做转换合法性校验。`control_ledger_codec.py` 中虽定义了 `PLAN_STEP_TRANSITIONS` 表和 `validate_plan_step_transition`，但这个校验函数只在 codec 解析路径上触发（读回时验证），而**写入时完全不校验**。运行时可以写入任何非法转换，只有下次读取时才会抛出 `AccError`——此时写入已不可撤销。

**P2 — ControlLedger 职责混合**

`FixedRunControlLedger`（`core_v2_runtime.py:82`）是一个混合类，同时负责：
- 持有运行状态（`steps_by_node_id`, `run_plan`, sequence counters）
- 构造 `DecisionRecord`、`DispatchEnvelope` 等域对象
- 驱动文件 I/O（`append_plan_step_transition`、`write_run_plan` 等）
- 业务逻辑（`compile_decision`、`dispatch_decision`、`skip_steps` 等）

这导致单元测试几乎不可能在不触动文件系统的情况下验证转换逻辑。

**P3 — 转换逻辑分散在多个调用点**

`handoff.py:85`、`supervisor.py:182`、`run_lifecycle.py:150` 均直接调用 `append_plan_step_transition` 并手动构造 `PlanStepTransitionRecord`，转换合法性完全依赖调用方自觉，无法统一强制执行。

**P4 — 用户可能触发阻塞状态**

`waiting_interaction` 状态对 DAG 模式（fixed workflow）用户意义不明。若由于某些 bug 导致步骤永久停在 `waiting_interaction`，用户界面会无响应，且没有自动恢复机制。

**P5 — 历史运行数据与新 schema 不兼容**

决策一致认同：历史运行数据可完全删除，不需要迁移。

---

## 重构目标

### 目标架构

实施 ControlLedger 三层严格分离架构：

```
Layer 1: 不可变域记录（Frozen Dataclass）
         RunPlan / PlanStep / DispatchEnvelope /
         DecisionRecord / TransitionRecord
         ↓ 只读，永不原地修改
Layer 2: 可变 Writer（FixedRunControlLedgerWriter）
         唯一具有写权限的组件
         持有序列号 counter，调用 Layer 3 校验后再写盘
         ↓ 写前必须经 Layer 3 校验
Layer 3: 纯转换辅助函数（Pure Transition Helpers）
         transition_plan_step / transition_dispatch
         无副作用，只做校验 + 返回新状态，不写盘
```

### 关键设计决策

1. **STRICT 模式**：所有状态转换在写入前必须通过 `PLAN_STEP_TRANSITIONS` / `DISPATCH_TRANSITIONS` 校验，非法转换立即 `raise AccError`，不依赖读取时才发现。
2. **单一写入点**：只有 `FixedRunControlLedgerWriter` 可以写 `plan_step_transitions.jsonl`、`dispatches.jsonl`、`decisions.jsonl`。`handoff.py`、`supervisor.py`、`run_lifecycle.py` 通过 Writer API 操作，不再直接 `append_plan_step_transition`。
3. **纯函数可单元测试**：Layer 3 函数无文件系统依赖，可独立测试所有转换路径。
4. **用户不可触碰阻塞状态**：`waiting_interaction` 在 DAG 固定模式中仅由 `require_human_approval: true` 节点产生，且 ACC 内部维护超时/跳过逻辑，用户不会在 UI 上看到死锁步骤。
5. **历史数据清空**：重构前删除所有 `runs/` 目录下的运行数据，新 schema 从零开始。

---

## 详细实施步骤

### 步骤 1：整理并确认所有状态机定义

**操作**：在 `acc/domain.py` 中确认以下 Literal 状态类型，全部予以保留（已存在且正确）：

```python
# 位于 domain.py 第 32-45 行
RuntimeStatus = Literal[
    "planned", "scheduled", "running", "success", "failed",
    "cancelled", "timeout", "schema_error", "artifact_error",
    "workspace_error", "adapter_error", "unavailable",
]

# 位于 domain.py 第 473 行
RunPlanStatus = Literal["proposed", "active", "completed", "failed", "cancelled"]

# 位于 domain.py 第 475-485 行
PlanStepStatus = Literal[
    "pending", "ready", "waiting_interaction", "dispatching",
    "running", "success", "failed", "skipped", "cancelled",
]

# 位于 domain.py 第 486 行
DispatchStatus = Literal["pending", "started", "completed", "failed", "cancelled"]

# 位于 domain.py 第 753 行
SupervisorPlanStatus = Literal["proposed", "approved", "executing", "completed", "failed"]

# 位于 domain.py 第 751 行
InteractionStatus = Literal["pending", "answered", "expired", "cancelled"]

# run_lifecycle.py 第 20-29 行（运行摘要状态，存储在 run_summary.json）
# TERMINAL: success / failed / cancelled / crashed
# WAITING:  waiting_interaction / waiting_handoff / waiting_timer
# ACTIVE:   queued / running / cancel_requested / resuming
```

**新建文件**：`acc/state_machine.py`（Layer 3 核心）

**预期结果**：所有状态机及转换表集中在一处，易于审查和修改。

---

### 步骤 2：建立完整转换表（Layer 3 核心数据）

在新文件 `acc/state_machine.py` 中定义转换表，直接从 `control_ledger_codec.py` 迁移并扩展：

```python
# acc/state_machine.py

from acc.domain import (
    AccError,
    DispatchStatus,
    PlanStep,
    PlanStepStatus,
    PlanStepTransitionRecord,
    DispatchEnvelope,
    DispatchTransitionRecord,
    DispatchStatus,
)
from acc.session import utc_now_iso

# --- PlanStep 转换表 ---
# None 表示初始化（无前驱状态）
PLAN_STEP_TRANSITIONS: dict[PlanStepStatus | None, frozenset[PlanStepStatus]] = {
    None:                  frozenset({"pending", "ready", "waiting_interaction"}),
    "pending":             frozenset({"ready", "waiting_interaction", "failed", "skipped", "cancelled"}),
    "ready":               frozenset({"waiting_interaction", "dispatching", "failed", "skipped", "cancelled"}),
    "waiting_interaction": frozenset({"ready", "skipped", "cancelled"}),
    "dispatching":         frozenset({"running", "failed", "cancelled"}),
    "running":             frozenset({"success", "failed", "cancelled"}),
    "success":             frozenset(),   # terminal
    "failed":              frozenset(),   # terminal
    "skipped":             frozenset(),   # terminal
    "cancelled":           frozenset(),   # terminal
}

# --- DispatchEnvelope 转换表 ---
DISPATCH_TRANSITIONS: dict[DispatchStatus | None, frozenset[DispatchStatus]] = {
    None:        frozenset({"pending", "started"}),
    "pending":   frozenset({"started", "failed", "cancelled"}),
    "started":   frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset(),   # terminal
    "failed":    frozenset(),   # terminal
    "cancelled": frozenset(),   # terminal
}

# --- RunPlan 转换表 ---
RUN_PLAN_TRANSITIONS: dict[str | None, frozenset[str]] = {
    None:        frozenset({"proposed", "active"}),
    "proposed":  frozenset({"active", "cancelled"}),
    "active":    frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset(),
    "failed":    frozenset(),
    "cancelled": frozenset(),
}
```

**涉及文件**：新建 `acc/state_machine.py`

**预期结果**：转换表成为项目中唯一的状态机权威定义。

---

### 步骤 3：实现 Layer 3 纯转换辅助函数

在 `acc/state_machine.py` 中继续添加纯函数：

```python
def transition_plan_step(
    current: PlanStep,
    next_status: PlanStepStatus,
    *,
    context: dict[str, Any],
    sequence: int,
    decision_id: str | None = None,
    dispatch_id: str | None = None,
    session_id: str | None = None,
    artifact_bundle_id: str | None = None,
    failure_id: str | None = None,
    reason: str,
) -> tuple[PlanStepTransitionRecord, PlanStep]:
    """
    纯函数：校验 PlanStep 状态转换是否合法，返回 (TransitionRecord, 更新后的 PlanStep)。
    非法转换立即 raise AccError（STRICT 模式）。
    无文件 I/O，无外部副作用。
    """
    allowed = PLAN_STEP_TRANSITIONS.get(current.status, frozenset())
    if next_status not in allowed:
        raise AccError(
            f"PlanStep {current.plan_step_id!r} 非法状态转换: "
            f"{current.status!r} -> {next_status!r}。"
            f"当前状态允许转换至: {sorted(allowed) or '无（终态）'}。"
            f"上下文: {context}"
        )
    now = context.get("recorded_at") or utc_now_iso()
    updated = dataclasses.replace(
        current,
        status=next_status,
        updated_at=now,
        decision_id=decision_id or current.decision_id,
        dispatch_id=dispatch_id or current.dispatch_id,
        session_id=session_id or current.session_id,
        artifact_bundle_id=artifact_bundle_id or current.artifact_bundle_id,
        failure_id=failure_id or current.failure_id,
    )
    record = PlanStepTransitionRecord(
        sequence=sequence,
        recorded_at=now,
        plan_step_id=updated.plan_step_id,
        previous_status=current.status,
        next_status=next_status,
        snapshot=updated,
        reason=reason,
        decision_id=decision_id,
        dispatch_id=dispatch_id,
    )
    return record, updated


def transition_dispatch(
    current: DispatchEnvelope,
    next_status: DispatchStatus,
    *,
    context: dict[str, Any],
    sequence: int,
    decision_id: str | None = None,
    plan_step_id: str | None = None,
    reason: str,
) -> tuple[DispatchTransitionRecord, DispatchEnvelope]:
    """
    纯函数：校验 DispatchEnvelope 状态转换是否合法。
    非法转换立即 raise AccError（STRICT 模式）。
    """
    allowed = DISPATCH_TRANSITIONS.get(current.status, frozenset())
    if next_status not in allowed:
        raise AccError(
            f"DispatchEnvelope {current.dispatch_id!r} 非法状态转换: "
            f"{current.status!r} -> {next_status!r}。"
            f"当前状态允许转换至: {sorted(allowed) or '无（终态）'}。"
        )
    now = context.get("recorded_at") or utc_now_iso()
    updated = dataclasses.replace(current, status=next_status)
    record = DispatchTransitionRecord(
        sequence=sequence,
        recorded_at=now,
        dispatch_id=updated.dispatch_id,
        previous_status=current.status,
        next_status=next_status,
        snapshot=updated,
        reason=reason,
        decision_id=decision_id,
        plan_step_id=plan_step_id,
    )
    return record, updated
```

**错误消息格式**：中文描述 + 关键字段，便于 AI 助手读取 ControlLedger 日志时理解。
**涉及文件**：`acc/state_machine.py`
**预期结果**：可在不依赖文件系统的情况下对所有 36 个合法/非法转换路径进行单元测试。

---

### 步骤 4：设计 Layer 2 — FixedRunControlLedgerWriter

新建文件 `acc/ledger_writer.py`，将 `FixedRunControlLedger` 的写入职责分离出来：

```python
# acc/ledger_writer.py

@dataclass
class FixedRunControlLedgerWriter:
    """
    Layer 2：唯一合法的 ControlLedger 写入者。
    持有运行状态 + 序列号 counter。
    所有写入前必须经 Layer 3 (state_machine.py) 校验。
    """
    run_dir: Path
    run_id: str
    run_plan: RunPlan                        # 不可变，初始化后不再替换
    _steps: dict[str, PlanStep]             # 节点 ID -> 当前 PlanStep（随转换演进）
    _plan_step_seq: int = field(default=0, init=False)
    _dispatch_seq: int = field(default=0, init=False)
    _decision_seq: int = field(default=0, init=False)
    _audit_lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)

    # ---- 读取接口 ----
    def get_step(self, node_id: str) -> PlanStep: ...
    def all_steps(self) -> tuple[PlanStep, ...]: ...
    def steps_with_status(self, status: PlanStepStatus) -> tuple[PlanStep, ...]: ...

    # ---- 写入接口（均调用 Layer 3 校验后写盘）----
    def initialize(self, *, timestamp: str, invocation_path: Path, scope_path: Path) -> None:
        """写入 run_plan.json 和所有初始 PlanStep 转换记录"""

    def transition_step(
        self,
        node_id: str,
        next_status: PlanStepStatus,
        *,
        reason: str,
        decision_id: str | None = None,
        dispatch_id: str | None = None,
        session_id: str | None = None,
        artifact_bundle_id: str | None = None,
        failure_id: str | None = None,
    ) -> PlanStep:
        """调用 state_machine.transition_plan_step 校验后写盘，返回更新后 PlanStep"""

    def ensure_step_ready(self, node_id: str) -> None:
        """若步骤为 pending 则转换到 ready；若已是 ready 则幂等通过；其他状态 raise AccError"""

    def start_dispatch(
        self, node: NodeInvocationSpec, invocation: FunctionInvocation, scope: ScopeFrame
    ) -> DispatchEnvelope:
        """调用 ensure_step_ready，创建并写入 DispatchEnvelope，调用 transition_dispatch"""

    def complete_dispatch(self, dispatch: DispatchEnvelope, *, result_refs: tuple[str, ...]) -> None:
        """DispatchEnvelope: started -> completed，PlanStep: dispatching -> running"""

    def fail_dispatch(self, dispatch: DispatchEnvelope, *, error: Exception, failure_id: str) -> None:
        """DispatchEnvelope: started -> failed，PlanStep: dispatching -> failed"""

    def complete_step(
        self, node_id: str, *, artifact_bundle_id: str, session_id: str
    ) -> None:
        """PlanStep: running -> success"""

    def fail_step(self, node_id: str, *, failure_id: str, reason: str) -> None:
        """PlanStep: 当前状态 -> failed（支持从 running/dispatching 过来）"""

    def skip_steps(self, node_ids: tuple[str, ...], *, blocked_by_node_id: str) -> None:
        """批量将 pending/ready/waiting_interaction 的步骤转换到 skipped"""

    def cancel_step(self, node_id: str, *, reason: str) -> None:
        """PlanStep -> cancelled"""

    def set_waiting_interaction(
        self, node_id: str, *, interaction_id: str
    ) -> None:
        """PlanStep: ready -> waiting_interaction，仅 require_human_approval=True 节点可调用"""

    def resume_from_interaction(
        self, node_id: str, *, interaction_id: str, decision_id: str | None
    ) -> None:
        """PlanStep: waiting_interaction -> ready"""

    def record_decision(self, decision: DecisionRecord) -> None:
        """写入 DecisionRecord，序列号自动递增"""

    def write_audit(self, description: str, operation: Callable[[], T]) -> T:
        """包裹 ControlLedgerAuditError 的安全执行器"""

    # ---- 私有序列号辅助 ----
    def _next_plan_step_seq(self) -> int: ...
    def _next_dispatch_seq(self) -> int: ...
    def _next_decision_id(self, kind: str) -> str: ...
```

**涉及文件**：新建 `acc/ledger_writer.py`
**预期结果**：`core_v2_runtime.py` 中的运行编排逻辑只依赖 `FixedRunControlLedgerWriter` 的公开 API，不再直接调用 `append_plan_step_transition`。

---

### 步骤 5：重构 core_v2_runtime.py

**操作**：
- 删除旧 `FixedRunControlLedger` 类（`core_v2_runtime.py:82-572`）
- 引入 `FixedRunControlLedgerWriter`，替换所有引用
- `transition_step`、`ensure_step_ready` 方法改由 writer 实现
- `ControlLedgerAuditError` 保留在 `core_v2_runtime.py` 作为异常类型，或移至 `acc/domain.py`

**关键替换点**：

| 原调用 | 替换为 |
|--------|--------|
| `self.ledger.transition_step(node_id, "dispatching", ...)` | `self.writer.transition_step(node_id, "dispatching", ...)` |
| `self.ledger.ensure_step_ready(node_id)` | `self.writer.ensure_step_ready(node_id)` |
| `self.ledger.start_dispatch(node, ...)` | `self.writer.start_dispatch(node, ...)` |
| `self.ledger.skip_steps(node_ids, ...)` | `self.writer.skip_steps(node_ids, ...)` |

**涉及文件**：`acc/app/core_v2_runtime.py`
**预期结果**：`core_v2_runtime.py` 缩减约 200-300 行，逻辑更清晰。

---

### 步骤 6：统一所有调用方

**操作**：修改以下文件，将直接调用 `append_plan_step_transition` 改为通过 `FixedRunControlLedgerWriter`：

- `acc/app/handoff.py:85` → `writer.transition_step(...)` 或 `writer.cancel_step(...)`
- `acc/app/supervisor.py:182` → `writer.transition_step(...)` —— supervisor 为 stub，接口最小化
- `acc/app/run_lifecycle.py:150` → `writer.resume_from_interaction(...)`
- `acc/app/run_lifecycle.py:221` → `writer.cancel_step(...)` 或 `writer.fail_step(...)`

**涉及文件**：`acc/app/handoff.py`、`acc/app/supervisor.py`、`acc/app/run_lifecycle.py`
**预期结果**：全局搜索 `append_plan_step_transition` 只剩下 `acc/ledger_writer.py` 内部一处调用。

---

### 步骤 7：确保用户工作流定义不产生阻塞状态

**原则**：DAG 固定模式下，`waiting_interaction` 仅由节点级 `require_human_approval: true` 触发，且 ACC 运行时主动管理该状态的出口。用户编写的 `.accflow.json` 不能绕过此限制。

**实施**：
- `set_waiting_interaction` 方法只在 `node_requires_human_approval(node_id) == True` 时才可调用，否则 `raise AccError`
- 在 `acc/app/core_v2_runtime.py` 的主调度循环中，对每个 `waiting_interaction` 步骤注册超时 watchdog（可配置，默认无限等待但记录 ControlLedger 事件）
- 前端 UI 对 `waiting_interaction` 状态步骤展示「等待批准」操作按钮，不展示错误状态

**涉及文件**：`acc/ledger_writer.py`、`acc/app/core_v2_runtime.py`、前端 WorkflowViewer 组件
**预期结果**：用户通过 prompt 定义的纯数据流 DAG 不可能产生永久阻塞步骤。

---

### 步骤 8：删除历史运行数据

**操作**：
```bash
# 删除所有历史运行目录（决策已确认，数据可完全清空）
rm -rf F:/Agent-Capsule-Conductor-v2/runs/
# 重建空目录供运行时使用
mkdir F:/Agent-Capsule-Conductor-v2/runs
```

同时检查并清理：
- `acc/store/` 下任何引用旧 run_id 的缓存文件
- `.accflow_state/` 或类似的临时状态目录
- 前端 localStorage 中缓存的旧运行数据（通过版本化 key 失效）

**涉及文件**：`runs/` 目录，前端 `src/` 中的 localStorage key 版本
**预期结果**：数据库/文件系统干净，新 schema 从零开始。

---

### 步骤 9：将 control_ledger_codec.py 中的转换表统一迁移

**操作**：
- `control_ledger_codec.py` 中的 `PLAN_STEP_TRANSITIONS`（第 221-234 行）和 `DISPATCH_TRANSITIONS`（第 235-242 行）改为从 `acc/state_machine.py` 导入
- `validate_plan_step_transition` 和 `validate_dispatch_transition` 改为调用 Layer 3 函数（或直接使用 state_machine 中的表）
- 保留 `control_ledger_codec.py` 中的 parse 函数（读取验证），但写入路径校验统一由 `state_machine.py` 负责

**涉及文件**：`acc/control_ledger_codec.py`
**预期结果**：转换表单一来源，codec 和 writer 都引用同一份表。

---

## 文件变更清单

### 新建文件

| 文件 | 职责 |
|------|------|
| `acc/state_machine.py` | Layer 3：完整转换表 + 纯转换辅助函数（`transition_plan_step`、`transition_dispatch`） |
| `acc/ledger_writer.py` | Layer 2：`FixedRunControlLedgerWriter` 类 |
| `tests/unit/test_state_machine.py` | Layer 3 纯函数单元测试 |
| `tests/unit/test_ledger_writer.py` | Layer 2 集成测试（使用 tmpdir） |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `acc/control_ledger_codec.py` | `PLAN_STEP_TRANSITIONS`、`DISPATCH_TRANSITIONS` 改为从 `acc/state_machine.py` 导入；`validate_*_transition` 使用统一函数 |
| `acc/app/core_v2_runtime.py` | 删除 `FixedRunControlLedger` 类（第 82-572 行），引入 `FixedRunControlLedgerWriter`；所有直接 `append_*` 调用替换为 writer API |
| `acc/app/run_lifecycle.py` | `waiting_interaction -> ready` 手动转换改为 `writer.resume_from_interaction(...)` |
| `acc/app/handoff.py` | 直接 `append_plan_step_transition` 改为 writer API |
| `acc/app/supervisor.py` | 直接 `append_plan_step_transition` 改为 writer API（supervisor 为 stub，只保留最小接口） |

### 删除文件 / 数据

| 路径 | 原因 |
|------|------|
| `runs/` 目录下所有内容 | 历史运行数据，新 schema 不兼容，决策已确认可完全删除 |
| `FixedRunControlLedger` 类（`core_v2_runtime.py:82-572`）| 拆分为 Layer 2 和 Layer 3，原类废弃 |

---

## 测试计划

### Layer 3 纯函数测试（`tests/unit/test_state_machine.py`）

```python
# 合法转换测试（所有 allowed 路径）
def test_pending_to_ready():
    step = make_plan_step(status="pending")
    record, updated = transition_plan_step(step, "ready", ..., reason="deps met")
    assert updated.status == "ready"
    assert record.previous_status == "pending"
    assert record.next_status == "ready"

# 非法转换测试（STRICT 模式）
def test_running_to_pending_raises():
    step = make_plan_step(status="running")
    with pytest.raises(AccError, match="非法状态转换"):
        transition_plan_step(step, "pending", ..., reason="bad")

# 终态不可再转换
def test_success_is_terminal():
    step = make_plan_step(status="success")
    with pytest.raises(AccError, match="终态"):
        transition_plan_step(step, "running", ..., reason="bad")

# 初始化转换（previous=None）
def test_initial_transition():
    # None -> pending 合法
    # None -> success 非法
```

关键测试用例覆盖：
- 所有 9 种 PlanStepStatus 的合法前驱转换（共 ~20 条合法路径）
- 所有终态尝试再转换（4 个终态 × 多个目标状态）
- `ensure_step_ready` 的幂等性（已 ready → 幂等；running → raise）
- `set_waiting_interaction` 拒绝非 human_approval 节点
- DispatchEnvelope 所有转换路径（5 条合法 + 非法路径）

### Layer 2 集成测试（`tests/unit/test_ledger_writer.py`）

```python
def test_full_dispatch_lifecycle(tmp_path):
    writer = make_writer(tmp_path)
    writer.initialize(...)
    writer.ensure_step_ready("node_a")
    dispatch = writer.start_dispatch(node_a, invocation, scope)
    writer.complete_dispatch(dispatch, result_refs=("result.json",))
    writer.complete_step("node_a", artifact_bundle_id="ab_1", session_id="sess_1")
    step = writer.get_step("node_a")
    assert step.status == "success"

def test_illegal_transition_propagates(tmp_path):
    writer = make_writer(tmp_path)
    writer.initialize(...)
    # 试图从 pending 直接跳到 running（非法）
    with pytest.raises(AccError):
        writer.transition_step("node_a", "running", reason="bad direct jump")
```

### 回归测试

- 运行现有 `tests/` 下所有测试，确保重构前后行为一致
- 端到端测试：通过 workbench 运行一个简单的两节点 DAG workflow，验证 ControlLedger 文件正确写入

---

## 风险与缓解

| 风险 | 可能性 | 缓解措施 |
|------|--------|----------|
| `core_v2_runtime.py` 修改范围大，引入 regression | 高 | 步骤 5 前先补全单元测试；使用 git 逐步提交，每个步骤一个 commit |
| `handoff.py` 和 `supervisor.py` 转换逻辑与 writer API 不完全匹配 | 中 | supervisor/handoff 当前为 stub，大幅简化；先让现有路径通过测试，再对齐接口 |
| Layer 3 纯函数引入循环导入 | 低 | `state_machine.py` 只导入 `acc/domain.py` 中的类型，不导入 `core_v2_runtime` |
| 删除历史数据导致开发环境丢失测试 fixture | 中 | 重构前备份重要的测试 fixture 到 `tests/fixtures/`；`runs/` 下数据仅为运行产物 |

---

## 依赖关系

```
步骤 1（确认状态机定义）
    └─→ 步骤 2（建立转换表）
            └─→ 步骤 3（Layer 3 纯函数）
                    └─→ 步骤 4（Layer 2 Writer 设计）
                            └─→ 步骤 5（重构 core_v2_runtime）
                                    └─→ 步骤 6（统一调用方）
步骤 8（删除历史数据）可独立并行执行（最早在步骤 2 完成后）
步骤 9（迁移 codec 转换表）可在步骤 2/3 完成后并行执行
```

此模块依赖于：
- `00-domain-consolidation`（如有）：`domain.py` 状态 Literal 类型须已稳定
- 独立于前端重构（`06-frontend-ux-and-i18n.md`）

---

## 预估工作量

| 步骤 | 工作量估算 |
|------|-----------|
| 步骤 1-2（状态机定义 + 转换表） | 0.5 天 |
| 步骤 3（Layer 3 纯函数 + 单元测试） | 1 天 |
| 步骤 4（Layer 2 Writer 设计） | 0.5 天 |
| 步骤 5（重构 core_v2_runtime） | 1.5 天 |
| 步骤 6（统一调用方） | 0.5 天 |
| 步骤 7（阻塞状态防护） | 0.5 天 |
| 步骤 8（删除历史数据） | 0.25 天 |
| 步骤 9（迁移 codec 转换表） | 0.25 天 |
| **合计** | **~5 天** |
