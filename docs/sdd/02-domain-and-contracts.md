# ACC SDD 02: Domain And Contracts

## 1. Purpose

本文件定义 ACC Core v2 的领域模型和稳定契约。它回答一个核心问题：

> ACC 里哪些东西是可复用定义，哪些东西是一次运行的状态，哪些东西是控制面决策，哪些东西是落盘证据；这些对象之间如何引用，哪些边界绝不能混淆。

本文依据当前代码和现有架构文档编写，主要事实源包括：

- `acc/models.py`
- `acc/serialization.py`
- `acc/validation.py`
- `acc/schemas.py`
- `acc/callable_registry.py`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`

本文不是 API 使用教程，也不是每个字段的机械转录。它是后续实现、重构、代码生成、GraphOps、Workbench 和测试设计必须遵守的领域契约。

## 2. First Principles

ACC 的领域模型基于四个第一性原理。

### 2.1 Definition Is Not Execution

定义态对象描述“可以被复用的能力”：

```text
AgentClassTemplate
ToolClassTemplate
WorkflowFunctionTemplate
NodeInvocationSpec
CallableRef
PortContract
ControlEdge
DataEdge
```

运行态对象描述“某一次真实执行”：

```text
FunctionInvocation
ScopeFrame
SessionInstance
NodeInvocationRun
RunRecord
EventRecord
ArtifactBundle
FailureRecord
```

定义态对象必须是可复用、无状态、可被多次调用的。运行态对象必须绑定一次具体 `run_id`、`invocation_id`、`scope_frame_id`、`session_id` 或证据路径。

直观类比：

```text
WorkflowFunctionTemplate = 函数定义
NodeInvocationSpec       = 函数体里的一个 call site
FunctionInvocation       = 一次函数调用
ScopeFrame               = 这次调用的栈帧和工作区
SessionInstance          = 栈帧里某个 agent/tool 的一次进程级执行
```

同一个 `AgentClassTemplate` 或 `ToolClassTemplate` 可以产生很多 `SessionInstance`。这些 session 不能隐式共享 conversation memory、临时文件、cwd mutation、inbox/outbox、event log、artifact 或 error state。

### 2.2 Control Is Not Data

ACC 显式区分控制依赖和数据依赖：

- `ControlEdge` 决定调度顺序。
- `DataEdge`、`NodeInputBinding`、`NodeOutputBinding`、`WorkflowInputBinding`、`WorkflowOutputBinding`、`WorkflowCallInputBinding`、`WorkflowCallOutputBinding` 决定内容如何 materialize。

`ControlEdge.context` 在 Core v2 中只能是 `"none"`。这条规则由 `validate_core_v2_workflow_function_template()` 检查。含义是：控制边不能偷偷携带数据上下文；数据只能通过端口、binding、inbox/outbox 和 artifact 机制流动。

### 2.3 Template Must Not Contain Runtime State

`WorkflowFunctionTemplate`、`NodeInvocationSpec` 和 class template 中不能写入运行态字段，例如：

```text
run_dir
run_id
session_id
previous_outputs
conversation_memory
workspace_root
local_workspace_binding
```

当前代码通过 `EXECUTABLE_METADATA_KEYS` 和 `_reject_executable_metadata()` 拒绝把这些 executable/runtime 字段塞进 `workflow.metadata`、`workflow.policies` 或 `node.metadata`。任何新功能如果需要运行态信息，必须把它写到 run evidence 或 control ledger，而不是写回 template。

### 2.4 Evidence Is Runtime Truth

ACC 的运行事实不是 Workbench store，也不是临时 API response，而是 run-scoped evidence。当前架构文档列出的 Core v2 evidence 包括：

```text
run_record.json
run_summary.json
function_invocation.json
scope_frame.json
events.jsonl
result_store/
workflow_outputs/<port>/output.json
nodes/<node_id>/session_instance_manifest.json
nodes/<workflow_node>/workflow_call_manifest.json
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/output.json
nodes/<node_id>/events.jsonl
nodes/<node_id>/artifact_bundle.json
```

Workbench 可以缓存 `activeRunId`、`latestRunId`、选中节点和 UI projection，但这些只是交互便利状态，不是领域事实源。

## 3. Object Families

ACC 的核心对象可以按职责拆成四组：定义态、运行态、控制态、证据态。

### 3.1 Definition Objects

定义态对象描述 reusable behavior 和 workflow graph。

| Object | Role | Stable Contract |
| --- | --- | --- |
| `AgentClassTemplate` | 可复用 agent 行为类 | 拥有 `runtime`、默认 prompt/rules/skills、默认权限、端口和 artifact contract |
| `ToolClassTemplate` | 可复用本地 tool 行为类 | 拥有 `runner`、默认权限、端口和 artifact contract |
| `WorkflowFunctionTemplate` | 可复用 workflow function body | 拥有 nodes、control/data edges、暴露输入输出、workflow-level bindings、policies、metadata |
| `NodeInvocationSpec` | workflow 内部一个 call site | 通过 `CallableRef` 指向 callable class 或 child workflow，并携带 invocation-scoped overrides、bindings、policy |
| `CallableRef` | callable 引用 | 由 `kind`、`id`、可选 `version` 组成；Core v2 `kind` 只能是 `agent_class`、`tool_class`、`workflow_function` |
| `PortContract` | 端口契约 | 描述端口 `id`、方向、类型、是否 required、cardinality |
| `ControlEdge` | 控制依赖 | 从 source node 到 target node，Core v2 不携带数据 context |
| `DataEdge` | 数据依赖 | 从 source endpoint 到 target endpoint，并指定 materialization mode |

### 3.2 Runtime Objects

运行态对象描述一次 workflow call 和它内部的 agent/tool session。

| Object | Role | Stable Contract |
| --- | --- | --- |
| `FunctionInvocation` | 一次 workflow function 调用 | 绑定 `invocation_id`、`workflow_function_id`、`run_id`、`input_payload`、root scope |
| `ScopeFrame` | 一次调用的运行作用域 | 拥有 `workspace_root`、`environment_root`、`inbox_root`、`outbox_root`、`artifact_root`、`behavior_snapshot_path` |
| `SessionInstance` | 一个 node 内 agent/tool 的真实执行 | 绑定 `session_id`、`node_id`、`callable_ref`、cwd、input/output path、artifact dir、event log |
| `NodeInvocationRun` | node 运行投影 | 把 node、invocation、scope、session、result address、failure 关联起来 |
| `RunRecord` | run 级别摘要事实 | 绑定 `run_id`、workflow、invocation、status、event log path、result store root |
| `RuntimeResult` | adapter/tool 执行结果 | 表达 status、summary、output、error、exit_code |

运行态对象可以引用定义态对象，但不能反过来让定义态对象引用运行态对象。

### 3.3 Control Objects

控制态对象描述调度、审批、handoff、supervisor、replay 这些“谁决定下一步”的事实。

| Object | Role | Stable Contract |
| --- | --- | --- |
| `ControlPolicy` | run 或节点级控制策略 | 约束 fixed/supervisor/handoff 模式、允许目标、是否需要人审、并发和深度 |
| `RunPlan` | 一次 run 的控制计划 | 绑定 run、workflow、invocation、template snapshot、control policy 和计划状态 |
| `PlanStep` | 控制计划中的一步 | 绑定 node、callable、依赖、状态、session、artifact、failure、decision |
| `DispatchEnvelope` | 一次 dispatch 的幂等信封 | 绑定 plan step、scope、invocation、input ref、policy snapshot、attempt 和 status |
| `DecisionRecord` | 一次控制面决策 | 记录 actor、kind、输入证据、候选项、选择项、拒绝项、rationale、replay binding |
| `ReplayPolicy` | replay 规则 | 决定是否重用 human/supervisor/handoff decision，是否允许 GraphOps apply |
| `HandoffControlPolicy` | handoff 策略 | 限制 source/target、允许模式、是否需要 acceptance/human approval、深度和重复次数 |
| `HandoffRequest` | 一次 handoff 请求 | 记录 source step/node、target node/callable、mode、payload 和 artifact refs |
| `InteractionRequest` | 人机交互请求 | 描述 approval/ask/confirm/suggest 的 pending/answered/expired/cancelled 状态 |

控制态对象的关键点是可审计：ACC 不只记录“跑了什么”，还记录“为什么跑、谁批准、基于哪些证据选择了这个动作”。

### 3.4 Evidence Objects

证据态对象描述已经发生的事实和可检查产物。

| Object | Role | Stable Contract |
| --- | --- | --- |
| `EventRecord` | run 级事件 | 记录 event id、run id、type、timestamp、可选 node 和 payload |
| `ControlEventRecord` | 控制面事件 | 可关联 scope、node、session、plan step、dispatch、decision |
| `PlanStepTransitionRecord` | plan step 状态迁移记录 | 按 sequence 记录 previous/next status、snapshot、reason、decision/dispatch |
| `DispatchTransitionRecord` | dispatch 状态迁移记录 | 按 sequence 记录 dispatch previous/next status、snapshot、reason |
| `ArtifactBundle` | node/run 产物集合 | 绑定 bundle、node、run、outputs、files、created_at、provenance |
| `FailureRecord` | 失败事实 | 记录 failure layer、message、node、related ids、evidence paths |
| `ResultStoreAddress` | result store 地址 | 用 `run_id`、`node_id`、`port_id` 定位 node output |

注意：`acc.models.ArtifactBundle` 是领域层的 per-node artifact bundle；`acc.result_store.types.ArtifactBundle` 是 result store 层的存储类型。两者同名但职责不同，文档和代码中必须用模块路径区分，避免误读。

## 4. Canonical Object Relationships

ACC Core v2 的主路径如下：

```text
AgentClassTemplate / ToolClassTemplate
          ^
          |
      CallableRef
          |
NodeInvocationSpec  -- belongs to -->  WorkflowFunctionTemplate
          |
          v
ExecutionPlan / RunPlan / PlanStep
          |
          v
FunctionInvocation
          |
          v
ScopeFrame
          |
          v
SessionInstance or child FunctionInvocation
          |
          v
RuntimeResult / ArtifactBundle / EventRecord / FailureRecord
          |
          v
RunRecord / run_summary / result_store / workflow_outputs
```

关键关系：

- `WorkflowFunctionTemplate.node_invocations` 是 `node_id -> NodeInvocationSpec` 映射。
- `NodeInvocationSpec.callable_ref` 指向 `agent_class`、`tool_class` 或 `workflow_function`。
- `ExecutionNode` 把 `node_id`、`NodeInvocationSpec` 和 `depends_on` 绑定起来。
- `ExecutionPlan` 是 `WorkflowFunctionTemplate` 经验证和依赖分析后的计划形态，不是运行事实。
- `FunctionInvocation` 是一次 workflow call，拥有 root `ScopeFrame`。
- `ScopeFrame` 是 data/materialization 的运行边界，拥有 inbox/outbox/artifact root。
- `SessionInstance` 只表示 agent/tool 执行；如果 node 调用 child workflow，应产生 child `FunctionInvocation` 及 workflow call evidence。
- `RunPlan`、`PlanStep`、`DispatchEnvelope`、`DecisionRecord` 属于控制账本，不应被简化成普通 node status 字段。
- `RunRecord` 是 run-level 摘要事实；完整细节要结合 events、node manifests、artifact bundle 和 result store。

## 5. Definition-State Contracts

### 5.1 `AgentClassTemplate`

`AgentClassTemplate` 表示 reusable agent behavior class。它回答：

- 使用哪个外部 agent runtime。
- 默认 prompt、rules、skills 是什么。
- 默认 permission profile 是什么。
- 输入/输出端口和 artifact contract 是什么。

它不回答：

- 本次 run 的 cwd 是什么。
- 本次 session 的 prompt 最终拼接结果是什么。
- 本次输出文件在哪里。
- 上一次会话记忆是什么。

这些都属于 `ScopeFrame`、`SessionInstance`、payload 或 run evidence。

### 5.2 `ToolClassTemplate`

`ToolClassTemplate` 表示 reusable local/tool behavior class。它和 `AgentClassTemplate` 的差异是入口字段为 `runner` 而不是 `runtime`，并且语义上代表本地工具或 callable tool。

`CallableRegistry.from_project_root()` 当前从：

```text
callables/agents/*.yaml
callables/tools/*.yaml
```

加载 class template。pre-Core-v2 YAML 是迁移输入边界，不应重新成为 runtime source of truth。

### 5.3 `WorkflowFunctionTemplate`

`WorkflowFunctionTemplate` 是 ACC 的 callable workflow 函数定义。它包含：

- `id`
- `version`
- `node_invocations`
- `control_edges`
- `data_edges`
- `exposed_inputs`
- `exposed_outputs`
- `workflow_input_bindings`
- `workflow_output_bindings`
- `policies`
- `metadata`
- 可选 `source_path`

`source_path` 是加载/定位辅助，不是 workflow 语义本身。template 的 durable wire format 是 `schema_version == "acc.core.v2"` 的 `.accflow.json`。

### 5.4 `NodeInvocationSpec`

`NodeInvocationSpec` 是 workflow function 内部一个 call site。它既不是 class template，也不是 session。

它可以携带 invocation-scoped 配置：

- `CallableOverride`
- `input_bindings`
- `output_bindings`
- `workflow_call_input_bindings`
- `workflow_call_output_bindings`
- `environment_policy`
- `invocation_policy`
- `runtime_policy`
- `prompt_policy`
- `NodeControlPolicy`
- `ArtifactContract`
- `output_schema`
- node-level `input_ports` / `output_ports`
- `metadata`

边界要求：

- class prompt/default permissions 属于 `AgentClassTemplate` 或 `ToolClassTemplate`。
- task/node prompt、static input、bindings 属于 `NodeInvocationSpec`。
- session cwd、input/output path、artifact dir、event log 属于 `SessionInstance`。
- run id、session id、previous outputs、conversation memory 不允许写进 `NodeInvocationSpec.metadata`。

### 5.5 Binding Objects

ACC 使用多个 binding 类型表达数据如何进入和离开 node/workflow：

| Binding | Direction |
| --- | --- |
| `NodeInputBinding` | 上游 node output 或 static value -> 当前 node input port |
| `NodeOutputBinding` | 当前 node output port -> 下游 endpoint |
| `WorkflowInputBinding` | workflow exposed input -> 内部 node endpoint |
| `WorkflowOutputBinding` | 内部 node endpoint -> workflow exposed output |
| `WorkflowCallInputBinding` | parent node/static value -> child workflow input |
| `WorkflowCallOutputBinding` | child workflow output -> parent port |

这些 binding 的共同字段包括 materialization mode 和 required flag。materialization mode 当前是：

```text
copy
reference
symlink
```

但是是否允许某种 materialization、如何落盘和如何保护路径，是 runtime/transfer policy 的职责，不应由 template 自行绕过。

## 6. Runtime-State Contracts

### 6.1 `FunctionInvocation`

`FunctionInvocation` 表示一次 workflow function 调用。它必须绑定：

- `invocation_id`
- `workflow_function_id`
- `run_id`
- `status`
- `input_payload`
- `root_scope_frame_id`
- 可选 `parent_invocation_id`
- 可选开始/结束时间

如果 workflow node 调用了 child workflow，child workflow 应有自己的 `FunctionInvocation`。这保证 nested workflow 不会把 child 的运行态混进 parent template。

### 6.2 `ScopeFrame`

`ScopeFrame` 是运行时作用域。它拥有：

- `workspace_root`
- `environment_root`
- `inbox_root`
- `outbox_root`
- `artifact_root`
- `behavior_snapshot_path`
- `ephemeral`
- 可选 `binding_path`
- `call_depth`
- parent frame 关系

可以把它理解成一次 workflow call 的栈帧。任何数据 materialization、cwd、inbox/outbox、artifact 存放，都必须在 scope 边界内解释。

### 6.3 `SessionInstance`

`SessionInstance` 是一个 node 中 agent/tool 的具体执行。它必须绑定：

- `session_id`
- `invocation_id`
- `scope_frame_id`
- `node_id`
- `callable_ref`
- `callable_kind`
- `status`
- `cwd`
- `env_keys`
- `input_path`
- `output_path`
- `artifact_dir`
- `event_log_path`

`SessionInstance` 是 runtime adapter 和 evidence 的交界点。外部 agent/tool 可以有自己的内部 reasoning 或执行细节，但 ACC 只拥有执行边界、输入、输出、日志、artifact 和状态。

### 6.4 `RunRecord`

`RunRecord` 是 run 级别事实摘要，不是完整 trace。它必须能定位：

- run 属于哪个 workflow。
- run 对应哪个 function invocation。
- 当前/最终 status。
- event log 在哪里。
- result store root 在哪里。

完整审计需要结合：

```text
events.jsonl
control ledger
node manifests
artifact bundles
failure records
result store outputs
```

## 7. Control-State Contracts

### 7.1 `RunPlan` and `PlanStep`

`RunPlan` 是一次 run 的控制计划。它记录 source：

```text
fixed
supervisor
handoff
replay
```

`PlanStep` 是控制计划中的单步执行单元。它的 status 枚举为：

```text
pending
ready
waiting_interaction
dispatching
running
success
failed
skipped
cancelled
```

这些状态表达控制面进度，不应被 Workbench 私有状态或普通 node UI status 替代。

### 7.2 `DispatchEnvelope`

`DispatchEnvelope` 是一次 dispatch 的幂等信封。它绑定：

- `dispatch_id`
- `run_plan_id`
- `plan_step_id`
- `node_id`
- `callable_ref`
- `scope_frame_id`
- `invocation_id`
- `idempotency_key`
- `correlation_id`
- `input_ref`
- `policy_snapshot_ref`
- `created_by_decision_id`
- `attempt`
- `status`

它的作用不是重复描述 node，而是把“这次 dispatch 基于什么输入、什么策略、哪个 decision 产生”固定下来。

### 7.3 `DecisionRecord`

`DecisionRecord` 是控制面的审计核心。它记录：

- `actor`
- `kind`
- `input_evidence_refs`
- `policy_snapshot`
- `candidates`
- `selected`
- `rejected`
- `rationale`
- `result_refs`
- `replay_binding`

如果后续需要解释为什么某个 supervisor/handoff/retry/approval 发生，必须能从 `DecisionRecord` 和它引用的 evidence 回放决策上下文。

### 7.4 Human Interaction

`InteractionRequest` 用于 approval/ask/confirm/suggest。它的 status 是：

```text
pending
answered
expired
cancelled
```

`NodeControlPolicy.require_human_approval` 表示 node 是否需要人审。拒绝时状态由 `approval_reject_status` 决定，只允许：

```text
failed
skipped
```

`serialization._node_control_policy_from_dict()` 会拒绝其他值。

## 8. Serialization Contracts

### 8.1 Canonical Core v2 Workflow Wire Format

`workflow_function_template_to_dict()` 输出 canonical `.accflow.json` payload：

```text
schema_version: "acc.core.v2"
id
version
nodes
control_edges
data_edges
exposed_inputs
exposed_outputs
workflow_input_bindings
workflow_output_bindings
policies
metadata
```

`workflow_function_template_from_dict()` 只接受 `schema_version == CORE_V2_SCHEMA_VERSION`。其他 schema version 会抛出 `AccError("Unsupported schema_version: ...")`。

### 8.2 Node Wire Format

`node_invocation_to_wire_dict()` 会把 dataclass 内部字段：

```text
input_ports
output_ports
```

转换成 wire format：

```text
ports:
  inputs: ...
  outputs: ...
```

反序列化时 `_node_ports_from_dict()` 只从 `ports.inputs` 和 `ports.outputs` 读取 node ports。如果 `ports` 存在但不是 object，会抛出 `AccError("Node ports must be an object")`。

### 8.3 Path Serialization

`serialization._to_jsonable()` 会把 `Path` 转成 string，把 dataclass、dict、list、tuple 递归转换成 JSON-friendly structure。

含义：

- domain model 可以用 `Path` 表示本地证据路径。
- wire format 和 persisted evidence 必须是 JSON-compatible。
- 反序列化函数必须明确哪些路径是语义字段，哪些只是加载辅助。

### 8.4 Defaulting Rules

当前反序列化代码包含明确 default：

- missing optional lists -> `[]`
- missing optional dicts -> `{}`
- missing `materialization` -> `"copy"`
- missing node `target_port` -> `"main"`
- missing `PermissionProfile` -> default read-only profile
- missing runtime retry -> `max_attempts=1`
- missing timeout seconds -> `None` 或 permission default `60`
- missing `PromptPolicy.appendix_policy` -> `"task_only"`
- missing `NodeControlPolicy.approval_reject_status` -> `"failed"`

这些 default 是兼容性契约。新增字段应尽量采用 additive optional default，避免破坏旧 `.accflow.json`。

### 8.5 Unknown Field Policy

`acc/serialization.py` 当前对 `.accflow.json` 采用显式字段读取，不是通用 strict parser。未知字段通常会被忽略，除非它们处在明确校验的位置。

`acc/schemas.py` 中的 Pydantic model 使用 `ConfigDict(extra="forbid")`，表示这些 schema-facing model 是 strict 的，例如：

- `RuntimeSpec`
- `AgentCapabilitiesSpec`
- `WorkspaceSpec`
- `PermissionSpec`

因此 ACC 有两类契约：

- Core workflow template wire format：通过专用 parser、domain validation 和 schema_version 管控。
- API/config schema model：通过 Pydantic `extra="forbid"` 做严格字段限制。

新增 schema 时必须明确属于哪一类，不要混用。

## 9. Validation Contracts

### 9.1 JSON Schema Validation

`validate_payload(payload, schema_path)` 使用 `Draft202012Validator`。失败时抛出 `AccError`，错误信息包含 JSON path：

```text
JSON Schema validation failed at <path>: <message>
```

`validate_json_file(json_path, schema_path)` 在 schema validation 后还要求 payload 是 object，否则抛出：

```text
Validated JSON output must be an object
```

### 9.2 Core v2 Workflow Validation

`validate_core_v2_workflow_function_template()` 执行以下检查：

- `WorkflowFunctionTemplate.id` 必填。
- `WorkflowFunctionTemplate.version` 必填。
- workflow `metadata` 和 `policies` 不得包含 executable metadata key。
- node map key 必须等于 `NodeInvocationSpec.id`。
- 每个 node 必须通过 `validate_core_v2_node_invocation_spec()`。
- `ControlEdge.context` 必须是 `"none"`。
- control edge source/target 必须引用存在的 node。
- data edge source/target 必须引用存在的 node。
- workflow output binding source 必须引用存在的 node。

### 9.3 Core v2 Node Validation

`validate_core_v2_node_invocation_spec()` 执行以下检查：

- `NodeInvocationSpec.id` 必填。
- `CallableRef` 必须合法。
- node `metadata` 不得包含 executable metadata key。
- runtime/invocation/override permission profile 必须合法。
- artifact contract path 必须安全。
- input binding source node 必须存在。
- workflow call input binding source node 必须存在。

### 9.4 CallableRef Validation

`validate_core_v2_callable_ref()` 要求：

- `CallableRef.kind` 属于 `CORE_CALLABLE_KINDS`：

```text
agent_class
tool_class
workflow_function
```

- `CallableRef.id` 非空。

这意味着任何新 callable kind 不是随手加字符串，而是 domain model、registry、runtime、GraphOps、Workbench、tests 的协同 schema evolution。

### 9.5 Permission Validation

`_validate_permission_profile()` 要求：

- `workspace_access` 只能是：

```text
read_only
writes_run_only
writes_workspace
```

- `env_policy` 只能是：

```text
acc_whitelist
explicit_allowlist
```

- `timeout_seconds > 0`
- `allowed_env` 不能包含 `"ALL"` 或 `"*"`

`acc/schemas.py` 的 `PermissionSpec` 还额外规定：

- `timeout_seconds` 必须为正。
- `sandbox == "danger-full-access"` 时必须 `allow_dangerous == true`。

权限默认应该保守。任何扩大权限的字段都必须显式、可验证、可审计。

### 9.6 Artifact Path Validation

`validate_relative_artifact_path()` 和 `_validate_artifact_contract()` 要求 artifact path：

- 不能是 absolute path。
- 不能包含 `..`。

`validate_artifacts()` 会检查 required artifact 是否存在，并对 optional artifact 也做路径安全检查。

这条契约保证 artifact contract 不能逃逸出 ACC 管理的 artifact directory。

## 10. Callable Registry Contracts

`CallableRegistry` 是 runtime callable class discovery boundary。当前实现只从 Core v2 callable class template 加载：

```text
callables/agents/*.yaml
callables/tools/*.yaml
```

加载规则：

- agent callable 需要 `runtime` 或 legacy alias `adapter`。
- tool callable 需要 `runner` 或 legacy alias `adapter`。
- `id` 缺省为文件 stem。
- `version` 缺省为 `"0.1.0"`。
- `default_permissions` 缺省为 `PermissionProfile()`。
- `input_ports` / `output_ports` 必须是 object。
- `metadata.source_path` 会被自动写入。
- 同 kind + id 不能重复。

解析和查询规则：

- `resolve(ref)` 按 `(ref.kind, ref.id)` 精确查找。
- `resolve_class_id(class_id)` 在 `agent_class`、`tool_class` 中按 id 查找。
- `workflow_ids()` 通过 `metadata["callable_wrapper"] == "workflow_function"` 推导 wrapper workflow id。

边界要求：

- registry 只负责发现 class template，不负责执行。
- pre-Core-v2 YAML 可以作为迁移输入，但不能重新成为 runtime execution semantics。
- `CallableRef.version` 当前未参与 registry key；如果未来要启用版本解析，必须更新 registry key、GraphOps、serialization、Workbench 和 migration contract。

## 11. Schema Evolution Principles

ACC 的 schema evolution 必须遵守以下原则。

### 11.1 Schema Version Is a Gate

Core v2 workflow template 必须声明：

```text
schema_version: "acc.core.v2"
```

parser 不应悄悄接受未知 schema version。新的 major schema 必须有显式 migration 或 rejection path。

### 11.2 Additive First

新增字段优先采用：

- optional field
- explicit default
- additive evidence file
- additive event payload field
- additive metadata only when not executable/runtime state

不要修改现有字段语义来承载新行为。

### 11.3 Do Not Store Runtime State in Templates

如果新需求涉及：

- run identity
- workspace binding
- session resume token
- previous output
- conversation memory
- selected run
- UI active state

它应属于 run evidence、control ledger、Workbench projection 或 explicit local UI storage，而不是 `WorkflowFunctionTemplate` / `NodeInvocationSpec` / class template。

### 11.4 Keep Pure Domain Models Pure

`acc.models.py` 只应保存 frozen dataclass、Literal type alias、constants 和 base `AccError`。它不应导入 serialization、validation、server、runtime、filesystem writer 或 subprocess adapter。

领域对象可以描述路径字段，但不应负责读写路径。

### 11.5 Migration Must Be Explicit

Legacy input 的合法路径只有：

```text
legacy input -> migration parser -> canonical Core v2 output
legacy input -> explicit rejection with migration hint
historical fixture -> read-only regression/documentation evidence
```

runtime、Workbench save/run、GraphOps apply 不应消费 legacy graph raw fields 作为执行语义。

## 12. Non-Confusion Rules

这些规则用于 code review、AI code generation 和后续 spec 编写。

1. `AgentClassTemplate` / `ToolClassTemplate` 不是 `SessionInstance`。
2. `WorkflowFunctionTemplate` 不是 `FunctionInvocation`。
3. `NodeInvocationSpec` 是 call site，不是 node run。
4. `CallableRef` 是引用，不是已解析 executable。
5. `ExecutionPlan` 是计划，不是 durable evidence。
6. `RunPlan` / `PlanStep` 是控制账本对象，不是 UI task state。
7. `ScopeFrame` 拥有 inbox/outbox/artifacts，node 之间不能直接写对方 workspace。
8. `RunRecord` 是摘要事实，不是完整 trace。
9. Workbench store 是 projection，不是 runtime truth。
10. `metadata` 不能成为 executable config 的逃生通道。
11. artifact path 必须是相对路径，不能 absolute，也不能包含 `..`。
12. permission 扩权必须显式，不允许通过 `"ALL"`、`"*"` 或 hidden metadata 实现。

## 13. Verification Checklist

后续修改领域模型、serialization、validation、registry 或 schema 时，至少要验证：

```bash
uv run pytest -q
uv run ruff check .
```

针对本文件定义的契约，应重点覆盖这些测试方向：

- `.accflow.json` 缺失或错误 `schema_version` 会被拒绝。
- `WorkflowFunctionTemplate` node key 与 node id 不一致会被拒绝。
- `ControlEdge.context != "none"` 会被拒绝。
- control/data edge 引用缺失 node 会被拒绝。
- `CallableRef.kind` 非 `agent_class` / `tool_class` / `workflow_function` 会被拒绝。
- `metadata` / `policies` 中出现 `run_id`、`session_id`、`conversation_memory`、`legacy_*` 会被拒绝。
- permission profile 中 `allowed_env == ["*"]` 或 `["ALL"]` 会被拒绝。
- artifact contract 使用 absolute path 或 `..` 会被拒绝。
- `callables/agents` 和 `callables/tools` 中重复 kind/id 会被拒绝。
- 同一个 class/template 可以产生多个独立 `FunctionInvocation` / `ScopeFrame` / `SessionInstance`，且 run evidence 不互相覆盖。

如果只改本文档，不需要运行测试；如果修改上述代码契约，必须运行对应 backend tests，并说明未覆盖的风险。
