# ACC SDD 03: Runtime And Evidence

## 1. 结论

ACC Core v2 runtime 的本质不是“跑一个 DAG”，而是把一个可复用的
`WorkflowFunctionTemplate` 转换成一次可审计的 `FunctionInvocation`，在隔离的
`ScopeFrame` 里调度 `NodeInvocationSpec`，并把每一步控制事实、输入物化、输出端口、
artifact、失败和最终状态落到 run-scoped evidence。

一句话控制流：

```text
WorkflowFunctionTemplate
  -> ExecutionPlan
  -> RunPlan + PlanStep[]
  -> DispatchEnvelope
  -> SessionInstance or child FunctionInvocation
  -> output/result_store/artifact/failure evidence
  -> workflow_outputs
  -> RunRecord / RunSummary
```

一句话数据流：

```text
workflow input / static input / upstream outputs
  -> resolve_node_payload()
  -> nodes/<node_id>/agent_payload.json
  -> callable execution
  -> nodes/<node_id>/output.json
  -> outputs[(node_id, port_id)]
  -> result_store/<node_id>/<port_id>.json|.bin
  -> downstream node payload or workflow_outputs/<port>/output.json
```

核心不变量：

- Template 是定义态，不能携带 run dir、session id、workspace binding、conversation memory。
- `ExecutionPlan` 是纯计划，不是运行事实。
- `RunPlan` / `PlanStep` / `DispatchEnvelope` 记录“为什么可以执行下一步”。
- `SessionInstance` / `output.json` / `artifact_bundle.json` / `FailureRecord` 记录“实际执行发生了什么”。
- downstream 不允许被 upstream 直接写 workspace；数据只能通过 ACC 的 payload/materialization/result store/artifact 规则传递。
- canonical run dir 必须由 ACC claim 或通过 `.acc-run-marker.json` 证明所有权。
- control ledger 写失败是审计失败，应进入 `crashed`，不能伪装成普通节点业务失败。

## 2. Scope

本 spec 描述一次 Core v2 workflow run 的运行机制和证据系统。

覆盖范围：

- `run_core_v2_workflow_path()` 和 `run_workflow_function_invocation()` 的启动与收尾路径。
- `run_ready_queue_execution()` 的 ready-queue 调度、取消、等待和失败传播。
- `execute_core_v2_node()` 的单节点执行、输入物化、callable 调用、输出端口写入、artifact contract 和失败证据。
- nested `workflow_function` callable 的 child invocation 语义。
- `run_record.json`、`run_summary.json`、`events.jsonl`、`run_plan.json`、`plan_steps.jsonl`、`dispatches.jsonl`、`decisions.jsonl`、node evidence、`result_store/`、`workflow_outputs/` 的职责。
- artifact/result_store/inbox/outbox 的边界和 path safety。

非目标：

- 不定义 GraphOps authoring/apply 流程。
- 不定义 Workbench UI projection 细节。
- 不定义 agent 内部 reasoning loop。
- 不引入数据库、远程队列、云 worker 或 SaaS backend。
- 不把 legacy runtime 文件重新变成事实源。

## 3. First Principles

### 3.1 Definition vs Execution

`WorkflowFunctionTemplate`、`AgentClassTemplate`、`ToolClassTemplate` 是可复用定义。
一次 run 必须创建新的运行态对象：

```text
FunctionInvocation
ScopeFrame
RunRecord
SessionInstance
ArtifactBundle
FailureRecord
EventRecord
```

直觉上，template 像“函数体”，`FunctionInvocation` 像“一次函数调用”，`ScopeFrame` 像这次调用的栈帧和工作目录。任何只能在某次 run 中成立的信息，都必须落在 run evidence 中，不能回写 template。

### 3.2 Control Flow vs Data Flow

`ControlEdge` 只回答“谁必须先跑完，谁才能调度”。
`DataEdge`、`workflow_input_bindings`、`input_bindings`、`workflow_call_*_bindings` 回答“哪些数据进入哪个端口”。

当前实现中：

- `compile_execution_plan()` 基于 `control_edges` 生成 `ExecutionPlan.nodes` 和拓扑 `levels`。
- `DAGScheduler` 基于 `ExecutionNode.depends_on` 维护 ready/running/success/failed/skipped/waiting。
- `resolve_node_payload()` 基于 workflow input、node static input、node input bindings、data edges、control-main default forwarding 生成实际 payload。
- data edge 必须跟随 control dependency，不能让数据从尚未完成的节点流向目标。

### 3.3 Plan vs Evidence

`ExecutionPlan` 是纯计算结果。它不能证明节点真的执行过，也不能解释人类审批、dispatch、失败、跳过或取消。

运行期证据分两层：

- Control ledger：`run_plan.json`、`plan_steps.jsonl`、`dispatches.jsonl`、`decisions.jsonl`、control events。
- Execution evidence：`function_invocation.json`、`scope_frame.json`、`nodes/<node_id>/...`、`result_store/`、`workflow_outputs/`、`failures/`、`run_record.json`、`run_summary.json`。

Control ledger 回答“为什么执行”。Execution evidence 回答“执行产生了什么”。

### 3.4 Local-First Evidence

ACC 不依赖数据库作为运行事实源。run-scoped filesystem evidence 就是 durable truth。

因此所有重要状态变化都必须能从 `runs/<run_id>/` 下的文件复盘：

```text
runs/<run_id>/
  .acc-run-marker.json
  run_record.json
  run_summary.json
  function_invocation.json
  scope_frame.json
  behavior_snapshot/workflow_function_template.json
  events.jsonl
  run_plan.json
  plan_steps.jsonl
  dispatches.jsonl
  decisions.jsonl
  nodes/<node_id>/
  result_store/
  workflow_outputs/
  failures/
```

## 4. Runtime Entry

### 4.1 `run_core_v2_workflow_path()`

入口职责：

1. 从 canonical `.accflow.json` 加载 `WorkflowFunctionTemplate`。
2. 复制 `input_payload`，形成 workflow input。
3. 推导 `workspace_root` 和 `ephemeral`。
4. 调用 `compile_execution_plan(template, workflow_input=...)`。
5. 创建 `FunctionInvocation`：
   - `invocation_id = invocation_<run_id>`
   - `workflow_function_id = template.id`
   - `run_id = run_dir.name`
   - `status = running`
   - `input_payload = workflow_input`
   - `root_scope_frame_id = scope_<run_id>_root`
   - nested workflow 时记录 `parent_invocation_id`
6. 创建 `ScopeFrame`：
   - `workspace_root`
   - `environment_root = run_dir`
   - `inbox_root = run_dir/inbox`
   - `outbox_root = run_dir/outbox`
   - `artifact_root = run_dir/artifacts`
   - `behavior_snapshot_path = run_dir/behavior_snapshot`
   - `binding_path`
   - `call_depth`
7. 进入 `run_workflow_function_invocation()`。

`run_core_v2_workflow_path()` 只负责把“路径 + 输入”变成“template + invocation + scope + plan”。真正运行和落盘由下一层完成。

### 4.2 `run_workflow_function_invocation()`

启动阶段：

1. 推导 canonical project root。只有 `run_dir.parent.name == "runs"` 时，`project_root = runs_root.parent`。
2. 调用 `prepare_runtime_run_dir(run_dir, project_root=...)`。
3. 创建基础目录：

```text
run_dir/
  inbox/
  outbox/
  artifacts/
  behavior_snapshot/
  failures/
```

4. 初始化 `events.jsonl` 为空文件。
5. 创建 `FilesystemResultStore(run_dir.parent)`。
6. 写入初始 evidence：

```text
function_invocation.json
scope_frame.json
behavior_snapshot/workflow_function_template.json
run_record.json
run_summary.json
events.jsonl: workflow_started
```

7. 调用 `build_fixed_run_plan()` 把 `ExecutionPlan` 转成：

```text
RunPlan(source="fixed", status="active")
PlanStep[]    # 每个 ExecutionNode 一个 PlanStep
```

8. 创建 `FixedRunControlLedgerWriter` 并 `initialize()`：

```text
run_plan.json
plan_steps.jsonl     # initial PlanStep transition
decisions.jsonl      # compile_plan DecisionRecord
events.jsonl         # decision_recorded control event
```

9. 进入 `run_ready_queue_execution()`。

收尾阶段：

- `success`：写 `workflow_outputs/`，写 workflow output result store，追加 `workflow_completed`，finalize run plan 为 `completed`。
- `failed`：追加 `workflow_failed`，finalize run plan 为 `failed`。
- `waiting_interaction`：追加 `workflow_waiting`，不写 `ended_at`，不 finalize run plan。
- `cancelled`：追加 `workflow_cancelled`，finalize run plan 为 `cancelled`。
- `crashed`：control ledger audit 失败时写 `workflow_crashed`，最终 run status 为 `crashed`。

最后总是重写：

```text
run_record.json
function_invocation.json
run_summary.json
```

其中 `ended_at` 只在 terminal status 上写入。非终态如 `waiting_interaction` 不写 `ended_at`。

## 5. Run Directory Ownership And Path Safety

### 5.1 Run ID

`validate_run_id()` 限制 `run_id`：

- 必须是非空 string。
- 不能是 `.`、`..`。
- 不能以 `_` 开头。
- 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`。
- 不能包含 drive、root、path separator。

这防止 `run_id` 被用作 path traversal。

### 5.2 Canonical Run Dir

canonical path：

```text
<project_root>/runs/<run_id>
```

`resolve_run_dir(project_root, run_id)` 必须保证 resolved run dir 的 parent 是 `<project_root>/runs`。

`claim_run()` 创建 run dir，并写：

```text
.acc-run-marker.json
```

marker 内容包括：

```text
schema_version
run_id
created_at
project_root_fingerprint
storage_version
created_by = "acc"
workflow_id?
task_id?
```

### 5.3 `prepare_runtime_run_dir()`

运行时准备目录的规则：

- run dir 不存在：创建目录；如果是 canonical run dir，则写 `.acc-run-marker.json`。
- run dir 已存在且是 canonical：必须通过 `assert_acc_run_dir()` 验证 marker。
- run dir 已存在且不是 canonical：只有空目录可复用；非空目录直接拒绝。

这条规则的意义是：runtime 不能误删或覆盖用户目录，也不能把非 ACC 目录当作 run evidence。

### 5.4 Atomic Write And JSONL Append

`write_json_atomic()` / `write_text_atomic()`：

- 先写临时文件。
- flush + fsync。
- replace 到目标路径。
- 非 Windows 上 fsync parent dir。

`append_jsonl_locked()`：

- 每个 JSONL path 有进程内 lock。
- 追加前扫描现有 `sequence`，写入下一个 sequence。
- 每行是完整 JSON object。
- flush + fsync。

因此 `events.jsonl` 是 append-only timeline，并带单调 sequence。

## 6. Control Ledger

### 6.1 Purpose

Control ledger 是运行期控制面的事实源。它解释：

- 这次 run 的计划是什么。
- 每个 node 什么时候 ready、dispatching、running、success、failed、skipped、cancelled、waiting。
- 谁做出了 dispatch 或 compile decision。
- dispatch 和实际 session/artifact/failure 之间如何关联。

### 6.2 Files

```text
run_plan.json       # 当前 run 的 RunPlan 摘要
plan_steps.jsonl    # PlanStep transition records
dispatches.jsonl    # DispatchEnvelope transition records
decisions.jsonl     # DecisionRecord source of truth
events.jsonl        # timeline/index; 可引用 decision/dispatch/step
```

`events.jsonl` 不是 `DecisionRecord` 正文。decision 正文必须在 `decisions.jsonl`。

### 6.3 Writer Boundary

`FixedRunControlLedgerWriter` 是唯一 mutable writer。

它负责：

- `initialize()`：写 run plan、initial steps、compile decision。
- `start_dispatch()`：确保 step ready，写 dispatch decision，写 dispatch started，step 进入 `dispatching` 和 `running`。
- `complete_dispatch()`：读取 node session/artifact evidence，写 dispatch completed，step 进入 `success`。
- `fail_dispatch()`：写 dispatch failed，step 进入 `failed`。
- `skip_steps()`：依赖失败时把未启动后继标记为 `skipped`。
- `cancel_steps()`：取消未启动 step。
- `wait_for_human_approval()`：创建 pending interaction，step 进入 `waiting_interaction`。
- `finalize_run_plan()`：把 run plan 置为 `completed` / `failed` / `cancelled`。

所有状态迁移必须通过 `acc.state_machine` 的 pure transition helper 验证。

### 6.4 Audit Failure Boundary

如果 control ledger 写入失败，`FixedRunControlLedgerWriter.write_audit()` 会抛
`ControlLedgerAuditError`。

`run_workflow_function_invocation()` 捕获后把 run 标记为 `crashed`，而不是普通 `failed`。

原因：普通 `failed` 表示业务节点执行失败；`crashed` 表示 ACC 自己的审计事实可能缺失或不一致。尤其当 node 已经写出 output/artifact，但 ledger completion 失败时，不能用普通 failed 掩盖“执行事实存在但审计事实不完整”的混合状态。

## 7. Ready-Queue Scheduling

### 7.1 Scheduler State

`run_ready_queue_execution()` 使用 `DAGScheduler` 管理节点生命周期。输入是：

- `ExecutionPlan.nodes`
- 每个 node 的 `depends_on`
- `workflow_max_concurrency(template)`

如果 `template.policies["max_concurrency"]` 缺失，则无上限；如果存在，必须是正整数。

### 7.2 Launch Rule

循环中：

1. 检查 `should_cancel()`。
2. 如果未停止 launch，计算当前 capacity。
3. 从 `scheduler.ready_nodes()` 中取最多 capacity 个 node。
4. `scheduler.mark_running(node_id)`。
5. 为每个 node 创建 async task，执行 `execute_core_v2_node_with_fixed_ledger()`。

`execute_core_v2_node_with_fixed_ledger()` 是 dispatch wrapper：

```text
human gate check
  -> control_ledger.start_dispatch()
  -> execute_core_v2_node()
  -> control_ledger.complete_dispatch()
```

失败时：

```text
execute_core_v2_node() raises
  -> control_ledger.fail_dispatch()
  -> scheduler.mark_failed_and_skip_descendants()
  -> control_ledger.skip_steps()
```

### 7.3 Human Gate

如果 `node_requires_human_approval(node)` 且 step 尚未有 answered gate：

```text
control_ledger.wait_for_human_approval(node)
return "waiting_interaction"
```

scheduler 收到 `waiting_interaction` 后：

- `scheduler.mark_waiting(node_id)`
- `terminal_status = waiting_interaction`
- `stop_launching = True`
- 等已有 running task 收束后返回 `waiting_interaction`

这不是 terminal failure。run 会保持可恢复状态。

### 7.4 Cancellation

如果 `should_cancel()` 第一次返回 true：

- `cancellation_requested = True`
- `stop_launching = True`
- `terminal_status = cancelled`
- `scheduler.cancel_unstarted()`
- `control_ledger.cancel_steps(cancelled)`
- 追加 `workflow_cancelled`

当前语义只取消“未启动节点”。已经 running 的 task 不会被强杀，而是等它们完成或失败后 scheduler 再返回。

这条边界很重要：`cancelled` 不等于所有子进程立刻中止。它表示 runtime 已停止新 dispatch，并把未启动 step 标记为 cancelled。

### 7.5 Stalled Scheduler

如果没有 running task：

- `waiting_interaction`：返回 `waiting_interaction`。
- cancellation requested：返回 `cancelled`。
- 有 failures/skips：返回 `failed`。
- 仍有 pending nodes：抛 `AccError("Ready-queue scheduler stalled with pending nodes")`。
- 否则返回 `success`。

stalled 是 runtime 逻辑错误或 plan/scheduler 状态不一致，不是正常业务失败。

## 8. Node Execution

### 8.1 Node Dir Initialization

`execute_core_v2_node()` 为每个 node 创建：

```text
nodes/<node_id>/
  artifacts/
  events.jsonl
  stdout.log
  stderr.log
  stdout.txt
  stderr.txt
```

并在 run-level `events.jsonl` 追加：

```text
node_started
```

### 8.2 SessionInstance

每个 node 创建一个 `SessionInstance`：

```text
session_id = session_<run_id>_<node_id>
invocation_id
scope_frame_id
node_id
callable_ref
callable_kind
status = running
cwd = scope.workspace_root
input_path = nodes/<node_id>/agent_payload.json
output_path = nodes/<node_id>/output.json
artifact_dir = nodes/<node_id>/artifacts
event_log_path = nodes/<node_id>/events.jsonl
started_at
```

初始写入：

```text
nodes/<node_id>/session_instance_manifest.json
```

成功后重写为 `status = success` 并写 `ended_at`。失败后重写为 `status = failed`、`ended_at`、`error`。

### 8.3 Payload Resolution

`resolve_node_payload()` 的优先和来源：

1. `node.overrides.static_input`
2. `template.workflow_input_bindings`
3. `node.input_bindings`
4. `template.data_edges`
5. control-main default forwarding

输出：

```text
ResolvedNodePayload(
  payload,
  binding_records,
)
```

落盘：

```text
nodes/<node_id>/agent_payload.json
nodes/<node_id>/input.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/runtime.json
nodes/<node_id>/binding_manifest.json
```

每条 binding record 同时追加 run-level event：

```text
input_materialized
```

binding record 记录：

- binding kind
- source node/port
- target node/port
- materialization
- source output path
- source result sha256

### 8.4 Empty Input Policy

如果 node metadata 设置：

```text
empty_input_policy = "block"
```

且 resolved payload 被 `is_empty_runtime_input()` 判断为空，则：

- 追加 `node_input_blocked` event。
- 抛 `AccError`。
- 进入节点失败路径。

“空”的规则：

- `None` 为空。
- 空白 string 为空。
- number / bool 不为空。
- dict/list/tuple 中所有元素为空才为空。

### 8.5 Callable Dispatch

`execute_core_v2_callable()` 当前分三类：

1. `workflow_function`：走 nested workflow path。
2. `agent_class` 且 callable registry 能 resolve：走 `AgentTurnService.run_workflow_node_turn()`。
3. 其他：走 hermetic callable 或 adapter stub。

不支持的 callable 抛：

```text
Unsupported Core v2 callable: <kind>:<id>
```

### 8.6 Output Materialization

callable 返回 `output` 后写：

```text
nodes/<node_id>/output.json
nodes/<node_id>/artifacts/payload.json
```

然后执行 artifact contract 校验。

端口输出由 `materialized_output_port_ids()` 决定：

- 如果有 `workflow_call_output_bindings`，根据 child workflow outputs 和 required flag 推导 parent ports。
- 否则优先 `node.output_bindings`。
- 其次 `node.output_ports`。
- 默认 `("default", "main")`。

`output_value_for_port()` 规则：

- `default` / `main` 返回整个 output。
- 如果 output 是 dict 且 `output["outputs"][port_id]` 存在，使用它。
- 否则如果 `output[port_id]` 存在，使用它。
- 否则是 missing。

required port missing 会抛 `AccError`。

每个 materialized port 写入：

```text
outputs[(node_id, port_id)] = value
result_store.put(run_id, node_id, port_id, value)
```

### 8.7 Node ArtifactBundle

节点成功后写：

```text
nodes/<node_id>/artifact_bundle.json
```

内容来自 domain-level `ArtifactBundle`：

```text
bundle_id = bundle_<run_id>_<node_id>
node_id
run_id
outputs
files = []
created_at
provenance.workflow_function_id
```

注意这里的 `ArtifactBundle` 是“节点产物集合”的 domain evidence；它不同于 result store 里的 storage-level `ArtifactBundle`，后者是单个 `(node_id, port_id)` 输出的 sha256/size/materialization 描述。

### 8.8 Node Failure

节点执行任何异常都会进入失败路径：

1. 更新 `session_instance_manifest.json` 为 `failed`。
2. 写：

```text
failures/failure_<run_id>_<node_id>.json
```

3. 写：

```text
nodes/<node_id>/stderr.txt
nodes/<node_id>/stderr.log
```

4. 追加 run-level event：

```text
node_failed
```

5. 重新抛异常，让 scheduler/ledger 处理 dispatch failed、step failed、后继 skip 和 workflow failed。

`FailureRecord.layer` 当前写为 `"adapter"`，即失败被归到 callable/adapter 执行层。

## 9. Nested Workflow

当 `node.callable_ref.kind == "workflow_function"`：

```text
execute_workflow_function_callable()
  -> resolve_workflow_function_path()
  -> resolve_workflow_call_input_payload()
  -> resolve_node_workflow_binding()
  -> run_core_v2_workflow_path(child_path, node_dir/nested_workflow, ...)
  -> read_child_workflow_outputs()
  -> apply_workflow_call_output_bindings()
```

### 9.1 Child Run Dir

child workflow run dir 固定为：

```text
nodes/<parent_node_id>/nested_workflow/
```

child invocation 记录：

- `parent_invocation_id = session.invocation_id`
- `parent_scope_frame_id = parent scope.frame_id`
- `call_depth = parent call_depth + 1`

### 9.2 Environment Policy

`environment_policy` 支持：

- `inherit_parent`：继承 parent workspace/binding；如果存在 explicit binding，则使用 binding workspace。
- `new_ephemeral`：child 使用自己的 ephemeral run workspace。
- `binding_required`：必须配置 binding，否则失败。
- `forbidden`：禁止 nested workflow。

binding 通过 `metadata.binding_ref` 指向 `bindings/` 下文件；resolved path 必须在 project `bindings/` 内，否则拒绝。

### 9.3 Child Output Mapping

child 成功后读取：

```text
nodes/<parent_node_id>/nested_workflow/workflow_outputs/*/output.json
```

再按 `workflow_call_output_bindings` 映射为 parent node output。

如果 child run status 不是 `success`，parent node 抛 `AccError`，进入普通 node failure path。

## 10. Result Store

### 10.1 Address

`FilesystemResultStore` 以 `runs_root` 为 root。每个端口输出地址是：

```text
(run_id, node_id, port_id)
```

磁盘 layout：

```text
runs/<run_id>/result_store/<node_id>/<port_id>.json
runs/<run_id>/result_store/<node_id>/<port_id>.bin
```

workflow-level outputs 使用特殊 node id：

```text
__workflow_outputs
```

### 10.2 Put Rule

`put_result_store_value()`：

1. 将 value 以 sorted JSON encode 成 bytes。
2. 计算 sha256。
3. 创建 storage-level `NodeResult`。
4. `inline_value` 写到 `<port_id>.bin`。
5. manifest 写到 `<port_id>.json`。

manifest 包含：

```text
run_id
node_id
port_id
bundle:
  bundle_id
  relative_path
  sha256
  size_bytes
  materialization_mode = inline
produced_at
```

`ArtifactBundle.relative_path` 必须是相对 `runs/<run_id>/` 的路径。绝对路径会被拒绝。

### 10.3 Meaning

`result_store` 是端口级结果事实，不是 UI 缓存。

`outputs[(node_id, port_id)]` 是当前进程内调度时的内存表；`result_store` 是 run evidence 中可复盘、可被后续 projection 读取的持久化表。

## 11. Workflow Outputs

workflow 完成且 terminal status 为 `success` 时，`write_workflow_outputs()` 根据
`template.workflow_output_bindings` 聚合 node outputs。

规则：

- 每个 binding 读取 `outputs[(source.node, source.port)]`。
- required binding 缺失则 run 失败。
- 同一个 target port 只有一个 source 时，直接写该 value。
- 多个 source 绑定到同一个 target port 时，写 `{source_node: output_value}`。

落盘：

```text
workflow_outputs/<target_port>/output.json
result_store/__workflow_outputs/<target_port>.json
result_store/__workflow_outputs/<target_port>.bin
```

`workflow_outputs/` 是 workflow 外部可见输出。node-level `output.json` 是节点执行输出。两者不能混为同一个事实。

## 12. Artifact Rules

### 12.1 Node Artifact Contract

`validate_artifact_contract()` 校验 `node.artifact_contract.required_paths` 和
`optional_paths`。

每个 rel path 都必须满足：

- 不是绝对路径。
- POSIX / Windows 形式都不是绝对路径。
- 不包含 `..`。

required path 必须存在于：

```text
nodes/<node_id>/artifacts/<rel_path>
```

缺失 required artifact 会导致 node failure。

### 12.2 Artifact Manifest V2

`artifact_manifest.py` 定义 artifact manifest 的展示/解析模型：

```text
version = 2.0
required[]
optional[]
```

每个 entry 包含：

```text
name
path
type
schema?
display
viewer
description
```

entry path 同样拒绝绝对路径和 `..`。这保证 artifact viewer/projection 不会通过 manifest 逃逸 artifact directory。

### 12.3 Legacy ArtifactStore Boundary

`acc/artifact_store.py` 是较早的单 session artifact helper，使用：

```text
session_manifest.json
run_manifest.json
conductor_output.json
```

Core v2 workflow runtime 当前热路径主要使用 `execute_core_v2_node()` 下的 node evidence、
`ArtifactBundle`、`result_store` 和 `run_summary.json`。新的 Core v2 spec 不应把 legacy
`ArtifactStore` 文件重新提升为 workflow runtime truth。

## 13. Inbox And Outbox

`ScopeFrame` 为每次 invocation 声明：

```text
inbox_root = run_dir/inbox
outbox_root = run_dir/outbox
artifact_root = run_dir/artifacts
```

当前热路径中，节点数据主要通过 `resolve_node_payload()` 和 node-level payload/evidence 传递，
而不是让 upstream 直接写 downstream inbox。

SDD 约束：

- upstream node 只能写自己的 output/artifacts/outbox。
- downstream node 的输入必须由 ACC 根据 bindings/data edges/control-main rules 物化。
- `binding_manifest.json` 必须能解释一次 payload 中每个非静态来源来自哪里。
- 如果未来使用 `transfer_policy.materialize()` 实现 copy/reference/symlink，必须记录实际 policy 和 degraded flag，不能静默改变数据流语义。

`acc/runtime/transfer_policy.py` 当前支持：

- `COPY`
- `REFERENCE`，硬链接失败降级为 copy。
- `SYMLINK`，symlink 失败降级为 copy。

降级必须被视为可观察事实，而不是实现细节。

## 14. Run Summary And Index

`write_core_v2_run_summary()` 生成：

```text
run_summary.json
```

它从每个已存在的：

```text
nodes/<node_id>/session_instance_manifest.json
```

生成 `NodeRunSummary`，包括：

- node id
- callable id
- session id
- status
- run dir
- input path
- prompt path
- output path
- artifact dir
- event log
- stdout/stderr log

`failed_nodes` 是 status 非 `success` 的 node 列表。

如果 run dir 是 canonical `runs/<run_id>`，还会重建：

```text
runs/index.json
```

并调用 `rebuild_storage_index(project_root)`。

边界：

- `run_summary.json` 是 projection，方便 API/Workbench 读取。
- `run_record.json`、control ledger、node evidence 才是更底层的事实。
- index 可以重建，不能作为唯一 truth。

## 15. Status Semantics

### 15.1 Run Status

当前 runtime 写入的主要 run status：

```text
running
success
failed
waiting_interaction
cancelled
crashed
```

语义：

- `running`：run 已初始化，scheduler 正在执行或准备执行。
- `success`：所有 required control branches 成功，workflow outputs 已写出。
- `failed`：至少一个节点业务/adapter 失败，或 workflow output required source 缺失。
- `waiting_interaction`：等待人类审批或交互，非终态。
- `cancelled`：取消请求已生效，未启动 step 被取消，不再 launch 新节点。
- `crashed`：ACC runtime/control ledger 审计路径失败，运行事实可能不完整。

### 15.2 Node Status

`SessionInstance.status` 当前主要：

```text
running
success
failed
```

`PlanStep.status` 更细：

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

不要用 `SessionInstance.status` 替代 `PlanStep.status`。前者说明执行实例结果，后者说明控制调度状态。

### 15.3 Terminal Boundary

`ended_at` 只应写在 terminal run status 上。`waiting_interaction` 不应写 `ended_at`，否则会把可恢复等待误投影为已结束。

## 16. Failure Modes

### 16.1 Compile / Validation Failure

发生在 run 初始化前或 control ledger 初始化前：

- template schema 不支持。
- unknown fields。
- duplicate node id。
- control graph cycle。
- control/data edge 指向缺失 node。
- data edge 不跟随 control dependency。
- invalid `max_concurrency`。

这类失败通常不会产生完整 run evidence；调用方应把它视为提交/编译失败，而不是节点失败。

### 16.2 Payload Materialization Failure

发生在 `resolve_node_payload()`：

- required workflow input 缺失。
- required binding source 缺失。
- required data edge source 缺失。
- required workflow call input source 缺失。
- `empty_input_policy = block` 且输入为空。

结果：

- node session 写为 failed。
- failure record 写入 `failures/`。
- dispatch failed。
- 后继 step skipped。
- run status 最终 failed。

### 16.3 Callable Failure

包括：

- hermetic callable 明确失败。
- unsupported callable。
- `AgentTurnService` / adapter 执行失败。
- nested workflow child run 非 success。

结果同 payload failure。

### 16.4 Artifact Contract Failure

如果 required artifact 不存在或 artifact path escape：

- node failed。
- failure record 指向 session manifest 和 stderr。
- run failed。

artifact contract failure 不是 storage failure，而是 callable 没有满足声明契约。

### 16.5 Workflow Output Failure

如果 workflow success 前写 outputs 时 required source 缺失：

- `write_workflow_outputs()` 抛 `AccError`。
- `run_workflow_function_invocation()` 捕获为普通 `failed`。
- 追加 `workflow_failed`。

此时 node 可能全部 success，但 workflow 仍 failed，因为外部输出契约没有满足。

### 16.6 Scheduler Stall

ready queue 没有 running task，但仍有 pending nodes，抛 `AccError`。

这代表 scheduler/plan 状态不一致。当前会进入 `failed`，但从排查角度应视为 runtime bug。

### 16.7 Control Ledger Audit Failure

任何 control ledger 写入或读取 required evidence 失败，抛 `ControlLedgerAuditError`。

结果：

- run status = `crashed`
- event = `workflow_crashed`

这是 ACC 自身审计系统失败，不是 agent/tool 的业务失败。

### 16.8 Storage / Path Failure

包括：

- run dir 非法。
- canonical run dir marker 缺失或不匹配。
- 非 canonical 非空目录复用。
- atomic write/replace 失败。
- result store relative path 是绝对路径。
- artifact manifest path escape。

这类失败必须 fail fast，不能继续写部分 evidence 后假装成功。

## 17. Evidence File Responsibilities

| Path | Owner | Truth Level | Purpose |
| --- | --- | --- | --- |
| `.acc-run-marker.json` | `acc.storage` | Source of truth | 证明 canonical run dir 由 ACC claim |
| `function_invocation.json` | runtime orchestrator | Source of truth | 一次 workflow function 调用的运行态 |
| `scope_frame.json` | runtime orchestrator | Source of truth | workspace/inbox/outbox/artifact/snapshot roots |
| `behavior_snapshot/workflow_function_template.json` | runtime orchestrator | Source of truth | 本次 run 使用的 template snapshot |
| `run_record.json` | runtime orchestrator | Source of truth | run id、workflow id、status、event log、result store root |
| `run_summary.json` | runtime workflow_io | Projection | API/Workbench 读取的 summary |
| `events.jsonl` | runtime/control ledger | Timeline/index | run-level events，带 sequence |
| `run_plan.json` | control ledger | Source of truth | 当前 run plan |
| `plan_steps.jsonl` | control ledger | Source of truth | PlanStep 状态历史 |
| `dispatches.jsonl` | control ledger | Source of truth | DispatchEnvelope 状态历史 |
| `decisions.jsonl` | control ledger | Source of truth | compile/dispatch/human/supervisor/handoff decisions |
| `nodes/<node_id>/session_instance_manifest.json` | node executor | Source of truth | 单次 agent/tool execution |
| `nodes/<node_id>/agent_payload.json` | node executor | Source of truth | callable 实际输入 |
| `nodes/<node_id>/runtime_payload.json` | node executor | Evidence | run/node/callable/binding runtime metadata |
| `nodes/<node_id>/binding_manifest.json` | node executor | Evidence | 输入来源和 binding 记录 |
| `nodes/<node_id>/output.json` | node executor | Source of truth | callable 返回输出 |
| `nodes/<node_id>/artifact_bundle.json` | node executor | Source of truth | node-level artifact bundle |
| `nodes/<node_id>/events.jsonl` | node executor | Timeline | node-local event log |
| `nodes/<node_id>/stdout.log` | adapter/runtime | Evidence | stdout log |
| `nodes/<node_id>/stderr.log` | adapter/runtime | Evidence | stderr log + runtime error |
| `failures/<failure_id>.json` | node executor | Source of truth | failure record |
| `result_store/<node_id>/<port_id>.json` | result store | Source of truth | port result manifest |
| `result_store/<node_id>/<port_id>.bin` | result store | Source of truth | inline port value |
| `workflow_outputs/<port>/output.json` | workflow_io | Source of truth | workflow exposed output |
| `runs/index.json` | run_index | Projection | run summary index，可重建 |

## 18. Interfaces With Other SDD Sections

依赖 `02-domain-and-contracts.md`：

- domain object 字段、枚举、schema version。
- Template/runtime state 分离契约。

被 `05-interfaces-and-workbench.md` 消费：

- API/Workbench 只能读取 run evidence projection。
- active task/run handles 不能替代 durable evidence。

被 `06-verification-and-delivery.md` 验收：

- run evidence 文件完整性。
- control ledger transition consistency。
- default tests hermetic。
- CLI JSON 输出不被 runtime logs 污染。

与 `04-authoring-and-governance.md` 的边界：

- GraphOps 修改 template/callable/workflow definitions。
- runtime evidence 不应被 GraphOps 当作可编辑 template。

## 19. Verification

### 19.1 Backend Default Checks

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
```

或在依赖齐全时：

```bash
uv run pytest -q
```

### 19.2 Focused Runtime Checks

建议最小验收覆盖：

1. 成功的一节点 Core v2 workflow：
   - `run_record.json.status == success`
   - `function_invocation.json.status == success`
   - `scope_frame.json` 存在
   - `nodes/<node>/session_instance_manifest.json.status == success`
   - `nodes/<node>/output.json` 存在
   - `nodes/<node>/artifact_bundle.json` 存在
   - `result_store/<node>/main.json|.bin` 或 default/main 端口结果存在

2. 两层 control dependency：
   - 后继节点只在前驱 success 后 dispatch。
   - `plan_steps.jsonl` 中依赖 step id 正确。
   - `binding_manifest.json` 记录 upstream source。

3. data edge required source 缺失：
   - node failed。
   - `failures/failure_<run_id>_<node>.json` 存在。
   - 后继 step skipped。
   - run failed。

4. human approval node：
   - run status 为 `waiting_interaction`。
   - `ended_at` 为空。
   - `plan_steps.jsonl` 有 `waiting_interaction`。
   - interaction evidence 存在。

5. cancel：
   - 不再 launch 新节点。
   - 未启动 step cancelled。
   - running task 收束后 run cancelled。

6. control ledger audit failure：
   - run status 为 `crashed`。
   - event 为 `workflow_crashed`。
   - 不把审计失败伪装成普通 node failed。

7. nested workflow：
   - child run dir 位于 `nodes/<parent_node>/nested_workflow/`。
   - child `parent_invocation_id` / `parent_scope_frame_id` 正确。
   - parent output 包含 mapped child workflow outputs。

8. path safety：
   - 非法 `run_id` 被拒绝。
   - canonical run dir marker 缺失时拒绝复用。
   - artifact required path 中绝对路径或 `..` 被拒绝。
   - result store absolute `relative_path` 被拒绝。

### 19.3 Manual Inspection Checklist

一次 run 完成后，人工检查应优先看：

```text
run_record.json
run_summary.json
events.jsonl
run_plan.json
plan_steps.jsonl
dispatches.jsonl
decisions.jsonl
nodes/<node_id>/session_instance_manifest.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/output.json
nodes/<node_id>/artifact_bundle.json
failures/*.json
workflow_outputs/*/output.json
result_store/**/*
```

如果 UI 显示和这些文件冲突，以 run evidence 为准。

## 20. Code References

当前 spec 基于以下代码事实：

- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/app/runtime/workflow_io.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/runtime/node_payload.py`
- `acc/runtime/io.py`
- `acc/runtime/transfer_policy.py`
- `acc/storage.py`
- `acc/store/__init__.py`
- `acc/store/control_ledger.py`
- `acc/result_store/filesystem.py`
- `acc/result_store/types.py`
- `acc/artifact_store.py`
- `acc/artifact_manifest.py`
- `acc/run_index.py`
- `acc/ledger_writer.py`
- `acc/engine/__init__.py`
- `acc/engine/control_ledger.py`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/01_RUNTIME_CONTROL_LEDGER.md`
- `docs/Design/02_FIXED_RUNPLAN_DISPATCH.md`
