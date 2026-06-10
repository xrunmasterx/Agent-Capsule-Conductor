# Domain 模型拆分：domain.py → models / serialization / validation

## 现状分析

### 涉及文件及行数

| 文件 | 行数 | 说明 |
|------|------|------|
| `acc/domain.py` | 1 411 | 主目标：包含 62 个 frozen dataclass、所有序列化函数、所有验证函数 |
| `acc/binding/__init__.py` | 34 | Phase 1 skeleton，仅导出 Selector + ProvenanceObject |
| `acc/binding/selector.py` | 120 | Selector ADT，纯 Phase 1 骨架，无运行时消费者 |
| `acc/binding/provenance.py` | 未知 | ProvenanceObject，Phase 1 骨架 |
| `acc/ports/__init__.py` | 6 | 空壳，`__all__: list[str] = []` |
| `acc/migration/__init__.py` | 2 | 空壳，仅有注释 |

### 当前问题（来自审计报告及现状代码）

1. **单文件过大**：1 411 行混杂三种不同职责——数据定义、序列化、验证，违反单一职责原则。
2. **V2 Binding 死代码（第 837–886 行）**：注释明确写明"No current product runtime resolver consumes these V2 shapes"，`InputBinding = NodeInputBindingV2` 别名无任何消费者，`TYPE_CHECKING` guard 引用 `acc.binding.selector.Selector` 从未在运行时路径中实例化。
3. **空壳模块**：`acc/ports/__init__.py`（6 行占位）、`acc/migration/__init__.py`（2 行占位）、`acc/binding/` 整个 Phase 1 骨架从无运行时消费，是决策确认的删除候选。
4. **导入爆炸**：76 个文件直接 `from acc.domain import`，任何改动导致全局影响。
5. **常量与异常混入数据层**：`AccError`、`CORE_V2_SCHEMA_VERSION`、`CONTROL_LEDGER_SCHEMA_VERSION`、`CORE_CALLABLE_KINDS`、`EXECUTABLE_METADATA_KEYS` 与纯数据模型混放，不利于独立测试。

---

## 重构目标

### 目标架构

```
acc/
  models.py          ← 所有 frozen dataclass + Literal 类型 + 常量 + AccError
  serialization.py   ← workflow_function_template_to/from_dict, control_ledger_to_dict
                        及所有私有 _xxx_from_dict / _to_jsonable 辅助函数
  validation.py      ← validate_core_v2_* 公开函数
                        及所有私有 _validate_* / _reject_* 辅助函数
  domain.py          ← 【删除】
```

所有 76 个 `from acc.domain import` 改写为从对应新模块导入。

### 关键设计决策

- **无向后兼容 re-export**：`acc/domain.py` 直接删除，不留 shim，接受全量 import 改写。
- **死代码随删除 domain.py 一并清除**：
  - `NodeInputBindingV2`, `WorkflowInputBindingV2`, `NodeOutputBindingV2`, `WorkflowOutputBindingV2`, `WorkflowCallInputBindingV2`, `InputBinding`（第 837–886 行）。
  - `acc/binding/` 整包（`selector.py`, `provenance.py`, `__init__.py`）。
  - `acc/ports/__init__.py`（空壳）。
  - `acc/migration/__init__.py`（空壳；`acc/migration/graph_importer.py` 保留，仅从 `acc.models` 改写导入）。
- **AgentCapabilities.as_dict / effective_keys 方法保留在 models.py 内**，因为它们是该 dataclass 的行为方法，不属于序列化层。
- **私有辅助函数跟随公开函数**：`_to_jsonable`, `_required_string`, `_required_dict`, `_dict_or_empty`, `_optional_dict`, `_required_list` 全部移入 `serialization.py`；`_reject_executable_metadata`, `_validate_artifact_contract`, `_validate_permission_profile` 全部移入 `validation.py`。

---

## 详细实施步骤

### 步骤 1：新建 acc/models.py

**具体操作**：
- 复制以下内容到新文件（不做逻辑修改）：
  - 所有 `Literal` 类型别名（第 10–46 行）
  - 所有模块级常量：`CORE_V2_SCHEMA_VERSION`, `CONTROL_LEDGER_SCHEMA_VERSION`, `CORE_CALLABLE_KINDS`, `EXECUTABLE_METADATA_KEYS`（第 47–83 行）
  - `AccError` 异常类（第 86–87 行）
  - 所有 62 个 frozen dataclass（第 90–748 行，含 `AgentCapabilities` 方法）
  - 监控用 Literal 类型：`SupervisorDecisionKind`, `InteractionKind`, `InteractionStatus`, `SupervisorPlanStatus`, `WakeupReason`, `SessionHealth`, `RecoveryLevel`（第 750–756 行）
  - `ClassTemplate` 类型别名（第 270 行）
  - `WorkflowCallBinding` / `WorkflowReturnBinding` 别名（第 307–308 行）
  - `ControlPolicyMode`, `RunPlanSource`, `RunPlanStatus`, `PlanStepSource`, `PlanStepStatus`, `DispatchStatus`, `DecisionKind`, `ReplayMode`, `HandoffMode`, `HandoffAcceptanceStatus`, `ApprovalRejectStatus` Literal（第 471–510 行）
- **排除**：V2 Binding dataclass（第 850–886 行）和 `InputBinding` 别名（第 886 行）

**分组组织**（文件内注释分节）：

```
# ── Literals & Constants ──────────────────────────────────────────────────────
# ── Exceptions ────────────────────────────────────────────────────────────────
# ── Workflow Structure Models ─────────────────────────────────────────────────
#    PortContract, ControlEdge, DataEndpoint, DataEdge,
#    WorkflowInputBinding, WorkflowOutputBinding, WorkflowFunctionTemplate
# ── Policy & Permission Models ───────────────────────────────────────────────
#    PermissionProfile, RetryPolicy, TimeoutPolicy, RuntimePolicy,
#    PromptPolicy, ArtifactContract, InvocationPolicy, NodeControlPolicy
# ── Callable & Node Models ───────────────────────────────────────────────────
#    CallableRef, CallableOverride, AgentClassTemplate, ToolClassTemplate,
#    ClassTemplate, NodeInputBinding, NodeOutputBinding,
#    WorkflowCallInputBinding, WorkflowCallOutputBinding,
#    NodeInvocationSpec, ExecutionNode, ExecutionPlan
# ── Environment & Workspace Models ───────────────────────────────────────────
#    EnvironmentBinding, EnvironmentFrame, ScopeFrame, PermissionProfile
# ── Run & Session Models ─────────────────────────────────────────────────────
#    FunctionInvocation, SessionInstance, ResultStoreAddress,
#    NodeInvocationRun, RunRecord, EventRecord, ArtifactBundle
# ── Control Ledger Models ────────────────────────────────────────────────────
#    RunPlan, PlanStep, DispatchEnvelope, DecisionRecord, ReplayPolicy,
#    PlanStepTransitionRecord, DispatchTransitionRecord, ControlEventRecord,
#    FailureRecord, ControlPolicy
# ── Interaction & Supervisor Models ──────────────────────────────────────────
#    HandoffControlPolicy, HandoffRequest, WakeupRequest, InteractionRequest,
#    RosterEntry, SupervisorRoster, DynamicInvocationIntent, SupervisorPlan,
#    DynamicInvocationProposal, SupervisorDecision
# ── Event Models ─────────────────────────────────────────────────────────────
#    WorkflowEvent, NodeEvent, AgentCapabilities
```

**涉及文件**：新建 `acc/models.py`
**预期结果**：约 830 行，可独立 `import` 测试，零循环依赖

---

### 步骤 2：新建 acc/serialization.py

**具体操作**：
- 从 `acc/models.py` 导入所需类型
- 迁移以下函数（完整函数体，不做逻辑修改）：
  - `_to_jsonable(value)` — 通用递归 JSON 化（第 1069–1078 行）
  - `control_ledger_to_dict(value)` — ControlLedger 序列化入口（第 1081–1082 行）
  - `workflow_function_template_to_dict(template)` — 公开 API（第 889–914 行）
  - `node_invocation_to_wire_dict(node)` — 公开 API（第 917–925 行）
  - `workflow_function_template_from_dict(payload)` — 公开 API（第 928–975 行）
  - `execution_plan_to_dict(plan)` — 公开 API（第 978–979 行）
  - `_node_invocation_from_dict(payload)` — 内部（第 1085–1125 行）
  - `_callable_ref_from_dict(payload)` — 内部（第 1128–1134 行）
  - `_callable_override_from_dict(value)` — 内部（第 1137–1148 行）
  - `_node_control_policy_from_dict(value)` — 内部（第 1151–1166 行）
  - `_permission_profile_from_dict(value)` — 内部（第 1169–1181 行）
  - `_runtime_policy_from_dict(value)` — 内部（第 1184–1198 行）
  - `_prompt_policy_from_dict(value)` — 内部（第 1201–1211 行）
  - `_artifact_contract_from_dict(value)` — 内部（第 1214–1219 行）
  - `_invocation_policy_from_dict(value)` — 内部（第 1222–1230 行）
  - `_node_input_binding_from_dict(payload)` — 内部（第 1233–1243 行）
  - `_node_output_binding_from_dict(payload)` — 内部（第 1246–1255 行）
  - `_workflow_input_binding_from_dict(payload)` — 内部（第 1258–1264 行）
  - `_workflow_output_binding_from_dict(payload)` — 内部（第 1267–1273 行）
  - `_workflow_call_input_binding_from_dict(payload)` — 内部（第 1276–1286 行）
  - `_workflow_call_output_binding_from_dict(payload)` — 内部（第 1289–1295 行）
  - `_control_edge_from_dict(payload)` — 内部（第 1298–1304 行）
  - `_data_edge_from_dict(payload)` — 内部（第 1307–1312 行）
  - `_data_endpoint_from_dict(payload)` — 内部（第 1315–1319 行）
  - `_port_map_from_dict(value, direction)` — 内部（第 1322–1334 行）
  - `_node_ports_from_dict(payload)` — 内部（第 1337–1348 行）
  - `_required_string(payload, key)` — 工具函数（第 1377–1381 行）
  - `_required_dict(value, label)` — 工具函数（第 1384–1387 行）
  - `_dict_or_empty(value, label)` — 工具函数（第 1390–1395 行）
  - `_optional_dict(value, label)` — 工具函数（第 1398–1403 行）
  - `_required_list(value, label)` — 工具函数（第 1406–1411 行）

**涉及文件**：新建 `acc/serialization.py`
**预期结果**：约 350 行，所有序列化测试 (`test_core_v2_serialization.py`) 改为 `from acc.serialization import ...`

---

### 步骤 3：新建 acc/validation.py

**具体操作**：
- 从 `acc/models.py` 导入所需类型
- 迁移以下函数：
  - `validate_core_v2_workflow_function_template(template)` — 公开 API（第 982–1004 行）
  - `validate_core_v2_execution_plan(plan)` — 公开 API（第 1007–1022 行）
  - `validate_core_v2_node_invocation_spec(node, *, node_ids)` — 公开 API（第 1025–1059 行）
  - `validate_core_v2_callable_ref(ref)` — 公开 API（第 1062–1066 行）
  - `_reject_executable_metadata(payload, label)` — 内部（第 1351–1356 行）
  - `_validate_artifact_contract(contract, label)` — 内部（第 1359–1363 行）
  - `_validate_permission_profile(profile, label)` — 内部（第 1366–1374 行）

**涉及文件**：新建 `acc/validation.py`
**预期结果**：约 80 行，`test_core_v2_validation.py` 改为 `from acc.validation import ...`

---

### 步骤 4：删除死代码

**具体操作**：
1. 删除 `acc/domain.py` 第 837–886 行（V2 Binding dataclasses + `InputBinding` 别名）：
   - `NodeInputBindingV2`, `WorkflowInputBindingV2`, `NodeOutputBindingV2`, `WorkflowOutputBindingV2`, `WorkflowCallInputBindingV2`, `InputBinding`
   - 同时删除文件顶部 `if TYPE_CHECKING: from acc.binding.selector import Selector`（第 7–9 行）
2. 删除 `acc/binding/` 整个目录：
   - `acc/binding/__init__.py`
   - `acc/binding/selector.py`
   - `acc/binding/provenance.py`
3. 删除 `acc/ports/__init__.py`（空壳）
4. 删除 `acc/migration/__init__.py`（空壳；`graph_importer.py` 保留）

**验证方式**：搜索全库确认无消费者：`grep -r "NodeInputBindingV2\|InputBinding\|WorkflowInputBindingV2\|from acc.binding\|from acc.ports" --include="*.py"`

**涉及文件**：见上
**预期结果**：删除约 200 行死代码，消除对 `acc.binding` 的虚假依赖

---

### 步骤 5：全量 import 改写

**具体操作**：对所有 76 个消费文件，将 `from acc.domain import X` 拆分为从 `acc.models`、`acc.serialization`、`acc.validation` 的对应导入。详见下方 [文件变更清单 — 修改文件]。

**规则**：
- 所有 dataclass / Literal / 常量 / AccError → `from acc.models import`
- `workflow_function_template_to_dict`, `workflow_function_template_from_dict`, `node_invocation_to_wire_dict`, `execution_plan_to_dict`, `control_ledger_to_dict` → `from acc.serialization import`
- `validate_core_v2_*` 系列 → `from acc.validation import`

**涉及文件**：见下方清单
**预期结果**：全库无 `from acc.domain import`，`mypy --strict` 通过

---

### 步骤 6：删除 acc/domain.py

**具体操作**：确认步骤 5 完成（全量 import 改写）且测试绿色后，`git rm acc/domain.py`

**预期结果**：文件系统中不再存在 `acc/domain.py`

---

## 文件变更清单

### 新建文件

| 文件 | 行数（估计） | 内容 |
|------|------------|------|
| `acc/models.py` | ~830 | 所有 dataclass + Literal + 常量 + AccError |
| `acc/serialization.py` | ~350 | to_dict / from_dict 系列 |
| `acc/validation.py` | ~80 | validate_core_v2_* 系列 |

---

### 修改文件（import 改写映射）

#### acc/callable_runner.py
```python
# 旧
from acc.domain import (AccError, AgentClassTemplate, NodeInvocationSpec,
                        PermissionProfile, ScopeFrame, SessionInstance)
# 新
from acc.models import (AccError, AgentClassTemplate, NodeInvocationSpec,
                        PermissionProfile, ScopeFrame, SessionInstance)
```

#### acc/callable_registry.py
```python
# 旧
from acc.domain import (AccError, AgentClassTemplate, CallableRef, ClassTemplate,
                        PermissionProfile, PortContract, ToolClassTemplate)
# 新
from acc.models import (AccError, AgentClassTemplate, CallableRef, ClassTemplate,
                        PermissionProfile, PortContract, ToolClassTemplate)
```

#### acc/graphops.py
```python
# 旧
from acc.domain import CORE_V2_SCHEMA_VERSION
# 新
from acc.models import CORE_V2_SCHEMA_VERSION
```

#### acc/control_ledger_codec.py
```python
# 旧
from acc.domain import (CORE_CALLABLE_KINDS, EXECUTABLE_METADATA_KEYS, AccError,
                        CallableRef, ControlEventRecord, ControlPolicy, ControlPolicyMode,
                        DecisionKind, DecisionRecord, DispatchEnvelope, DispatchStatus,
                        DispatchTransitionRecord, PlanStep, PlanStepSource, PlanStepStatus, ...)
# 新
from acc.models import (CORE_CALLABLE_KINDS, EXECUTABLE_METADATA_KEYS, AccError,
                        CallableRef, ControlEventRecord, ControlPolicy, ControlPolicyMode,
                        DecisionKind, DecisionRecord, DispatchEnvelope, DispatchStatus,
                        DispatchTransitionRecord, PlanStep, PlanStepSource, PlanStepStatus, ...)
```

#### acc/migration/graph_importer.py
```python
# 旧
from acc.domain import CORE_V2_SCHEMA_VERSION, AccError
# 新
from acc.models import CORE_V2_SCHEMA_VERSION, AccError
```

#### acc/engine/__init__.py
```python
# 旧
from acc.domain import (CORE_V2_SCHEMA_VERSION, AccError, ArtifactContract,
                        CallableOverride, CallableRef, ControlEdge, DataEdge, DataEndpoint,
                        ExecutionNode, ExecutionPlan, InvocationPolicy, NodeControlPolicy,
                        NodeInputBinding, NodeInvocationSpec, NodeOutputBinding,
                        PermissionProfile, PortContract, PromptPolicy, RetryPolicy,
                        RuntimePolicy, TimeoutPolicy, WorkflowCallInputBinding,
                        WorkflowCallOutputBinding, WorkflowFunctionTemplate,
                        WorkflowInputBinding, WorkflowOutputBinding,
                        validate_core_v2_workflow_function_template)
# 新
from acc.models import (CORE_V2_SCHEMA_VERSION, AccError, ArtifactContract,
                        CallableOverride, CallableRef, ControlEdge, DataEdge, DataEndpoint,
                        ExecutionNode, ExecutionPlan, InvocationPolicy, NodeControlPolicy,
                        NodeInputBinding, NodeInvocationSpec, NodeOutputBinding,
                        PermissionProfile, PortContract, PromptPolicy, RetryPolicy,
                        RuntimePolicy, TimeoutPolicy, WorkflowCallInputBinding,
                        WorkflowCallOutputBinding, WorkflowFunctionTemplate,
                        WorkflowInputBinding, WorkflowOutputBinding)
from acc.validation import validate_core_v2_workflow_function_template
```

#### acc/engine/control_ledger.py
```python
# 旧
from acc.domain import (CONTROL_LEDGER_SCHEMA_VERSION, AccError, ExecutionPlan,
                        PlanStep, PlanStepStatus, RunPlan)
# 新
from acc.models import (CONTROL_LEDGER_SCHEMA_VERSION, AccError, ExecutionPlan,
                        PlanStep, PlanStepStatus, RunPlan)
```

#### acc/engine/handoff.py
```python
# 旧
from acc.domain import (AccError, CallableRef, DecisionRecord, HandoffControlPolicy,
                        HandoffRequest, PlanStep, RunPlan, WorkflowFunctionTemplate)
# 新
from acc.models import (AccError, CallableRef, DecisionRecord, HandoffControlPolicy,
                        HandoffRequest, PlanStep, RunPlan, WorkflowFunctionTemplate)
```

#### acc/engine/supervisor.py
```python
# 旧
from acc.domain import (AccError, CallableRef, ControlPolicy, DecisionRecord,
                        DynamicInvocationIntent, DynamicInvocationProposal, PlanStep,
                        RunPlan, SupervisorDecision, SupervisorPlan, SupervisorRoster)
# 新
from acc.models import (AccError, CallableRef, ControlPolicy, DecisionRecord,
                        DynamicInvocationIntent, DynamicInvocationProposal, PlanStep,
                        RunPlan, SupervisorDecision, SupervisorPlan, SupervisorRoster)
```

#### acc/engine/workflow_validation.py
```python
# 旧
from acc.domain import (CallableRef, NodeInvocationSpec, WorkflowFunctionTemplate,
                        WorkflowInputBinding)
# 新
from acc.models import (CallableRef, NodeInvocationSpec, WorkflowFunctionTemplate,
                        WorkflowInputBinding)
```

#### acc/runtime/policy.py
```python
# 旧
from acc.domain import AccError
# 新
from acc.models import AccError
```

#### acc/runtime/__init__.py
```python
# 旧
from acc.domain import AccError, PermissionProfile
# 新
from acc.models import AccError, PermissionProfile
```

#### acc/utils.py
```python
# 旧
from acc.domain import AccError
# 新
from acc.models import AccError
```

#### acc/store/__init__.py
```python
# 旧
from acc.domain import AccError, EnvironmentBinding, SessionInstance
# 新
from acc.models import AccError, EnvironmentBinding, SessionInstance
```

#### acc/store/control_ledger.py
```python
# 旧
from acc.domain import (AccError, ControlEventRecord, DecisionRecord, DispatchEnvelope,
                        DispatchTransitionRecord, PlanStep, PlanStepTransitionRecord,
                        RunPlan, control_ledger_to_dict)
# 新
from acc.models import (AccError, ControlEventRecord, DecisionRecord, DispatchEnvelope,
                        DispatchTransitionRecord, PlanStep, PlanStepTransitionRecord, RunPlan)
from acc.serialization import control_ledger_to_dict
```

#### acc/app/graphops_v3.py
```python
# 旧
from acc.domain import AccError, AgentClassTemplate
# 新
from acc.models import AccError, AgentClassTemplate
```

#### acc/app/human_gate_service.py
```python
# 旧
from acc.domain import AccError, DecisionRecord
# 新
from acc.models import AccError, DecisionRecord
```

#### acc/app/callable_refs.py
```python
# 旧
from acc.domain import AccError, WorkflowFunctionTemplate
# 新
from acc.models import AccError, WorkflowFunctionTemplate
```

#### acc/app/agent_sessions.py
```python
# 旧
from acc.domain import (AccError, AgentClassTemplate, CallableRef, DecisionRecord,
                        NodeInvocationSpec, PermissionProfile, ScopeFrame, SessionInstance)
# 新
from acc.models import (AccError, AgentClassTemplate, CallableRef, DecisionRecord,
                        NodeInvocationSpec, PermissionProfile, ScopeFrame, SessionInstance)
```

#### acc/app/invocation.py
```python
# 旧
from acc.domain import (AccError, AgentClassTemplate, CallableRef, EnvironmentFrame,
                        NodeInvocationSpec)
# 新
from acc.models import (AccError, AgentClassTemplate, CallableRef, EnvironmentFrame,
                        NodeInvocationSpec)
```

#### acc/app/interactions.py
```python
# 旧
from acc.domain import AccError, InteractionKind, InteractionRequest
# 新
from acc.models import AccError, InteractionKind, InteractionRequest
```

#### acc/app/human_gate.py
```python
# 旧
from acc.domain import AccError, InteractionRequest, NodeInvocationSpec
# 新
from acc.models import AccError, InteractionRequest, NodeInvocationSpec
```

#### acc/app/bundle.py
```python
# 旧
from acc.domain import NodeInvocationSpec, WorkflowFunctionTemplate
# 新
from acc.models import NodeInvocationSpec, WorkflowFunctionTemplate
```

#### acc/app/core_v2_runtime.py
```python
# 旧
from acc.domain import (AccError, ArtifactBundle, CallableOverride, DecisionRecord,
                        DispatchEnvelope, DispatchTransitionRecord, EventRecord,
                        ExecutionPlan, FailureRecord, FunctionInvocation, NodeInvocationSpec,
                        PlanStep, PlanStepTransitionRecord, ResultStoreAddress, RunPlan,
                        RunPlanStatus, RunRecord, ScopeFrame, SessionInstance,
                        WorkflowFunctionTemplate, workflow_function_template_from_dict,
                        workflow_function_template_to_dict)
# 新
from acc.models import (AccError, ArtifactBundle, CallableOverride, DecisionRecord,
                        DispatchEnvelope, DispatchTransitionRecord, EventRecord,
                        ExecutionPlan, FailureRecord, FunctionInvocation, NodeInvocationSpec,
                        PlanStep, PlanStepTransitionRecord, ResultStoreAddress, RunPlan,
                        RunPlanStatus, RunRecord, ScopeFrame, SessionInstance,
                        WorkflowFunctionTemplate)
from acc.serialization import (workflow_function_template_from_dict,
                               workflow_function_template_to_dict)
```

#### acc/app/run_lifecycle.py
```python
# 旧
from acc.domain import AccError, PlanStep, PlanStepTransitionRecord
# 新
from acc.models import AccError, PlanStep, PlanStepTransitionRecord
```

#### acc/app/node_invocation.py
```python
# 旧
from acc.domain import AccError
# 新
from acc.models import AccError
```

#### acc/app/handoff.py
```python
# 旧
from acc.domain import (AccError, HandoffControlPolicy, HandoffRequest, PlanStep,
                        PlanStepTransitionRecord, RunPlan, WorkflowFunctionTemplate,
                        control_ledger_to_dict)
# 新
from acc.models import (AccError, HandoffControlPolicy, HandoffRequest, PlanStep,
                        PlanStepTransitionRecord, RunPlan, WorkflowFunctionTemplate)
from acc.serialization import control_ledger_to_dict
```

#### acc/app/core_v2_loader.py
```python
# 旧
from acc.domain import WorkflowFunctionTemplate
# 新
from acc.models import WorkflowFunctionTemplate
```

#### acc/app/workbench_adapter.py
```python
# 旧
from acc.domain import CORE_V2_SCHEMA_VERSION
# 新
from acc.models import CORE_V2_SCHEMA_VERSION
```

#### acc/app/authoring.py
```python
# 旧
from acc.domain import (AccError, AgentClassTemplate, CallableRef, InvocationPolicy,
                        NodeInvocationSpec, PermissionProfile, PromptPolicy, ScopeFrame,
                        SessionInstance)
# 新
from acc.models import (AccError, AgentClassTemplate, CallableRef, InvocationPolicy,
                        NodeInvocationSpec, PermissionProfile, PromptPolicy, ScopeFrame,
                        SessionInstance)
```

#### acc/app/workflow_call.py
```python
# 旧
from acc.domain import AccError
# 新
from acc.models import AccError
```

#### acc/app/__init__.py
```python
# 旧
from acc.domain import CORE_V2_SCHEMA_VERSION, AccError, WorkflowFunctionTemplate
# 新
from acc.models import CORE_V2_SCHEMA_VERSION, AccError, WorkflowFunctionTemplate
```

#### acc/app/workflow_normalization.py
```python
# 旧
from acc.domain import AccError, AgentClassTemplate, CallableRef, PortContract
# 新
from acc.models import AccError, AgentClassTemplate, CallableRef, PortContract
```

#### acc/app/control_projection.py
```python
# 旧
from acc.domain import control_ledger_to_dict
# 新
from acc.serialization import control_ledger_to_dict
```

#### acc/app/template_bundle.py
```python
# 旧
from acc.domain import AccError, AgentClassTemplate
# 新
from acc.models import AccError, AgentClassTemplate
```

#### acc/app/supervisor.py
```python
# 旧
from acc.domain import (CORE_V2_SCHEMA_VERSION, AccError, AgentClassTemplate, CallableRef,
                        ControlPolicy, DynamicInvocationIntent, DynamicInvocationProposal,
                        EnvironmentFrame, NodeInvocationSpec, PlanStepTransitionRecord,
                        RosterEntry, RunPlan, SupervisorDecision, SupervisorPlan,
                        SupervisorRoster, control_ledger_to_dict)
# 新
from acc.models import (CORE_V2_SCHEMA_VERSION, AccError, AgentClassTemplate, CallableRef,
                        ControlPolicy, DynamicInvocationIntent, DynamicInvocationProposal,
                        EnvironmentFrame, NodeInvocationSpec, PlanStepTransitionRecord,
                        RosterEntry, RunPlan, SupervisorDecision, SupervisorPlan,
                        SupervisorRoster)
from acc.serialization import control_ledger_to_dict
```

#### acc/app/scheduler.py
```python
# 旧
from acc.domain import AccError, CallableRef, RecoveryLevel, WakeupReason, WakeupRequest
# 新
from acc.models import AccError, CallableRef, RecoveryLevel, WakeupReason, WakeupRequest
```

#### acc/server/routes/interactions.py
```python
# 旧
from acc.domain import AccError, InteractionKind
# 新
from acc.models import AccError, InteractionKind
```

#### acc/adapters/claude_sdk.py
```python
# 旧
from acc.domain import AccError, AgentCapabilities
# 新
from acc.models import AccError, AgentCapabilities
```

#### acc/adapters/capabilities.py
```python
# 旧
from acc.domain import AgentCapabilities, AgentClassTemplate, ClassTemplate
# 新
from acc.models import AgentCapabilities, AgentClassTemplate, ClassTemplate
```

#### acc/adapters/base.py
```python
# 旧
from acc.domain import AgentCapabilities
# 新
from acc.models import AgentCapabilities
```

#### acc/adapters/generic_cli.py
```python
# 旧
from acc.domain import AccError, AgentCapabilities
# 新
from acc.models import AccError, AgentCapabilities
```

#### acc/adapters/codex_cli.py
```python
# 旧
from acc.domain import AccError, AgentCapabilities
# 新
from acc.models import AccError, AgentCapabilities
```

#### tests/ 目录下所有测试文件（共 38 个）
按相同规则：
- 导入 dataclass / 常量 → `from acc.models import`
- 导入序列化函数 → `from acc.serialization import`
- 导入 `validate_core_v2_*` → `from acc.validation import`

主要测试文件映射（选重点）：

| 测试文件 | 旧导入 | 新导入 |
|---------|-------|-------|
| `tests/unit/test_core_v2_serialization.py` | `from acc.domain import workflow_function_template_to_dict, ...` | `from acc.serialization import ...` |
| `tests/unit/test_core_v2_validation.py` | `from acc.domain import validate_core_v2_*` | `from acc.validation import validate_core_v2_*` |
| `tests/unit/test_core_v2_domain_model.py` | `from acc.domain import <dataclasses>` | `from acc.models import <dataclasses>` |
| `tests/unit/test_control_ledger_domain.py` | `from acc.domain import RunPlan, PlanStep, ...` | `from acc.models import RunPlan, PlanStep, ...` |

---

### 删除文件

| 文件/目录 | 原因 |
|-----------|------|
| `acc/domain.py` | 已拆分为三个专职模块 |
| `acc/binding/__init__.py` | Phase 1 骨架，无运行时消费者，决策确认删除 |
| `acc/binding/selector.py` | 同上 |
| `acc/binding/provenance.py` | 同上 |
| `acc/ports/__init__.py` | 空壳模块 |
| `acc/migration/__init__.py` | 空壳模块（`graph_importer.py` 保留） |

---

## 测试计划

### acc/models.py 测试（新建 tests/unit/test_models.py）

| 测试用例 | 验证目标 |
|---------|---------|
| `test_frozen_dataclass_immutability` | 所有 dataclass 均为 frozen，尝试赋值触发 `FrozenInstanceError` |
| `test_constants_not_mutated` | `CORE_CALLABLE_KINDS` / `EXECUTABLE_METADATA_KEYS` 为 frozenset |
| `test_callable_ref_default_version_none` | `CallableRef(kind="agent_class", id="x").version is None` |
| `test_agent_capabilities_as_dict` | `AgentCapabilities(resumable_session=True).as_dict()["resumable_session"] is True` |
| `test_agent_capabilities_effective_keys` | 仅返回 `True` 的键 |
| `test_permission_profile_defaults` | 默认 `workspace_access="read_only"`, `network=False` |
| `test_plan_step_depends_on_tuple` | `PlanStep.depends_on` 是 tuple，不是 list |

### acc/serialization.py 测试（从 test_core_v2_serialization.py 迁移 + 补充）

| 测试用例 | 验证目标 |
|---------|---------|
| `test_workflow_function_template_round_trip` | `from_dict(to_dict(template)) == template` |
| `test_node_invocation_wire_dict_ports_key` | `node_invocation_to_wire_dict` 将 input_ports/output_ports 移入 `ports` 键 |
| `test_execution_plan_to_dict_jsonable` | `execution_plan_to_dict` 输出可被 `json.dumps` 序列化 |
| `test_control_ledger_to_dict_path_becomes_str` | Path 对象被转换为字符串 |
| `test_from_dict_wrong_schema_version` | schema_version 不匹配时抛出 `AccError` |
| `test_from_dict_missing_required_field` | 缺少 `id` 时抛出 `AccError` |
| `test_to_jsonable_nested_dataclass` | 嵌套 dataclass 被递归序列化 |
| `test_to_jsonable_tuple` | tuple 被序列化为 list |

### acc/validation.py 测试（从 test_core_v2_validation.py 迁移 + 补充）

| 测试用例 | 验证目标 |
|---------|---------|
| `test_validate_callable_ref_ok` | 合法 CallableRef 无异常 |
| `test_validate_callable_ref_empty_id` | id 为空字符串抛出 `AccError` |
| `test_validate_callable_ref_unknown_kind` | kind 不在 `CORE_CALLABLE_KINDS` 抛出 `AccError` |
| `test_validate_node_invocation_spec_ok` | 合法节点无异常 |
| `test_validate_permission_profile_invalid_workspace_access` | 非法 workspace_access 抛出 `AccError` |
| `test_validate_permission_profile_zero_timeout` | timeout_seconds=0 抛出 `AccError` |
| `test_validate_permission_profile_allow_ALL_env` | `allowed_env=("ALL",)` 抛出 `AccError` |
| `test_validate_artifact_contract_absolute_path` | 绝对路径抛出 `AccError` |
| `test_validate_artifact_contract_dotdot_path` | `../secret` 抛出 `AccError` |
| `test_reject_executable_metadata_run_id_key` | metadata 含 `run_id` 键时抛出 `AccError` |
| `test_validate_workflow_function_template_ok` | 合法 template 无异常 |
| `test_validate_execution_plan_duplicate_node` | 重复 node_id 抛出 `AccError` |
| `test_validate_workflow_template_control_edge_missing_node` | 引用不存在节点的控制边抛出 `AccError` |

### 集成测试：import 改写完整性验证（新建 tests/unit/test_no_domain_import.py）

```python
import ast, pathlib

def test_no_from_acc_domain_import():
    acc_root = pathlib.Path("acc")
    for py_file in acc_root.rglob("*.py"):
        source = py_file.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert node.module != "acc.domain", \
                    f"{py_file} still imports from acc.domain (line {node.lineno})"
```

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| import 改写遗漏某个文件 | 中 | 运行时 ImportError | 步骤 5 完成后运行 `test_no_domain_import.py` |
| `control_ledger_to_dict` 调用方散落较多，漏改一处 | 中 | 运行时 ImportError | 先搜索 `grep -r "control_ledger_to_dict"` 确认全量再改写 |
| `acc/binding/` 删除后有隐藏消费者 | 低 | ImportError | 删除前执行 `grep -r "from acc.binding\|import acc.binding"` |
| 循环导入：`serialization.py` → `models.py`（合法单向） | 无 | 无 | models.py 不导入 serialization/validation，单向依赖 |
| 测试文件数量多（38 个），改写工作量 | 高 | 工期延误 | 先用脚本批量替换，再人工 review diff |

---

## 依赖关系

```
acc/models.py
    ↑
acc/serialization.py   (imports from acc.models)
acc/validation.py      (imports from acc.models)
    ↑
所有消费者文件
```

此次拆分不影响以下模块（无 `from acc.domain import`）：
- `acc/scheduler/ready_set.py`
- `acc/result_store/`
- `acc/server/` (除 `routes/interactions.py` 已列入)
- `acc/session.py`
- `acc/run_index.py`

---

## 预估工作量

| 任务 | 工时（人时） |
|------|------------|
| 步骤 1：新建 models.py（复制+整理分组） | 1.5 h |
| 步骤 2：新建 serialization.py（复制+调整导入） | 1.0 h |
| 步骤 3：新建 validation.py（复制+调整导入） | 0.5 h |
| 步骤 4：死代码删除（binding/ports/migration 空壳） | 0.5 h |
| 步骤 5：全量 import 改写（46 个 acc 源文件 + 38 个测试文件） | 3.0 h |
| 步骤 6：删除 domain.py + 运行测试验证 | 0.5 h |
| 编写新增测试（test_models.py + test_no_domain_import.py） | 1.0 h |
| **合计** | **8.0 h** |

---

*文档版本：2026-06-11 | 分支：dev_v3 | 决策确认日期：2026-06-11*
