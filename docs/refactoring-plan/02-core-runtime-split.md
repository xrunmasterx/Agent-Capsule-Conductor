# core_v2_runtime.py 拆分与 dispatch 去重

## 现状分析

### 涉及文件及行数

| 文件 | 行数 | 角色 |
|------|------|------|
| `acc/app/core_v2_runtime.py` | 2,422 | God Module，本次拆分主体 |
| `acc/app/run_lifecycle.py` | 287 | run 状态管理，现已基本独立 |
| `acc/store/__init__.py` | 171 | JSON I/O、事件追加等低层工具 |
| `acc/engine/control_ledger.py` | 125 | RunPlan 编译助手的 re-export 层 |

### 当前问题

1. **God Module（2,422 行）**：`core_v2_runtime.py` 同时承担 ControlLedger 写入、调度循环、节点执行、payload 绑定解析、callable 路由、工作流输出写入、payload 序列化七种完全不同的关注点。

2. **三个近乎完全相同的 dispatch 函数**（L924–L1239）：
   - `resume_approved_human_gate_dispatch`（L924）
   - `dispatch_ready_supervisor_plan_steps`（L1029）
   - `dispatch_ready_handoff_plan_steps`（L1135）

   三者共享约 95 行完全一致的样板（构建 `control_ledger`、初始化 `outputs`、执行循环、写 `run_record`、写 `function_invocation`、写 `run_summary`），仅在 step 过滤方式与 node 构建逻辑上各异 15 行。

3. **命名不符合 3 层决策**：`FixedRunControlLedger` 混淆了"不可变记录"与"可变写入者"，应重命名为 `FixedRunControlLedgerWriter`。

4. **同步 I/O 阻塞 asyncio**：`write_json`、`load_json` 等均为同步文件操作，在 async 路径上直接调用会占用事件循环线程，尤其是 ControlLedger 写入中的 `write_audit` 以及节点执行中的多处 `write_json`。

5. **`write_audit` 包裹不一致**：部分写操作用 `write_audit` 包裹（有 `ControlLedgerAuditError` 转换保障），部分直接调用（无保障），错误语义不统一。

---

## 重构目标

### 目标架构

```
acc/
  runtime/
    __init__.py              # 对外 re-export（向后兼容）
    ledger_writer.py         # FixedRunControlLedgerWriter（原 FixedRunControlLedger）
    scheduler.py             # run_ready_queue_execution + workflow_max_concurrency
    executor.py              # execute_core_v2_node + execute_core_v2_callable + execute_hermetic_callable
    invocation.py            # run_core_v2_workflow_path + run_workflow_function_invocation
    dispatch_gate.py         # _dispatch_steps（通用） + 三个公开 dispatch 函数
    payload.py               # resolve_node_payload + binding 辅助 + output_port_ids
    io.py                    # payload 序列化（*_payload 函数）+ append_event + 文件工具
    workflow_io.py           # write_workflow_outputs + read_child_workflow_outputs
    nested_workflow.py       # execute_workflow_function_callable + 路径解析辅助
```

原 `acc/app/core_v2_runtime.py` 保留为**过渡薄包装**，只做 `from acc.runtime.xxx import *`，直到所有调用方完成迁移后删除。

### 关键设计决策

1. **`FixedRunControlLedger` → `FixedRunControlLedgerWriter`**：符合 3 层决策中"Layer 2 = Mutable writer"的命名约定。不可变记录（`RunPlan`、`PlanStep` 等 frozen dataclass）已在 `acc/domain` 中，写入者单独命名以区分层次。

2. **`_dispatch_steps` 通用模板**：提取三个 dispatch 函数的公共骨架为 `_dispatch_steps(run_dir, *, step_filter_fn, node_builder_fn, callable_registry)`，差异部分通过 `step_filter_fn: Callable[[FixedRunControlLedgerWriter, tuple[PlanStep, ...]], tuple[PlanStep, ...]]` 和 `node_builder_fn: Callable[[Path, PlanStep], NodeInvocationSpec]` 注入。

3. **asyncio.to_thread 策略**：仅对写入路径上的同步 I/O 包裹 `asyncio.to_thread`。读取路径（启动前加载快照）保持同步，因为它们在 async 函数入口处的同步段执行，不阻塞正在运行的任务。

4. **STRICT 状态机**：`transition_step` 校验非法转换时直接 `raise ControlLedgerAuditError`，不静默忽略。合法转换矩阵以常量定义在 `ledger_writer.py` 中。

5. **supervisor/handoff = interface-only stub**：`dispatch_ready_supervisor_plan_steps` 和 `dispatch_ready_handoff_plan_steps` 的实现在重构后作为 `_dispatch_steps` 调用，但其内部 `_node_invocation_from_supervisor_step` 等逻辑不做实质性扩展，仅确保接口存在。

---

## 详细实施步骤

### 步骤 1：创建 `acc/runtime/` 包骨架

**具体操作**
- 创建 `acc/runtime/__init__.py`（空，后续按需添加 re-export）
- 创建各子模块空文件（`ledger_writer.py`、`scheduler.py`、`executor.py`、`invocation.py`、`dispatch_gate.py`、`payload.py`、`io.py`、`workflow_io.py`、`nested_workflow.py`）

**涉及文件**
- 新建：`acc/runtime/` 目录及 9 个 `.py` 文件

**预期结果**
- 包骨架可正常 import，无循环依赖

---

### 步骤 2：迁移 `FixedRunControlLedger` → `acc/runtime/ledger_writer.py`

**具体操作**
- 将 `FixedRunControlLedger`（L81–L572）完整迁移至 `acc/runtime/ledger_writer.py`
- 重命名为 `FixedRunControlLedgerWriter`
- 在 `transition_step` 中添加合法转换常量校验：

  ```python
  VALID_STEP_TRANSITIONS: dict[str | None, frozenset[str]] = {
      None:                   frozenset({"pending", "ready"}),
      "pending":              frozenset({"ready", "skipped", "cancelled"}),
      "ready":                frozenset({"dispatching", "waiting_interaction", "skipped", "cancelled"}),
      "dispatching":          frozenset({"running"}),
      "running":              frozenset({"success", "failed"}),
      "waiting_interaction":  frozenset({"ready", "skipped"}),
      "success":              frozenset(),
      "failed":               frozenset(),
      "skipped":              frozenset(),
      "cancelled":            frozenset(),
  }
  ```

  `transition_step` 在 `next_status not in VALID_STEP_TRANSITIONS[current.status]` 时 `raise ControlLedgerAuditError`。

- `ControlLedgerAuditError` 保留在 `ledger_writer.py`（或迁入 `acc/domain`，视现有引用决定）

**涉及文件**
- 新建：`acc/runtime/ledger_writer.py`
- 修改：`acc/app/core_v2_runtime.py`（删除对应段，添加 re-import）

**预期结果**
- `FixedRunControlLedgerWriter` 可独立 import，STRICT 状态机校验生效
- 旧名称 `FixedRunControlLedger` 通过 `acc/app/core_v2_runtime.py` 中的别名向后兼容

---

### 步骤 3：迁移 payload 序列化函数 → `acc/runtime/io.py`

**具体操作**
- 迁移以下函数至 `acc/runtime/io.py`：
  - `function_invocation_payload`（L2374）
  - `scope_frame_payload`（L2378）
  - `session_instance_payload`（L2394）
  - `artifact_bundle_payload`（L2404）
  - `run_record_payload`（L2408）
  - `event_record_payload`（L2415）
  - `failure_record_payload`（L2419）
  - `append_event`（L2353）
  - `append_runtime_error_to_stderr_log`（L2137）
  - `read_required_session_id`（L2090）
  - `read_required_artifact_bundle_id`（L2101）

- `sha256_json`（L2834）迁至 `acc/runtime/io.py`（或 `acc/store/__init__.py`，因 `acc/store` 已有 `sha256`）

**涉及文件**
- 新建：`acc/runtime/io.py`
- 修改：`acc/app/core_v2_runtime.py`

**预期结果**
- 序列化逻辑与运行时逻辑解耦，可单独测试

---

### 步骤 4：迁移 payload 绑定解析 → `acc/runtime/payload.py`

**具体操作**
- 迁移以下函数至 `acc/runtime/payload.py`：
  - `resolve_node_payload`（L1612）
  - `ResolvedNodePayload`（L1592）
  - `is_empty_runtime_input`（L1598）
  - `output_value_for_port`（L1769）
  - `output_port_ids`（L2227）
  - `materialized_output_port_ids`（L2237）
  - `binding_record`（L1782）
  - `control_main_aggregate_payload`（L1760）
  - `control_main_aggregate_record`（L1805）
  - `should_forward_main_output_on_control`（L1756）

**涉及文件**
- 新建：`acc/runtime/payload.py`
- 修改：`acc/app/core_v2_runtime.py`

**预期结果**
- payload 绑定解析可独立测试，不需要 async 运行时

---

### 步骤 5：迁移工作流输出 I/O → `acc/runtime/workflow_io.py`

**具体操作**
- 迁移至 `acc/runtime/workflow_io.py`：
  - `write_workflow_outputs`（L2192）
  - `read_child_workflow_outputs`（L2080）
  - `write_core_v2_run_summary`（L2280）
  - `node_summary_from_session_manifest`（L2317）
  - `put_result_store_value`（L2253）
  - `validate_artifact_contract`（L2112）
  - `reject_artifact_path_escape`（L2124）

**涉及文件**
- 新建：`acc/runtime/workflow_io.py`
- 修改：`acc/app/core_v2_runtime.py`

**预期结果**
- 工作流级别文件写入与节点级别执行分离

---

### 步骤 6：迁移节点执行逻辑 → `acc/runtime/executor.py`

**具体操作**
- 迁移至 `acc/runtime/executor.py`：
  - `execute_core_v2_node`（L1412）
  - `execute_core_v2_callable`（L1839）
  - `execute_hermetic_callable`（L2143）
  - `project_root_for_agent_sessions`（L1878）

- 在 `execute_core_v2_node` 中，将 `write_json(node_dir / ...)` 的密集写入段包裹为 `asyncio.to_thread` 调用。具体模式：

  ```python
  # 现有同步写
  write_json(node_dir / "agent_payload.json", agent_payload)
  write_json(node_dir / "input.json", agent_payload)
  ...

  # 重构后
  await asyncio.to_thread(_write_node_input_files, node_dir, agent_payload, ...)
  ```

  其中 `_write_node_input_files` 为私有同步函数，批量完成该段的所有 `write_json` 调用，避免多次切换线程池。

**涉及文件**
- 新建：`acc/runtime/executor.py`
- 修改：`acc/app/core_v2_runtime.py`

**预期结果**
- 节点执行逻辑独立，`asyncio.to_thread` 保护写入不阻塞事件循环

---

### 步骤 7：迁移嵌套工作流逻辑 → `acc/runtime/nested_workflow.py`

**具体操作**
- 迁移至 `acc/runtime/nested_workflow.py`：
  - `execute_workflow_function_callable`（L1885）
  - `resolve_node_workflow_binding`（L1956）
  - `resolve_workflow_call_input_payload`（L1977）
  - `apply_workflow_call_output_bindings`（L2006）
  - `resolve_workflow_function_path`（L2025）
  - `infer_project_root`（L2052）
  - `load_runtime_overlay_payloads`（L2060）
  - `workflow_resolution_candidates`（L2074）

**涉及文件**
- 新建：`acc/runtime/nested_workflow.py`
- 修改：`acc/app/core_v2_runtime.py`

**预期结果**
- 嵌套工作流的路径解析与 callable 执行分离

---

### 步骤 8：提取通用 `_dispatch_steps` → `acc/runtime/dispatch_gate.py`

**具体操作**

三个 dispatch 函数（L924–L1239）的共享骨架提取为：

```python
async def _dispatch_steps(
    run_dir: Path,
    *,
    step_filter_fn: Callable[
        [FixedRunControlLedgerWriter, tuple[PlanStep, ...]],
        tuple[PlanStep, ...]
    ],
    node_builder_fn: Callable[[Path, PlanStep], NodeInvocationSpec],
    template_override_fn: Callable[
        [WorkflowFunctionTemplate, dict[str, NodeInvocationSpec]],
        WorkflowFunctionTemplate
    ] | None = None,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    # --- 共享部分（原三函数 95 行完全相同）---
    template = _load_template_snapshot(run_dir)
    invocation = _load_function_invocation(run_dir)
    scope = _load_scope_frame(run_dir)
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Cannot dispatch steps without run_plan.json")
    steps = load_plan_steps(run_dir).value
    control_ledger = FixedRunControlLedgerWriter(
        run_dir=run_dir,
        run_id=invocation.run_id,
        run_plan=run_plan,
        steps_by_node_id={step.node_id: step for step in steps},
        plan_step_sequence=next_plan_step_transition_sequence(run_dir) - 1,
        dispatch_sequence=next_dispatch_transition_sequence(run_dir) - 1,
        decision_sequence=len(load_decisions(run_dir).value),
    )
    # --- 差异部分：step 过滤（注入）---
    ready_steps = step_filter_fn(control_ledger, steps)
    if not ready_steps:
        return {"status": "resuming", "dispatched_step_ids": []}
    # --- 差异部分：node 构建（注入）---
    dynamic_nodes = {
        step.node_id: node_builder_fn(run_dir, step)
        for step in ready_steps
    }
    runtime_template = (
        template_override_fn(template, dynamic_nodes)
        if template_override_fn is not None
        else template
    )
    # --- 共享执行循环 ---
    event_log_path = run_dir / "events.jsonl"
    result_store = FilesystemResultStore(run_dir.parent)
    outputs = _load_success_outputs(runtime_template, steps, run_dir)
    dispatched_step_ids: list[str] = []
    terminal_status = "resuming"
    try:
        for step in ready_steps:
            node = dynamic_nodes[step.node_id]
            await execute_core_v2_node_with_fixed_ledger(
                runtime_template, node, invocation, scope,
                result_store, outputs, event_log_path, callable_registry, control_ledger,
            )
            dispatched_step_ids.append(step.plan_step_id)
        latest_steps = load_plan_steps(run_dir).value
        if all(s.status == "success" for s in latest_steps):
            terminal_status = "success"
            write_workflow_outputs(runtime_template, invocation.run_id, run_dir, result_store, outputs)
            append_event(event_log_path, invocation.run_id, "workflow_completed")
    except Exception as exc:
        terminal_status = "failed"
        append_event(event_log_path, invocation.run_id, "workflow_failed", payload={"error": str(exc)})
    # --- 共享收尾写入 ---
    ended_at = utc_now_iso() if is_terminal_run_status(terminal_status) else None
    await asyncio.to_thread(_write_dispatch_final_records, run_dir, invocation, terminal_status, ended_at, runtime_template)
    return {"status": terminal_status, "dispatched_step_ids": dispatched_step_ids}
```

三个公开函数简化为：

```python
# resume_approved_human_gate_dispatch
async def resume_approved_human_gate_dispatch(run_dir, *, interaction_id, callable_registry=None):
    def filter_fn(ledger, steps):
        return tuple(s for s in steps if s.required_interaction_id == interaction_id and s.status == "ready")
    def builder_fn(run_dir, step):
        return NodeInvocationSpec(id=step.node_id, callable_ref=step.callable_ref)
    return await _dispatch_steps(run_dir, step_filter_fn=filter_fn, node_builder_fn=builder_fn, callable_registry=callable_registry)

# dispatch_ready_supervisor_plan_steps
async def dispatch_ready_supervisor_plan_steps(run_dir, *, callable_registry=None):
    return await _dispatch_steps(
        run_dir,
        step_filter_fn=_ready_supervisor_steps,
        node_builder_fn=_node_invocation_from_supervisor_step,
        template_override_fn=lambda t, nodes: replace(t, node_invocations={**t.node_invocations, **nodes}),
        callable_registry=callable_registry,
    )

# dispatch_ready_handoff_plan_steps
async def dispatch_ready_handoff_plan_steps(run_dir, *, callable_registry=None):
    return await _dispatch_steps(
        run_dir,
        step_filter_fn=_ready_handoff_steps,
        node_builder_fn=_node_invocation_from_handoff_step,
        template_override_fn=lambda t, nodes: replace(t, node_invocations={**t.node_invocations, **nodes}),
        callable_registry=callable_registry,
    )
```

`dispatch_gate.py` 还包含：
- `_load_template_snapshot`（L1337）
- `_load_function_invocation`（L1345）
- `_load_scope_frame`（L1367）
- `_load_success_outputs`（L1389）
- `_ready_supervisor_steps`（L1241）
- `_ready_handoff_steps`（L1264）
- `_dependencies_succeeded`（L1287）
- `_node_invocation_from_supervisor_step`（L1297）
- `_node_invocation_from_handoff_step`（L1307）
- `_load_dynamic_step_payload`（L1317）

**涉及文件**
- 新建：`acc/runtime/dispatch_gate.py`
- 修改：`acc/app/core_v2_runtime.py`（保留公开函数名的 re-export）

**预期结果**
- 三个 dispatch 函数从 ~315 行（重复代码占 ~285 行）压缩为 ~45 行调用代码 + `_dispatch_steps` 一份实现 ~70 行

---

### 步骤 9：迁移调度器循环 → `acc/runtime/scheduler.py`

**具体操作**
- 迁移至 `acc/runtime/scheduler.py`：
  - `run_ready_queue_execution`（L780）
  - `execute_core_v2_node_with_fixed_ledger`（L885）
  - `workflow_max_concurrency`（L874）

**涉及文件**
- 新建：`acc/runtime/scheduler.py`
- 修改：`acc/app/core_v2_runtime.py`

**预期结果**
- DAG 调度循环独立，可单独测试和替换

---

### 步骤 10：迁移顶层入口 → `acc/runtime/invocation.py`

**具体操作**
- 迁移至 `acc/runtime/invocation.py`：
  - `run_core_v2_workflow_path`（L575）
  - `run_workflow_function_invocation`（L629）
  - 常量 `FIXED_CONTROL_POLICY_ID`、`MISSING_PORT_VALUE`

**涉及文件**
- 新建：`acc/runtime/invocation.py`
- 修改：`acc/app/core_v2_runtime.py`（最终仅剩 re-export 约 30 行）

**预期结果**
- 所有运行时入口迁移完成，`core_v2_runtime.py` 成为纯过渡包装

---

### 步骤 11：同步 I/O 全面审计与 `asyncio.to_thread` 补全

**具体操作**

在 async 路径上识别需要包裹的位置：

| 位置 | 函数 | 处理方式 |
|------|------|----------|
| `run_workflow_function_invocation` L658–L678 | 多个 `write_json` 初始化写入 | 合并为 `_write_run_init_files(run_dir, ...)` 再 `asyncio.to_thread` |
| `FixedRunControlLedgerWriter.write_audit` | 内部所有 `append_*` 写入 | `write_audit` 已在 async caller 的 `audit_lock` 下调用，改为接受 `async def` operation，或在 `write_audit` 内部用 `asyncio.get_event_loop().run_in_executor` |
| `execute_core_v2_node` 节点输入/输出写入 | `write_json` × 6 | 批量合并为 `asyncio.to_thread(_write_node_input_files, ...)` 与 `asyncio.to_thread(_write_node_output_files, ...)` |
| `dispatch_gate._dispatch_steps` 收尾写入 | `write_json` × 3 | 合并为 `asyncio.to_thread(_write_dispatch_final_records, ...)` |

读取路径（`_load_template_snapshot`、`_load_function_invocation` 等）在 async 函数的最开头同步段执行，此时没有并发任务等待，可暂时保持同步。如将来高并发场景有需要，可进一步包裹。

**涉及文件**
- `acc/runtime/invocation.py`
- `acc/runtime/executor.py`
- `acc/runtime/ledger_writer.py`
- `acc/runtime/dispatch_gate.py`

**预期结果**
- asyncio 事件循环不被同步文件写入阻塞，节点并发执行的真实并发度得到保证

---

### 步骤 12：补充单元测试

**具体操作**

| 测试文件 | 覆盖目标 |
|----------|----------|
| `tests/runtime/test_ledger_writer.py` | STRICT 状态机：所有合法转换通过，所有非法转换抛 `ControlLedgerAuditError` |
| `tests/runtime/test_payload.py` | `resolve_node_payload` 的 static_input / workflow_input / data_edge / control_main 各分支 |
| `tests/runtime/test_dispatch_gate.py` | `_dispatch_steps` 通用骨架：成功路径、失败路径、empty ready_steps 早退 |
| `tests/runtime/test_scheduler.py` | `run_ready_queue_execution`：cancellation、waiting_interaction 暂停、DAG 失败传播 |

**涉及文件**
- 新建：`tests/runtime/` 目录及 4 个测试文件

**预期结果**
- 核心路径测试覆盖；与现有 `tests/` 目录结构一致

---

### 步骤 13：更新 `acc/app/core_v2_runtime.py` 为过渡包装

**具体操作**
- 删除所有实现代码，保留约 30 行 re-export：
  ```python
  # DEPRECATED: import directly from acc.runtime.*
  from acc.runtime.invocation import run_core_v2_workflow_path, run_workflow_function_invocation
  from acc.runtime.ledger_writer import FixedRunControlLedgerWriter as FixedRunControlLedger
  from acc.runtime.scheduler import run_ready_queue_execution
  from acc.runtime.dispatch_gate import (
      resume_approved_human_gate_dispatch,
      dispatch_ready_supervisor_plan_steps,
      dispatch_ready_handoff_plan_steps,
  )
  ...
  ```
- 在 `acc/runtime/__init__.py` 中导出稳定公共接口

**涉及文件**
- 修改：`acc/app/core_v2_runtime.py`
- 修改：`acc/runtime/__init__.py`

**预期结果**
- 所有现有调用方（无需修改）仍正常工作，新代码直接从 `acc.runtime.*` 导入

---

## 文件变更清单

### 新建文件

| 文件 | 主要内容 | 行数估算 |
|------|----------|----------|
| `acc/runtime/__init__.py` | 公共接口 re-export | ~30 |
| `acc/runtime/ledger_writer.py` | `FixedRunControlLedgerWriter` + 状态机常量 | ~520 |
| `acc/runtime/scheduler.py` | `run_ready_queue_execution` + `execute_core_v2_node_with_fixed_ledger` + `workflow_max_concurrency` | ~100 |
| `acc/runtime/executor.py` | `execute_core_v2_node` + `execute_core_v2_callable` + `execute_hermetic_callable` + `project_root_for_agent_sessions` | ~230 |
| `acc/runtime/invocation.py` | `run_core_v2_workflow_path` + `run_workflow_function_invocation` + 常量 | ~200 |
| `acc/runtime/dispatch_gate.py` | `_dispatch_steps` + 三个公开 dispatch 函数 + 辅助私有函数 | ~210 |
| `acc/runtime/payload.py` | `resolve_node_payload` + binding 辅助 + output_port_ids | ~200 |
| `acc/runtime/io.py` | payload 序列化 + `append_event` + 读取辅助 | ~130 |
| `acc/runtime/workflow_io.py` | `write_workflow_outputs` + run_summary + artifact 辅助 | ~160 |
| `acc/runtime/nested_workflow.py` | `execute_workflow_function_callable` + 路径解析 | ~190 |
| `tests/runtime/__init__.py` | 空 | 1 |
| `tests/runtime/test_ledger_writer.py` | 状态机测试 | ~80 |
| `tests/runtime/test_payload.py` | payload 绑定测试 | ~100 |
| `tests/runtime/test_dispatch_gate.py` | dispatch 骨架测试 | ~80 |
| `tests/runtime/test_scheduler.py` | 调度器测试 | ~100 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `acc/app/core_v2_runtime.py` | 删除所有实现，替换为 re-export（从 2,422 行压缩至 ~40 行） |
| `acc/engine/control_ledger.py` | 添加 `FixedRunControlLedgerWriter` re-export（向后兼容） |

### 删除文件

本次重构阶段不删除任何文件。`acc/app/core_v2_runtime.py` 保留为过渡包装，待所有调用方迁移完成后在后续 PR 中删除。

---

## 测试计划

### 关键测试用例

**`test_ledger_writer.py`**
- `test_strict_mode_illegal_transition`：从 `running` 直接跳 `pending` 抛 `ControlLedgerAuditError`
- `test_strict_mode_all_legal_transitions`：覆盖状态机所有合法边
- `test_initialize_writes_run_plan_and_steps`：初始化后磁盘上有 `run_plan.json` 和 `plan_steps.jsonl`
- `test_complete_dispatch_requires_session_manifest`：缺少 manifest 时抛 `ControlLedgerAuditError`

**`test_payload.py`**
- `test_resolve_static_input`：`node.overrides.static_input` 正确注入
- `test_resolve_workflow_input_binding`：工作流输入 binding 正确传递
- `test_resolve_data_edge`：data edge 值正确注入目标 port
- `test_control_main_single_source`：单 control 前驱 main 值直接传递
- `test_control_main_multi_source_aggregate`：多 control 前驱生成 aggregate payload
- `test_missing_required_binding_raises`：缺少 required binding 抛 `AccError`

**`test_dispatch_gate.py`**
- `test_dispatch_steps_no_ready_returns_resuming`：`step_filter_fn` 返回空元组时立即返回 `{"status": "resuming", ...}`
- `test_dispatch_steps_success_path`：所有 step 成功后 terminal_status 为 `"success"`
- `test_dispatch_steps_failure_sets_failed`：节点抛异常后 terminal_status 为 `"failed"`

**`test_scheduler.py`**
- `test_cancellation_stops_launching`：`should_cancel()` 返回 True 后不再启动新任务
- `test_waiting_interaction_pauses_scheduler`：节点返回 `"waiting_interaction"` 后调度停止
- `test_failed_node_skips_descendants`：节点失败后 DAGScheduler 的后代被 skip

---

## 风险与缓解

| 风险 | 可能性 | 缓解措施 |
|------|--------|----------|
| 过渡包装遗漏 re-export 导致调用方 ImportError | 中 | 步骤 13 后运行全量 `pytest -x` 快速发现 |
| `asyncio.to_thread` 批量合并后某写入失败难以定位 | 低 | 私有写入函数内部保持原有错误信息，不捕获异常 |
| STRICT 状态机与现有代码已有隐性非法转换 | 低 | 先写测试覆盖当前行为，再添加校验；监控 `ControlLedgerAuditError` 日志 |
| 循环依赖（`scheduler` 依赖 `executor`，`executor` 依赖 `payload`，`payload` 依赖 `io`）| 低 | 依赖方向单向：`invocation` → `scheduler` → `executor` → `payload` → `io`；`dispatch_gate` → `executor`、`payload`；无回环 |
| `FixedRunControlLedger` 旧名称在 type annotation 中散布 | 中 | 步骤 2 完成后用 `grep -r FixedRunControlLedger` 扫描，批量替换或添加 `TypeAlias` |

---

## 依赖关系

```
步骤 1（创建包骨架）
  ↓
步骤 2（ledger_writer）   步骤 3（io）   步骤 4（payload）
  ↓                         ↓               ↓
步骤 5（workflow_io）←──────┘               │
  ↓                                         │
步骤 6（executor）←──────────────────────────┘
  ↓
步骤 7（nested_workflow）   步骤 9（scheduler）
  ↓                              ↓
步骤 8（dispatch_gate）←──────────┘
  ↓
步骤 10（invocation）
  ↓
步骤 11（asyncio.to_thread 审计）
  ↓
步骤 12（测试）
  ↓
步骤 13（core_v2_runtime 瘦化）
```

步骤 2、3、4 可并行执行。步骤 5、6、7 可并行执行（在各自前置完成后）。

---

## 预估工作量

| 步骤 | 类型 | 估算时间 |
|------|------|----------|
| 步骤 1：创建包骨架 | 机械 | 0.5h |
| 步骤 2：ledger_writer 迁移 + 重命名 + STRICT 状态机 | 编码 + 逻辑 | 2h |
| 步骤 3：io.py 迁移 | 机械 | 0.5h |
| 步骤 4：payload.py 迁移 | 机械 | 0.5h |
| 步骤 5：workflow_io.py 迁移 | 机械 | 0.5h |
| 步骤 6：executor.py 迁移 + asyncio.to_thread | 编码 | 1.5h |
| 步骤 7：nested_workflow.py 迁移 | 机械 | 0.5h |
| 步骤 8：dispatch_gate + _dispatch_steps 提取 | 核心重构 | 2.5h |
| 步骤 9：scheduler.py 迁移 | 机械 | 0.5h |
| 步骤 10：invocation.py 迁移 | 机械 | 0.5h |
| 步骤 11：async I/O 全面补全 | 编码 | 1.5h |
| 步骤 12：测试编写 | 测试 | 3h |
| 步骤 13：core_v2_runtime 瘦化 | 机械 | 0.5h |
| **合计** | | **~14h** |

主要时间集中在步骤 2（STRICT 状态机设计）和步骤 8（_dispatch_steps 通用骨架提取），其余步骤均为机械迁移。
