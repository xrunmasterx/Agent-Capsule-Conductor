# A. Code Module Map

本文是 ACC SDD 的代码模块映射附录。它不是按目录机械列文件，而是按产品/架构能力说明当前代码的所有权边界、主要入口、职责、禁止事项和相关测试。

本文依据：

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `rg --files`
- 当前 `acc/`、`web/src/`、`tests/` 目录结构

核心判断：ACC 当前是 Core v2 callable-only 架构。代码模块的第一性原理不是“哪个目录放了什么”，而是“谁拥有定义、谁拥有运行事实、谁负责执行副作用、谁只是投影”。后续 AI 或开发者定位代码时，应先按能力找 owner，再落到文件。

## 1. Core Domain

**Owner**

`acc.models` 拥有 ACC 的领域类型系统。它定义“什么东西存在”，不负责“怎么加载、怎么运行、怎么写文件”。

**主要文件**

- `acc/models.py`
- `acc/constants.py`

**职责**

- 定义 Core v2 的不可变领域对象，例如 `AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate`、`NodeInvocationSpec`、`CallableRef`。
- 定义运行态对象，例如 `FunctionInvocation`、`ScopeFrame`、`SessionInstance`、`RunRecord`、`NodeInvocationRun`、`EventRecord`、`ArtifactBundle`。
- 定义控制面对象，例如 `RunPlan`、`PlanStep`、`DispatchEnvelope`、`DecisionRecord`、`ReplayPolicy`、`InteractionRequest`、`HandoffRequest`。
- 承载共享枚举值、状态名和常量的类型语义。

**机制边界**

领域模型只回答“数据长什么样”和“对象之间是什么关系”。例如：

```text
WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> CallableRef

FunctionInvocation
  -> ScopeFrame
  -> SessionInstance
  -> RunRecord / EventRecord / ArtifactBundle
```

这里不应该出现路径扫描、文件写入、HTTP、React 状态、subprocess 调用或外部 agent 协议。

**禁止事项**

- 不要在 `acc.models` 中读写 filesystem。
- 不要在 template 类型里加入 `run_id`、`session_id`、run directory、workspace binding、conversation memory、上次输出或 UI 状态。
- 不要把 UI projection 字段做成领域事实。
- 不要为局部 API response 增加一次性 domain type，除非它代表稳定领域概念。

**相关测试**

- `tests/unit/test_core_v2_domain_model.py`
- `tests/unit/test_callable_domain.py`
- `tests/unit/test_control_ledger_domain.py`
- `tests/test_state_machine.py`
- `tests/architecture/test_import_boundaries.py`
- `tests/architecture/test_phase1_import_boundaries.py`

## 2. Serialization / Validation / Schemas

**Owner**

`acc.serialization`、`acc.validation` 和 `schemas/` 拥有领域对象与 JSON wire format 之间的转换、校验和兼容边界。

**主要文件**

- `acc/serialization.py`
- `acc/validation.py`
- `acc/schemas.py`
- `schemas/*.json`

**职责**

- `workflow_function_template_to_dict()` / `workflow_function_template_from_dict()` 等函数负责 Core v2 template 的字典化与反序列化。
- `execution_plan_to_dict()`、`control_ledger_to_dict()` 等函数负责运行计划和控制账本的 wire projection。
- `validate_core_v2_*` 函数负责校验 callable、workflow、execution plan、port、permission、artifact contract。
- `schemas/*.json` 保存外部可见文件格式、事件格式、manifest、quality report、permission profile 等 JSON Schema。

**机制边界**

这层的本质是“把不可信输入变成可信领域对象，或者把领域对象变成稳定 JSON”。它应尽早拒绝未知字段、非法 port、非法 ref、可执行 metadata、危险 artifact path 或 template/runtime 混用。

**禁止事项**

- 不要在 validation 中执行外部命令、检查真实 provider 是否安装、读取运行目录状态。
- 不要在 serialization 中偷偷补运行态字段。
- 不要复制一套新的 JSON schema 校验 helper；优先复用 `acc/validation.py`、`acc/schemas.py`、`acc/utils.py`。
- 不要让 legacy `*.graph.json` 成为新 runtime 的直接输入语义。

**相关测试**

- `tests/unit/test_core_v2_serialization.py`
- `tests/unit/test_core_v2_validation.py`
- `tests/unit/test_callable_schema.py`
- `tests/unit/test_schemas.py`
- `tests/unit/test_validation.py`
- `tests/unit/test_core_v2_output_schema_and_ports.py`
- `tests/unit/test_legacy_graph_rejected.py`

## 3. Engine

**Owner**

`acc.engine` 和 `acc.scheduler` 拥有纯计算层：解析、规范化、依赖分析、计划形态、ready set 和状态转移的静态语义。

**主要文件**

- `acc/engine/__init__.py`
- `acc/engine/workflow_validation.py`
- `acc/engine/control_ledger.py`
- `acc/engine/supervisor.py`
- `acc/engine/handoff.py`
- `acc/engine/_ref_utils.py`
- `acc/scheduler/ready_set.py`
- `acc/state_machine.py`

**职责**

- 把 Core v2 workflow payload 解析成 `WorkflowFunctionTemplate`。
- 校验 `NodeInvocationSpec`、`CallableRef`、`ControlEdge`、`DataEdge`、workflow-call binding。
- 编译 `ExecutionPlan` 和 topological levels。
- 区分 control dependency 与 data dependency。
- 计算 ready set 和固定 `RunPlan` / `PlanStep` 形态。
- 编译 supervisor plan、handoff request 到控制计划片段。
- 提供 `PlanStep`、dispatch、run status 的纯状态机规则。

**机制边界**

Engine 的输入是领域对象或 JSON payload，输出是领域对象、issue list、plan shape 或状态转移结果。它不拥有任何真实运行事实。

```text
WorkflowFunctionTemplate + static input
  -> validation / normalization / dependency analysis
  -> ExecutionPlan / RunPlan shape
```

`ExecutionPlan` 只是计划，不是 run evidence。

**禁止事项**

- 不要在 `acc.engine` 里读写文件。
- 不要 spawn process。
- 不要导入 `acc.server`、`web/`、FastAPI、React 或 adapter。
- 不要根据宿主机环境决定 workflow 是否可运行；provider 能力检查属于 adapter/runner/app 层。
- 不要把 data edge 当成唯一调度依赖；调度语义必须以 control edge 和明确规则为准。

**相关测试**

- `tests/unit/test_core_v2_execution_plan.py`
- `tests/unit/test_scheduler_ready_set.py`
- `tests/unit/test_supervisor_validation.py`
- `tests/unit/test_handoff_validation.py`
- `tests/test_state_machine.py`
- `tests/architecture/test_import_boundaries.py`
- `tests/integration/test_supervisor_planstep_p0.py`
- `tests/integration/test_handoff_p0.py`

## 4. Runtime

**Owner**

`acc.app.runtime` 和 `acc.runtime` 拥有一次 workflow/function/node 执行的实际运行机制，包括 payload materialization、调度循环、node execution、nested workflow、artifact contract 和 workflow outputs。

**主要文件**

- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/app/runtime/workflow_io.py`
- `acc/app/core_v2_runtime.py`
- `acc/runtime/node_payload.py`
- `acc/runtime/io.py`
- `acc/runtime/transfer_policy.py`
- `acc/runtime/policy.py`
- `acc/runtime/payload.py`
- `acc/runtime/codex_models.py`
- `acc/hermetic_callables.py`
- `acc/callable_runner.py`

**职责**

- 启动 Core v2 workflow run。
- 创建 `FunctionInvocation`、`ScopeFrame` 和 run directory 初始证据。
- 根据 `ExecutionPlan` / `RunPlan` 驱动 ready queue。
- 执行 agent/tool/hermetic callable/nested workflow。
- 为 node 构造 `agent_payload.json`、`runtime_payload.json`、`binding_manifest.json`。
- 把 upstream outbox/result/artifact 显式 materialize 到 downstream inbox。
- 写出 `workflow_outputs/<port>/output.json`、`run_summary.json`、node output 和 artifact bundle。
- 处理 failure、cancel、timeout、waiting interaction、nested run 等运行态路径。

**机制边界**

Runtime 的核心路径是：

```text
.accflow.json
  -> WorkflowFunctionTemplate
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> RunPlan / control ledger
  -> SessionInstance or child FunctionInvocation
  -> outputs / events / artifacts / summary
```

这层可以有 IO 和 process effects，但这些 effect 必须被 run evidence 捕获。

**禁止事项**

- 不要绕过 `ScopeFrame` 直接把 upstream 输出写进 downstream workspace。
- 不要让 node 执行结果只存在内存里；终态、输出、日志和 artifact 必须可审计。
- 不要把 UI 的 `activeRunId`、`latestRunId` 或 node display status 写回 workflow template。
- 不要在 runtime 内部发明不在状态机/证据中可追踪的 terminal status。
- 不要把 legacy `node_runs/` 或 `workflow_graph.json` 重新作为新运行事实源。

**相关测试**

- `tests/integration/test_core_v2_workflow_run.py`
- `tests/integration/test_core_v2_workflow_failure.py`
- `tests/integration/test_core_v2_workflow_bindings.py`
- `tests/integration/test_core_v2_workflow_artifacts.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_core_v2_workflow_cli.py`
- `tests/unit/test_runtime_payload_split.py`
- `tests/unit/test_runtime_policy.py`
- `tests/unit/test_runtime_transfer_policy.py`
- `tests/unit/test_callable_runner_timeout.py`
- `tests/unit/test_node_run_summary.py`

## 5. Storage / Evidence / Artifacts

**Owner**

`acc.storage`、`acc.store`、`acc.result_store`、artifact 模块和 run index 模块拥有本地持久化事实。ACC 没有默认数据库；运行证据和 manifest 文件就是 durable truth。

**主要文件**

- `acc/storage.py`
- `acc/storage_refs.py`
- `acc/storage_index.py`
- `acc/storage_gc.py`
- `acc/store/__init__.py`
- `acc/store/control_ledger.py`
- `acc/result_store/filesystem.py`
- `acc/result_store/types.py`
- `acc/artifact_store.py`
- `acc/artifact_manifest.py`
- `acc/run_index.py`
- `acc/persistence/manifest.py`
- `acc/persistence/events.py`
- `acc/persistence/cache_key.py`
- `acc/workspace.py`
- `acc/environment.py`
- `acc/port_io.py`
- `runs/`

**职责**

- 生成和校验 `run_id`。
- claim canonical `runs/<run_id>` 并写 `.acc-run-marker.json`。
- 防止 path traversal 和误覆盖非 ACC 目录。
- 提供 `write_json_atomic()`、`write_text_atomic()`、`append_jsonl_locked()` 等原子写和 JSONL sequence 机制。
- 管理 `result_store/`、artifact manifest、artifact preview reference、run index 和 GC。
- 维护 inbox/outbox、port IO、workspace/environment binding 的持久化边界。

**机制边界**

Storage 的本质是“让运行事实可恢复、可审计、可投影”。典型文件包括：

```text
runs/<run_id>/run_record.json
runs/<run_id>/run_summary.json
runs/<run_id>/function_invocation.json
runs/<run_id>/scope_frame.json
runs/<run_id>/events.jsonl
runs/<run_id>/result_store/
runs/<run_id>/workflow_outputs/<port>/output.json
runs/<run_id>/nodes/<node_id>/session_instance_manifest.json
runs/<run_id>/nodes/<node_id>/runtime_payload.json
runs/<run_id>/nodes/<node_id>/agent_payload.json
runs/<run_id>/nodes/<node_id>/binding_manifest.json
runs/<run_id>/nodes/<node_id>/output.json
runs/<run_id>/nodes/<node_id>/events.jsonl
runs/<run_id>/nodes/<node_id>/artifact_bundle.json
```

**禁止事项**

- 不要 ad hoc 写 JSON、复制目录或追加 JSONL；优先使用集中 helper。
- 不要允许未校验的 run id、artifact id、relative path、absolute local path 穿过 API 或 projection。
- 不要把 storage index 当成唯一事实；它是索引和加速结构，run evidence 才是事实。
- 不要让 GC 删除没有 ACC marker 或无法证明归属的目录。

**相关测试**

- `tests/unit/test_storage.py`
- `tests/unit/test_storage_gc.py`
- `tests/unit/test_result_store_filesystem.py`
- `tests/unit/test_artifact_store.py`
- `tests/unit/test_artifact_manifest_v2.py`
- `tests/unit/test_persistence_manifest.py`
- `tests/unit/test_persistence_events.py`
- `tests/unit/test_persistence_cache_key.py`
- `tests/unit/test_run_index.py`
- `tests/server/test_artifacts_api.py`
- `tests/server/test_workflows_storage_contract.py`

## 6. Control Ledger / Supervisor / Handoff / Human Gate

**Owner**

`acc.ledger_writer`、`acc.store.control_ledger`、`acc.engine.control_ledger` 和相关 app service 拥有运行控制面的可审计状态。它记录“谁基于什么证据决定下一步”。

**主要文件**

- `acc/ledger_writer.py`
- `acc/store/control_ledger.py`
- `acc/engine/control_ledger.py`
- `acc/control_ledger_codec.py`
- `acc/control_plane.py`
- `acc/app/control_projection.py`
- `acc/app/decisions.py`
- `acc/app/human_gate.py`
- `acc/app/human_gate_service.py`
- `acc/app/interactions.py`
- `acc/app/supervisor.py`
- `acc/app/handoff.py`
- `acc/app/run_events.py`
- `acc/app/run_lifecycle.py`
- `acc/app/run_projection.py`
- `acc/app/invocation.py`
- `acc/app/node_invocation.py`

**职责**

- 生成固定 `RunPlan` 和 `PlanStep`。
- 用 `FixedRunControlLedgerWriter` 作为 run state 的唯一 mutable writer。
- 写入 plan step transition、dispatch transition、decision record、control event。
- 支持 human gate、interaction request、decision answer、resume/replay。
- 支持 supervisor 动态计划和 handoff 模式。
- 为 API / Workbench 提供控制账本投影。

**机制边界**

这层不是普通 DAG 调度器。它的第一性原理是“控制过程也要留下证据”：

```text
RunPlan
  -> PlanStep
  -> DispatchEnvelope
  -> DecisionRecord / InteractionRequest
  -> transition records
  -> control ledger projection
```

**禁止事项**

- 不要让多个 writer 同时修改 control ledger。
- 不要在没有 decision evidence 的情况下跳过 human gate。
- 不要把 supervisor/handoff 的动态节点直接塞进 template，动态行为属于 run evidence。
- 不要把 audit error 静默降级成普通业务输出。
- 不要让 API/UI 直接改 ledger 文件绕过 app service。

**相关测试**

- `tests/unit/test_control_ledger_store.py`
- `tests/unit/test_control_ledger_domain.py`
- `tests/server/test_control_ledger_api.py`
- `tests/server/test_decisions_api.py`
- `tests/server/test_run_interactions_lifecycle.py`
- `tests/unit/test_human_gate.py`
- `tests/unit/test_handoff_validation.py`
- `tests/unit/test_supervisor_validation.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_supervisor_planstep_p0.py`
- `tests/integration/test_handoff_p0.py`

## 7. GraphOps / Authoring

**Owner**

`acc.graphops` 和 `acc.app.authoring` 拥有受控 mutation path。它们的核心职责不是“帮 AI 写文件”，而是让 AI/human 对 workflow/callable 的持久化修改经过 proposal、validation、dry-run、approval、apply。

**主要文件**

- `acc/graphops.py`
- `acc/app/authoring.py`
- `acc/app/agent_sessions.py`
- `acc/app/capabilities.py`
- `acc/app/callable_refs.py`
- `acc/app/template_bundle.py`
- `acc/app/workflow_refs.py`
- `acc/app/workflow_normalization.py`
- `acc/app/workbench_adapter.py`
- `acc/app/workbench_snapshots.py`
- `acc/app/workbench_tasks.py`
- `acc/callable_registry.py`
- `acc/file_source_tool.py`
- `examples/graphops/add-review-node.patch.json`
- `callables/`
- `workflows/`

**职责**

- 维护 callable registry 和 workflow template 的加载、引用、规范化、bundle 写入。
- 处理 authoring session、assistant proposal、draft validation 和 dry-run。
- `GraphOpsService` 通过 typed operation handler 处理 `create_agent_class`、`create_tool_class`、`create_workflow` 等操作。
- 校验 target path、base hash、materialized transaction、semantic diff。
- 在 approval 后 apply 到 durable callable/workflow assets。

**机制边界**

GraphOps 是定义态 mutation 的控制平面：

```text
intent / assistant proposal
  -> GraphOps proposal
  -> validation
  -> materialized transaction
  -> semantic diff / dry-run
  -> human approval
  -> apply to callables/ or workflows/
```

**禁止事项**

- 不要让 LLM 直接修改 durable workflow/callable assets 并绕过 GraphOps。
- 不要让 GraphOps 修改 run evidence。
- 不要在未 approval 的情况下 apply destructive 或 privilege-expanding change。
- 不要允许 target path escape project root。
- 不要用 legacy patch 语义替代 Core v2 typed operation handler。

**相关测试**

- `tests/unit/test_graphops_v3.py`
- `tests/unit/test_graphops_operation_handlers.py`
- `tests/unit/test_graphops_governance.py`
- `tests/server/test_graphops_api.py`
- `tests/unit/test_authoring_service.py`
- `tests/server/test_authoring_api.py`
- `tests/unit/test_callable_registry_core_v2.py`
- `tests/unit/test_core_v2_loader.py`
- `tests/unit/test_template_bundle.py`
- `tests/unit/test_workflow_refs.py`
- `tests/unit/test_workflow_normalization.py`

## 8. Server / API

**Owner**

`acc.server` 拥有 HTTP API、SSE/live events、API projection 和本地安全中间件。它是 thin interface layer，不是 durable truth。

**主要文件**

- `acc/server/app.py`
- `acc/server/context.py`
- `acc/server/security.py`
- `acc/server/live_events.py`
- `acc/server/run_manager.py`
- `acc/server/run_projection.py`
- `acc/server/routes/health.py`
- `acc/server/routes/workflows.py`
- `acc/server/routes/runs.py`
- `acc/server/routes/workbench.py`
- `acc/server/routes/callables.py`
- `acc/server/routes/agent_sessions.py`
- `acc/server/routes/authoring.py`
- `acc/server/routes/graphops.py`
- `acc/server/routes/decisions.py`
- `acc/server/routes/interactions.py`
- `acc/server/routes/artifacts.py`
- `acc/server/routes/debugger.py`
- `acc/server/routes/runner.py`

**职责**

- `create_app()` 注册 FastAPI routes。
- 暴露 workflow save/run/validate/binding APIs。
- 暴露 async Workbench run path：`POST /api/workflows/run-graph/submit`。
- 暴露 run projection、events、node logs、artifacts、control ledger、decisions、interactions。
- 暴露 callable、authoring、GraphOps、agent session 和 runner APIs。
- 提供 SSE event replay/live stream 和 bounded queue。
- 执行 request path 校验、local auth、origin 策略、project root resolution。

**机制边界**

Server 的输出是 projection，不是事实。事实来自：

```text
workflows/*.accflow.json
callables/
runs/<run_id>/
control ledger files
app services
```

`WorkbenchRunManager` 和 active task map 是 execution handle，不是 durable record。

**禁止事项**

- 不要在 route 中发明新的 domain status 并绕过 `RunRecord` / control ledger。
- 不要把 in-memory job map 当成唯一运行事实。
- 不要让 route 直接写复杂 runtime evidence；应走 app/runtime/storage helper。
- 不要允许未校验的 path、run id、artifact id 进入文件系统。
- 不要把 server 变成业务规则堆积层；核心规则应下沉到 app/engine/runtime/storage。

**相关测试**

- `tests/server/test_health.py`
- `tests/server/test_workbench_core_v2_api.py`
- `tests/server/test_workbench_canvas_snapshots_api.py`
- `tests/server/test_workflows_storage_contract.py`
- `tests/server/test_runs_projection_api.py`
- `tests/server/test_run_projection_api.py`
- `tests/server/test_run_log_projection_api.py`
- `tests/server/test_artifacts_api.py`
- `tests/server/test_agent_sessions_api.py`
- `tests/server/test_authoring_api.py`
- `tests/server/test_graphops_api.py`
- `tests/server/test_decisions_api.py`
- `tests/server/test_control_ledger_api.py`
- `tests/server/test_core_decoupling.py`
- `tests/integration/test_runinspector_routes.py`

## 9. Workbench

**Owner**

`web/src` 拥有 ACC 的交互投影和可视化编辑面。Workbench 可以编辑定义态资产、提交运行、显示运行证据，但不能成为 runtime truth。

**主要文件**

- `web/src/App.tsx`
- `web/src/api.ts`
- `web/src/types.ts`
- `web/src/stores/workbenchStore.ts`
- `web/src/stores/runStore.ts`
- `web/src/stores/assistantStore.ts`
- `web/src/hooks/useRunStream.ts`
- `web/src/hooks/useAssistantStream.ts`
- `web/src/components/WorkflowViewer.tsx`
- `web/src/components/workflow-viewer/*`
- `web/src/components/canvas/*`
- `web/src/components/workbench/*`
- `web/src/components/authoring/*`
- `web/src/components/assistant/*`
- `web/src/components/execution/*`
- `web/src/components/inspector/*`
- `web/src/components/RunInspector.tsx`
- `web/src/components/RunList.tsx`
- `web/src/components/RunMonitorPage.tsx`
- `web/src/components/ArtifactViewer.tsx`
- `web/src/i18n/zh-CN.ts`
- `web/src/styles.css`

**职责**

- 以 graph canvas 作为 workflow/task 的主编辑面。
- 管理 Workbench task、canvas snapshot、selected node、panel state、assistant drawer 等交互状态。
- 通过 API 保存 workflow、提交 run、读取 run projection、events、node logs 和 artifacts。
- 用 `run_id + task_id` 建模多任务/多运行投影。
- 显示 authoring session、proposal review、decision inbox、execution dock、node inspector。
- 保持中文用户可见标签。

**机制边界**

Workbench 的模型应该是：

```text
task canvas definition
  -> submit run
  -> run_id
  -> run summary/events/artifacts
  -> UI overlay projection for selected task/run
```

UI stores 可以记住 convenience pointer，例如 selected task、active run、latest run、展开状态，但这些不是 durable truth。

**禁止事项**

- 不要使用全局 `isRunning` singleton 管理所有任务。
- 不要把 node terminal status、prior output、run id、agent memory 写回 reusable workflow template。
- 不要让 React state 成为 artifact、event、run status 的唯一事实。
- 不要把 system prompt 放到 task node invocation prompt；class-level prompt 属于 Agent/Tool class resource。
- 不要绕过 API/GraphOps 直接修改 durable files。

**相关测试**

- `web/src/App.test.tsx`
- `web/src/components/WorkflowViewer.drag.test.tsx`
- `web/src/lib/runTranscript.test.ts`
- `tests/server/test_workbench_core_v2_api.py`
- `tests/server/test_workbench_canvas_snapshots_api.py`
- `tests/unit/test_workbench_adapter.py`
- `tests/unit/test_workbench_run_manager.py`

## 10. CLI / MCP

**Owner**

`acc.cli` 和 `acc.mcp_server` 拥有外部命令行与 MCP 接入面。它们是 ACC 被脚本、agent 或工具调用的边界。

**主要文件**

- `acc/cli.py`
- `acc/mcp_server/server.py`
- `acc/mcp_server/tools.py`
- `acc/mcp_server/schemas.py`
- `acc/mcp_server/audit.py`
- `README.md`

**职责**

- 提供 `acc run`、workflow import/list/show/validate、GraphOps、debugger 等 CLI 能力。
- 维持 machine-readable output 契约：`--emit-conductor-json` / `--emit-json` 时 stdout 只能有一个 JSON object，日志进 stderr。
- 暴露 MCP tools，让外部 agent 能通过受控工具调用 ACC 能力。
- 对 CLI/MCP 输入做 schema、path、policy 和 audit 校验。

**机制边界**

CLI/MCP 是控制入口，不是新 runtime。它们应调用 app/runtime/GraphOps/storage 能力，而不是复制业务逻辑。

**禁止事项**

- 不要在 JSON emit 模式向 stdout 打印日志、进度或 warning。
- 不要让 MCP tool 绕过 GraphOps approval 或 runtime evidence。
- 不要让 CLI 默默依赖真实外部 provider 作为默认测试条件。
- 不要复制 server route 的复杂 projection 逻辑；共享 app/store projection helper。

**相关测试**

- `tests/unit/test_mcp_server.py`
- `tests/integration/test_cli_runs.py`
- `tests/integration/test_cli_list_show_validate.py`
- `tests/integration/test_core_v2_workflow_cli.py`
- `tests/integration/test_core_v2_capsule_cli_rejection.py`

## 11. Adapters / External Agents

**Owner**

`acc.adapters` 拥有外部 agent/tool provider 的协议适配。ACC 不拥有模型内部推理，只拥有调用边界、输入输出、权限、日志和 evidence。

**主要文件**

- `acc/adapters/base.py`
- `acc/adapters/capabilities.py`
- `acc/adapters/codex_cli.py`
- `acc/adapters/codex_app_server.py`
- `acc/adapters/generic_cli.py`
- `acc/adapters/streaming.py`
- `acc/agent_events.py`
- `tests/fixtures/fake_agents.py`

**职责**

- 定义 adapter 基础协议、能力发现和 runtime availability。
- 调用 Codex CLI、Codex app server 或 generic CLI。
- 管理 stdout/stderr、streaming events、exit code、timeout、error projection。
- 把外部执行结果转成 ACC runtime evidence 可消费的结果。
- 在默认测试中使用 fake/hermetic provider，而不是要求真实外部 agent。

**机制边界**

Adapter 的第一性原理是“外部 agent 是黑盒能力，ACC 包住边界”。它不应该参与 workflow planning，也不应该修改 template。

**禁止事项**

- 不要实现自定义 LLM reasoning loop。
- 不要把 provider 私有状态写进 reusable template。
- 不要让 adapter 直接写 downstream workspace。
- 不要让真实 Codex/Claude/Cursor/Gemini/Hermes 成为默认测试依赖。
- 不要在 adapter 中硬编码 UI 投影语义。

**相关测试**

- `tests/unit/test_codex_cli_adapter.py`
- `tests/unit/test_codex_app_server_adapter.py`
- `tests/unit/test_generic_cli_adapter.py`
- `tests/unit/test_agent_capabilities.py`
- `tests/unit/test_agent_events_projection.py`
- `tests/unit/test_agent_session_live_binding.py`

## 12. Runner / Cloud Sync

**Owner**

`acc.runner`、`acc.cloud_sync`、`acc.server.routes.runner` 和 `acc.server.security` 拥有 local runner 与 cloud/control-plane projection 的产品化扩展边界。它们是 optional extension，不是 Core v2 默认运行前提。

**主要文件**

- `acc/runner.py`
- `acc/cloud_sync.py`
- `acc/server/routes/runner.py`
- `acc/server/security.py`
- `docs/codex_goal_storage_runner_productization/*`

**职责**

- 维护 local runner identity、workspace alias、local token、capabilities、queue limits。
- 提供 runner health、providers、workspaces、job receipt、run projection、artifact preview API。
- 计算 callable requirements 和 provider availability。
- 将本地 run projection / event delta / artifact manifest 以可同步方式暴露给可选 cloud control plane。
- 对 cloud sync projection 做 local path、secret-like data、absolute path redaction。

**机制边界**

Runner/cloud sync 是“远程控制与本地执行之间的外壳”。它可以投影 run evidence，但不能替代 runtime evidence。Cloud intent 也不能等价于 local approval。

**禁止事项**

- 不要让 cloud backend、network service 或 paired runner 成为默认 Core v2 workflow 执行要求。
- 不要把本地 absolute path、secret、token 明文投影到 cloud sync payload。
- 不要绕过 local token/security mode。
- 不要把 runner job map 当成 durable run truth。
- 不要让 cloud command 直接 apply GraphOps 或跳过 human approval。

**相关测试**

- `tests/server/test_runner_api.py`
- `tests/unit/test_cloud_sync.py`
- `tests/unit/test_storage.py`
- `tests/unit/test_storage_gc.py`
- `tests/server/test_workflows_storage_contract.py`

## 13. Tests

**Owner**

`tests/` 和 `web/src/*.test.*` 拥有行为验证与架构约束验证。默认测试必须 hermetic，不依赖真实外部 agent、网络或付费服务。

**主要文件与范围**

- `tests/architecture/*`：import boundary、layering、Core v2 迁移边界。
- `tests/unit/*`：domain、serialization、validation、engine、runtime helper、storage、GraphOps、adapters、runner/cloud sync 的单元测试。
- `tests/server/*`：FastAPI route、projection、Workbench API、GraphOps API、runner API。
- `tests/integration/*`：Core v2 workflow run、CLI、artifact、binding、failure、control ledger、supervisor、handoff、legacy import。
- `web/src/App.test.tsx`、`web/src/components/WorkflowViewer.drag.test.tsx`、`web/src/lib/runTranscript.test.ts`：Workbench 交互和投影测试。
- `tests/fixtures/*`：fake agents 和 legacy fixtures。

**职责**

- 保护 template/runtime state 分离。
- 保护 explicit data movement。
- 保护 GraphOps approval gate。
- 保护 machine-readable CLI output。
- 保护 path safety、artifact safety、storage marker、GC safety。
- 保护 Workbench 多 run projection 和 API 契约。
- 保护默认 hermetic 执行。

**默认验证命令**

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
uv run pytest -q
uv run ruff check .
```

Workbench 验证：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

**禁止事项**

- 不要把默认测试写成必须安装或登录真实 Codex、Claude、Cursor、Gemini、Hermes。
- 不要把网络、云服务、付费 provider 作为默认验证前提。
- 不要只测 happy path；架构边界、失败路径、path safety 和 projection truth boundary 必须有测试。
- 不要让测试通过修改真实用户 workspace 或不可回收的本地状态。

## 14. Cross-Cutting Lookup Guide

按问题类型定位代码：

| 问题 | 优先看 |
| --- | --- |
| “这个概念属于定义态还是运行态？” | `acc/models.py`、`docs/CURRENT_ARCHITECTURE.md` |
| “`.accflow.json` 如何解析/校验？” | `acc/serialization.py`、`acc/validation.py`、`acc/engine/__init__.py`、`acc/app/core_v2_loader.py` |
| “为什么节点能并行/不能并行？” | `acc/engine/__init__.py`、`acc/scheduler/ready_set.py`、`acc/app/runtime/scheduler.py` |
| “一次 workflow run 从哪里开始？” | `acc/app/runtime/orchestrator.py`、`acc/server/routes/workflows.py`、`acc/cli.py` |
| “节点输入如何形成？” | `acc/runtime/node_payload.py`、`acc/app/runtime/executor.py`、`acc/app/runtime/nested_workflow.py` |
| “输出和 artifact 写到哪里？” | `acc/app/runtime/workflow_io.py`、`acc/result_store/filesystem.py`、`acc/artifact_store.py`、`acc/storage.py` |
| “run 状态和控制账本在哪里？” | `acc/ledger_writer.py`、`acc/store/control_ledger.py`、`acc/server/routes/runs.py` |
| “AI 如何修改 workflow/callable？” | `acc/graphops.py`、`acc/app/authoring.py`、`acc/server/routes/graphops.py` |
| “Workbench 为什么显示这个状态？” | `acc/server/run_projection.py`、`acc/server/routes/runs.py`、`web/src/stores/runStore.ts`、`web/src/components/execution/*` |
| “CLI/MCP 如何被外部调用？” | `acc/cli.py`、`acc/mcp_server/tools.py` |
| “外部 agent 在哪里接入？” | `acc/adapters/*`、`acc/app/runtime/executor.py` |
| “runner/cloud sync 是否影响核心运行？” | `acc/runner.py`、`acc/cloud_sync.py`、`docs/codex_goal_storage_runner_productization/*` |

## 15. Current Risk Markers

以下不是本文件要修复的问题，但后续开发需要注意：

- `docs/sdd/` 目前是新增 SDD 文档集，后续主文档需要和本附录保持一致。
- `acc/runner.py`、`acc/cloud_sync.py`、`acc/storage.py`、`acc/storage_*` 当前属于产品化扩展和存储基础设施增强，应避免把它们写成 Core v2 的默认云依赖。
- `web/src/components/WorkflowViewer.tsx` 仍是 Workbench 的重要聚合点；虽然已有 `canvas/`、`authoring/`、`assistant/`、`execution/`、`inspector/`、`workbench/` 子目录，但后续应继续防止它重新膨胀成事实源。
- `acc/server/routes/workflows.py` 承担 Workbench runtime graph、workflow save、binding、run submission 多类职责；新增逻辑时应优先下沉到 app/runtime/storage helper，避免 route 变胖。
- 任何新增模块都应能回答：它拥有定义态、运行态、证据、控制面、投影还是外部接口中的哪一种；无法回答时，通常说明边界不清。
