# ACC 内核深度剖析

本文结合当前源码、`docs/goal.md` 和 `docs/CURRENT_ARCHITECTURE.md` 更新。它只分析 ACC
内核，不分析 `web/` 的交互设计细节；Workbench 只作为 API 投影和运行证据观察面被提及。

结论先行：这份文档必须从旧的“capsule/graph 兼容架构分析”改成“Core v2 callable-only
内核分析”。当前产品架构已经不再把 `CapsuleSpec`、`CapsuleRegistry`、`CapsuleRunner`、
`NodeSpec`、`WorkflowTemplate`、`.graph.json` runner 或旧 workflow graph schema 当成运行时架构。
这些名字如果出现，只能属于迁移输入、显式拒绝测试或历史归档。

## 1. 一句话判断

ACC 的本质不是“再造一个智能体框架”，而是一个 local-first 的 callable workflow boundary
manager。

说人话就是：ACC 不替 Codex、Claude、Cursor、Gemini 或本地工具思考，也不实现自己的 LLM
tool-calling loop。ACC 负责把可复用的 agent/tool/workflow 定义变成一次次隔离调用，并把每次调用
的输入、cwd、payload、stdout/stderr、artifact、event、failure 和 result store 写成本地可审计事实。

第一性原理只有三条：

1. 定义不是运行。
   `AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate` 是可复用定义；它们不能保存
   run dir、session id、workspace absolute binding、历史输出或 agent memory。

2. 控制流不是数据流。
   `ControlEdge(A -> B)` 只说明 B 何时可调度，不说明 B 能读取 A 的任意输出。数据必须通过
   `InputBinding`、`DataEdge`、workflow input/output binding、`ResultStore` 或 artifact contract
   显式移动。

3. 投影不是事实源。
   CLI/API/Debugger/Workbench 展示的是 `RunRecord`、`EventLog`、`ResultStore`、
   `SessionInstance`、`ArtifactBundle` 等运行事实的投影，不应该从旧 manifest、`node_runs/`、
   `workflow_graph.json` 或 `.graph.json` 反推出运行真相。

## 2. 当前合法执行链

当前内核的合法链路是：

```text
canonical .accflow.json
  -> parse WorkflowFunctionTemplate
  -> validate pure domain constraints
  -> compile ExecutionPlan
  -> create FunctionInvocation
  -> create root ScopeFrame
  -> schedule NodeInvocationSpec by ExecutionPlan levels
  -> resolve explicit payload from workflow input / prior node outputs
  -> materialize agent_payload.json / runtime_payload.json / binding_manifest.json
  -> execute CallableRef as SessionInstance
  -> capture output / artifact / stdout / stderr / failure
  -> publish ArtifactBundle
  -> write ResultStore
  -> append EventLog
  -> update RunRecord
  -> project CLI / API / Debugger / Workbench view
```

这条链路里没有旧 `CapsuleRegistry -> CapsuleRunner`，也没有旧 `WorkflowGraph -> NodeSpec`
runtime。`acc.app.run_clean_workflow_template()` 这个函数名里还保留了历史命名，但它当前调用的是
`acc.app.core_v2_runtime.run_core_v2_workflow_path()`，实际语义是 Core v2 workflow function run。

关键入口：

- `acc/domain.py`: Core v2 domain 对象。
- `acc/engine/__init__.py`: `.accflow.json` 解析、验证、拓扑层、`ExecutionPlan` 编译。
- `acc/app/core_v2_loader.py`: 加载 canonical workflow，并拒绝 `.graph.json` 直接运行。
- `acc/app/core_v2_runtime.py`: 创建 invocation/scope/session/run record，执行节点，写 result store。
- `acc/callable_registry.py`: 从 `callables/agents/*.yaml` 和 `callables/tools/*.yaml` 发现 class template。
- `acc/server/routes/callables.py`: 当前 callable API surface。
- `acc/migration/*`: 只做旧 raw document 到 Core v2 的离线迁移。
- `acc/graphops.py`: 对 canonical `.accflow.json` patch 做 schema/policy/dry-run gate。

## 3. 非目标

这些不是 ACC 内核要做的事：

1. 不实现自研 LLM reasoning loop。
   外部 agent 拥有自己的内部规划、工具调用、反思和上下文管理。ACC 只管边界和证据。

2. 不做数据库优先 artifact 平台。
   当前 durable truth 是本地 run directory、manifest、events、artifacts、result store，不是远端数据库。

3. 不做默认分布式 worker、Kubernetes、云队列或 SaaS 权限系统。
   `WorkbenchRunManager` 是 server 进程内 lightweight run handle manager，不是 durable distributed scheduler。

4. 不把 UI 状态当 runtime truth。
   UI 可以记住 `activeRunId`、节点选中状态和 browser-local task state，但这些都不是运行事实。

5. 不把 GraphOps 做成默认可自动落盘的 LLM 自修改系统。
   GraphOps 的核心是 proposal、validation、dry-run、human approval gate。当前 `apply_patch_request()`
   对真实 persistent apply 仍返回未实现错误。

6. 不声称提供完整 OS 级 sandbox。
   ACC 有路径保护、权限 profile、artifact path escape 检查、GraphOps policy guard，但这不是 container/VM
   级强隔离。

## 4. 核心对象模型

### 4.1 可复用定义对象

这些对象表达“可复用能力是什么”：

| 对象 | 作用 | 代码事实 |
| --- | --- | --- |
| `AgentClassTemplate` | 可复用 agent class，包含 runtime、默认 prompt、权限、端口、artifact contract | `acc/domain.py` |
| `ToolClassTemplate` | 可复用 tool class，包含 runner、权限、端口、artifact contract | `acc/domain.py` |
| `WorkflowFunctionTemplate` | 可复用 workflow function body，包含节点、控制边、数据边、输入输出边界 | `acc/domain.py` |
| `CallableRef` | 节点调用的目标，kind 只能是 `agent_class`、`tool_class`、`workflow_function` | `acc/domain.py` |
| `PermissionProfile` / `RuntimePolicy` / `PromptPolicy` / `ArtifactContract` | 运行策略、权限、prompt、artifact contract 的强类型表达 | `acc/domain.py` |

当前 `CallableKind` 是：

```text
agent_class | tool_class | workflow_function
```

没有 `legacy_capsule`。

### 4.2 调用与编译对象

这些对象表达“这次 workflow function 如何被调用和调度”：

| 对象 | 作用 |
| --- | --- |
| `NodeInvocationSpec` | workflow function 内的一次 call site，持有 `callable_ref`、bindings、policy、ports |
| `ExecutionNode` | 编译后的节点，记录依赖关系 |
| `ExecutionPlan` | 编译后的 workflow plan，包含拓扑层 `levels` |

`acc.engine.parse_workflow_function_template()` 只接受 `schema_version = acc.core.v2`，并通过
`CORE_V2_TEMPLATE_FIELDS` / `CORE_V2_NODE_FIELDS` 拒绝未知字段。旧 `capsule_id`、`input_mapping`、
`workflow_ref`、`runtime`、`tool` 等旧节点字段不会作为 Core v2 节点语义被接收。

### 4.3 运行事实对象

这些对象表达“这次实际发生了什么”：

| 对象 | 作用 |
| --- | --- |
| `FunctionInvocation` | 一次 workflow function 调用 |
| `ScopeFrame` | 调用的 cwd/inbox/outbox/artifact/environment 边界 |
| `SessionInstance` | 一个节点内 agent/tool 执行实例 |
| `NodeInvocationRun` | 节点运行结果地址和失败关联 |
| `RunRecord` | 一次 run 的顶层事实 |
| `EventRecord` | append-only 事件事实 |
| `FailureRecord` | 失败层级、错误、证据路径 |
| `ArtifactBundle` | 节点或 workflow 产物证据包 |
| `ResultStoreAddress` | run/node/port 的结果寻址 |

这组对象是当前内核的“运行事实语言”。如果一个上层功能不能从这些对象投影出来，而需要读旧
`node_runs/` 或旧 `workflow_graph.json`，那就是架构回退信号。

## 5. 文件格式边界

当前文件格式的地位如下：

| 格式/目录 | 当前地位 | 说明 |
| --- | --- | --- |
| `workflows/<id>.accflow.json` | canonical workflow template | Workbench/API save default 和 CLI run/validate 的合法 workflow 输入 |
| `callables/agents/*.yaml` | agent class template source | 被 `CallableRegistry` 发现 |
| `callables/tools/*.yaml` | tool class template source | 被 `CallableRegistry` 发现 |
| `*.graph.json` | legacy raw input only | 只能迁移或显式拒绝，不能作为 runnable workflow |
| `tests/fixtures/legacy/*` | historical/rejection/migration evidence | 不参与默认产品发现 |
| `docs/historical/*` | historical evidence | 不参与运行 |

`.graph.json` 的策略非常明确：

```text
acc workflow run old.graph.json       -> fail with migration hint
acc workflow validate old.graph.json  -> fail with migration hint
acc workflows list                    -> must not list graph json as runnable workflow
acc workflow import-graph old.graph.json -> offline conversion only
```

`acc.app.core_v2_loader.reject_legacy_graph_path()` 是这个边界的直接代码入口。

## 6. 分层职责

| 层 | 当前责任 | 不能承担 |
| --- | --- | --- |
| `acc.domain` | dataclass domain records、字面量约束、纯 validation helper | IO、subprocess、server/UI import |
| `acc.engine` | parse、validate、topological levels、`ExecutionPlan` | 文件落盘、节点执行、server 状态 |
| `acc.app` | use-case orchestration，连接 engine/store/runtime/registry | 复活旧 runtime path |
| `acc.runtime` | process/workspace/payload 边界 primitive | workflow truth |
| `acc.store` / `acc.persistence` / `acc.result_store` | 文件系统事实、manifest、events、result addressing | agent 内部逻辑 |
| `acc.server` | FastAPI thin API/projection layer | runtime truth 或 UI 状态持久化 |
| `web/` | interaction state、graph projection、inspector view | durable runtime truth |
| `acc.migration` | raw legacy document -> Core v2 output | 旧架构运行时 |

当前还存在一些历史命名，如 `run_clean_workflow_template`、`run-graph` endpoint。这些名字不等于旧语义。
判断是否旧架构复活，要看它是否消费 `WorkflowTemplate/NodeSpec/CapsuleSpec` 或执行旧 graph runner。
目前这些产品路径消费的是 canonical Core v2 payload。

## 7. Workflow 运行主路径

CLI 路径：

```text
acc workflow run <workflow.accflow.json> --run-dir <dir> --emit-json
```

调用链：

```text
acc.cli.workflow_run
  -> WorkflowAppService.run_sync
  -> WorkflowAppService.run
  -> run_clean_workflow_template
  -> run_core_v2_workflow_path
  -> load_workflow_function_template
  -> compile_execution_plan
  -> run_workflow_function_invocation
```

Server 路径：

```text
POST /api/workflows/run-graph
POST /api/workflows/run-graph/submit
```

这里的 `run-graph` 是兼容 endpoint name。实现会把传入 graph payload 物化为临时
`.accflow.json`，放到 `runs/_workflow_function_specs/<run_id>/...accflow.json`，再走
`WorkflowAppService`。它不应该被理解成旧 `.graph.json` runtime。

## 8. 调度语义

当前 `ExecutionPlan` 使用 `callable_topological_levels()` 生成拓扑层：

```text
level 0: all nodes with no unmet control dependency
level 1: nodes whose predecessors completed
...
```

`run_workflow_function_invocation()` 逐层执行，层内用 `asyncio.gather()` 并发。这个调度是内存内、
run-scoped 的，不是 durable queue scheduler。

这意味着：

- 控制边只影响 readiness。
- 同一层可以并发。
- 某节点失败会让当前 workflow 进入 failed 收敛路径。
- 当前不是 work-stealing scheduler，也不承诺跨进程恢复正在运行的 DAG。

如果未来要实现真正 durable scheduler，应该让 `DAGScheduler` 直接消费 `ExecutionPlan` 和
`RunRecord/EventLog`，而不是重新引入旧 graph runtime。

## 9. Payload 和 binding

节点 agent-visible 输入由 `resolve_node_payload()` 生成：

1. 从 `node.overrides.static_input` 开始。
2. 应用 `workflow_input_bindings`，把 workflow input 映射到目标节点端口。
3. 应用 `node.input_bindings`，从前序节点输出或 static value 填目标端口。
4. 应用 `data_edges`，把已产生的 source port 输出写到 target port。

每个节点目录写出：

```text
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/session_instance_manifest.json
nodes/<node_id>/output.json
nodes/<node_id>/artifact_bundle.json
nodes/<node_id>/stdout.txt
nodes/<node_id>/stderr.txt
```

关键边界：

- `agent_payload.json` 是 agent/tool 可见输入。
- `runtime_payload.json` 是 ACC runtime metadata，不应进入 agent prompt。
- `binding_manifest.json` 是绑定证据。
- 不再默认注入旧 `node/workflow/input/inbox/upstream_context` 五段 payload。

当前 `binding_manifest.json` 还比较轻，只记录输入 key；如果要增强 RunInspector 证据，应扩展这里的
producer、selector、required、materialization mode，而不是恢复旧 `upstream_context`。

## 10. Callable 发现和执行

`CallableRegistry.from_project_root()` 只扫描：

```text
callables/agents/*.yaml
callables/tools/*.yaml
```

它不扫描 `capsules/*/capsule.yaml`。这点非常关键：旧 capsule YAML 不再是可执行资产发现入口。

当前执行分三类：

1. Hermetic fake tool/agent。
   `fake_producer`、`fake`、`merge`、`fail`、`generic_fake_agent`、`fake-agent.generic` 用于默认测试和本地闭环。

2. Nested workflow function。
   `callable_ref.kind == "workflow_function"` 时，`execute_workflow_function_callable()` 会递归调用
   `run_core_v2_workflow_path()`，并把 child workflow outputs 作为当前节点 output。

3. Registry-resolved class template stub。
   如果 `CallableRegistry` 能解析某个 class，目前 `execute_hermetic_callable()` 返回一个 Core v2 adapter stub
   风格的成功输出。`CallableClassRunner` 明确要求 native Core v2 adapter；真实外部 agent native adapter
   边界仍需后续补齐。

因此不能再写“真实 external-agent 包装仍大量通过 CapsuleRunner 执行”。当前产品架构已经删除
`CapsuleRunner`。更准确的说法是：Core v2 已建立 class-template 和 session boundary，但 native
external-agent adapter 执行能力还没有完全成熟，默认测试主要依赖 hermetic fake/stub。

## 11. Run directory 和事实文件

Core v2 run directory 的核心布局是：

```text
run_record.json
function_invocation.json
scope_frame.json
events.jsonl
result_store/
workflow_outputs/<port>/output.json
nodes/<node_id>/
  agent_payload.json
  runtime_payload.json
  binding_manifest.json
  session_instance_manifest.json
  output.json
  artifact_bundle.json
  events.jsonl
  stdout.txt
  stderr.txt
  artifacts/
failures/<failure_id>.json
```

如果其他历史 goal 文档仍写 `function_invocation_manifest.json`、`scope_frame_manifest.json`、
`workflow_run_manifest.json` 或 `workflow_summary.json`，需要按当前 runtime 事实重新核对。当前
Core v2 主路径写的是上面这组文件名。

注意两个负面规则：

- 新 run 不应该写旧 `node_runs/` 作为 source of truth。
- 新 run 不应该写旧 `workflow_graph.json` 作为 source of truth。

测试中已经有断言确认 Core v2 workflow run 目录不包含这些旧文件。

## 12. ResultStore 和 workflow outputs

节点 output 会通过 `put_result_store_value()` 写入 `FilesystemResultStore`。地址由三元组构成：

```text
run_id / node_id / port_id
```

workflow output binding 会把节点 port 输出写入：

```text
workflow_outputs/<target_port>/output.json
result_store/__workflow_outputs/<target_port>
```

这说明当前数据流的事实源正在从“目录布局推断”收敛到“ResultStore 地址化记录”。后续如果要扩展
多 port、artifact reference、symlink/reference materialization，应该围绕 ResultStore 和 binding manifest
增强，而不是回退到旧 node run summary。

## 13. GraphOps 控制面

GraphOps 当前只面向 canonical `.accflow.json`。

它的 gate 包括：

- patch JSON schema validation。
- target path 必须是相对路径，不能 escape repository。
- workflow target 必须以 `.accflow.json` 结尾。
- 拒绝 schema mutation。
- 拒绝 `danger-full-access`、network enable、write_files enable。
- 拒绝 `connect_nodes`、`update_node_input` 等旧 shorthand。
- 拒绝节点里出现旧字段，例如 `capsule_id`、`input_mapping`、`runtime`、`tool`、`workflow_ref`。
- dry-run 可以做 semantic materialization，并用 `parse_workflow_function_template()` + validation 检查结果。

当前 persistent apply 仍未实现：

```text
apply_patch_request(... apply=True, human_approved=True)
  -> AccError("Real GraphOps apply is not implemented in the MVP")
```

所以正确理解是：GraphOps 是 mutation control plane 的 validation/dry-run/proposal 基础，不是已经完整落地的事务式持久修改引擎。

## 14. CLI 和 API 边界

当前 CLI 的核心可执行入口是：

```text
acc workflow run <workflow.accflow.json>
acc workflow validate <workflow.accflow.json>
acc workflow import-graph <old.graph.json>
acc callable list
acc callable show <id>
acc callables list
acc callables show <id>
acc runs ...
acc graphops ...
```

旧 `acc run <legacy-ref>` 当前是明确拒绝路径：

```text
`acc run <legacy-ref>` no longer executes legacy runtime assets.
Use `acc workflow run <workflow.accflow.json>`.
```

旧 `batch-run` 也是明确拒绝路径。

Server 侧当前注册 `/api/callables`，而不是 `/api/capsules`。如果文档仍说 `/api/capsules/*` 是 runtime surface，
那就是过时内容。

## 15. Legacy 边界

允许 legacy 出现的位置只有：

```text
acc.migration.*
tests/migration/*
explicit rejection tests
tests/fixtures/legacy/*
docs/historical/*
```

`acc.migration.graph_importer` 可以读取 raw `.graph.json` dict，识别 `capsule_id`、
`legacy_capsule_id` 这类旧字段，然后输出 Core v2 `.accflow.json` payload。它不能实例化旧 `NodeSpec`
或运行旧 graph。

`acc.migration.capsule_compat` 可以把 raw capsule dict 映射成 `CallableRef` 或 class template，用于迁移。
它不能复活 `CapsuleSpec`、`CapsuleRegistry` 或 `CapsuleRunner`。

这和过去“兼容层仍是核心路径”的判断相反。当前原则是：legacy 只能是输入格式，不是架构对象。

## 16. 当前成熟度矩阵

| 能力 | 当前状态 | 边界 |
| --- | --- | --- |
| Core v2 domain model | 已落地 | `CallableKind` 不含 legacy kind |
| `.accflow.json` parser/validator | 已落地 | 拒绝 unknown/legacy fields |
| `.graph.json` direct run | 已禁止 | 只能 migrate 或 explicit reject |
| Callable discovery | 已落地 | 只扫描 `callables/agents` 和 `callables/tools` |
| Core v2 workflow run | 已落地 | level-based in-memory scheduler |
| Agent/tool native external adapter | 未完全成熟 | fake/stub 能闭环；真实 provider execution 需补 native adapter |
| Nested workflow callable | 已落地 | 递归调用 Core v2 workflow path |
| ResultStore write | 已落地 | 查询/投影能力仍可增强 |
| Binding evidence | 部分落地 | `binding_manifest` 还偏轻，需要更完整 provenance |
| Artifact contract | 部分落地 | required path 和 escape 检查明确；内容 schema 不是完整闭环 |
| Run projection | 已有 | 需要和最新 `agent_payload/runtime_payload/binding_manifest` 继续对齐 |
| GraphOps validate/dry-run | 已落地 | persistent apply 未实现 |
| Human gate / approval barrier | 部分基础 | interaction/proposal 有基础，durable scheduler barrier 未完整 |
| Durable scheduler | 未成熟 | 当前是 level-based run-scoped scheduling |
| OS 级 sandbox | 非目标/未实现 | 只有多层本地 guard |

## 17. 当前风险和最小后续路径

### 17.1 最重要的风险

1. 函数名和 endpoint 名仍有历史残留。
   `run_clean_workflow_template`、`run-graph` 不代表旧 runtime，但容易误导读者。文档必须解释“名字历史化，语义 Core v2”。

2. Native external adapter 还没有完全接上。
   旧 `CapsuleRunner` 已删除，但 `CallableClassRunner` 还没有成熟真实 adapter。短期内默认验证依赖 fake/stub 是合理的，但不能声称真实 Codex/Claude 长流程已由 Core v2 原生跑通。

3. Binding provenance 还不够强。
   `agent_payload.json`、`runtime_payload.json`、`binding_manifest.json` 已分离，但 `binding_manifest` 还需要记录更完整的 producer、selector、materialization、required/optional、failure cause。

4. GraphOps apply 未实现。
   不能把 GraphOps 描述成完整 self-modifying workflow engine。它当前是安全 gate 和 dry-run control plane。

5. Durable scheduler 未实现。
   当前 `ExecutionPlan.levels + asyncio.gather` 足够支持 hermetic workflow run，但不是跨进程可恢复调度器。

### 17.2 最小稳妥推进路径

1. 补齐 native Core v2 adapter。
   目标不是恢复 `CapsuleRunner`，而是让 `AgentClassTemplate.runtime` / `ToolClassTemplate.runner`
   直接解析到 native adapter。

2. 强化 binding manifest。
   每个 agent-visible field 都记录 source、producer node、port、selector、materialization mode、required、
   fallback/degraded 状态。

3. 收敛 projection。
   RunInspector/API 应优先读 `run_record.json`、`events.jsonl`、`result_store`、`agent_payload.json`、
   `runtime_payload.json`、`binding_manifest.json`、`session_instance_manifest.json`。

4. 实现事务式 GraphOps apply。
   必须先有 validate + dry-run + semantic diff + human-approved + backup/apply manifest，再允许落盘。

5. 推进 durable scheduler。
   让 scheduler 消费 `ExecutionPlan` 和已落盘 `RunRecord/EventLog`，而不是在 app 层永久堆叠调度语义。

6. 明确 artifact content validation。
   required path/escape 已有，内容 schema validation 可以做成 opt-in，不要和 adapter 重构绑死。

## 18. 测试证据能证明什么

当前建议用这些命令验证内核事实：

```powershell
uv run pytest -q
uv run ruff check .
uv run pytest tests/server -q
uv run pytest tests/integration/test_core_v2_workflow_cli.py tests/integration/test_core_v2_capsule_cli_rejection.py tests/integration/test_workflow_import_graph.py tests/integration/test_graphops_dry_run.py -q
```

如果涉及 Workbench 或 browser-facing 变更，还要运行：

```powershell
cd web
npm run test -- --run
npm run build
```

这些默认 hermetic 测试不能证明：

- 真实 Codex/Claude/Cursor/Gemini 长时间运行可靠性。
- 网络、浏览器、凭据、云服务路径。
- OS/container 级安全隔离。
- 大规模 workflow 性能上限。
- durable scheduler 的 crash recovery。
- GraphOps persistent apply，因为它当前未实现。

## 19. 最终判断

ACC 当前内核已经从“capsule/legacy graph 可运行兼容架构”转成了“Core v2 callable-only 架构”。

它已经比较扎实的部分是：

- Core v2 domain model。
- canonical `.accflow.json` parser/validator/compiler。
- `FunctionInvocation` / `ScopeFrame` / `SessionInstance` / `RunRecord` evidence。
- level-based workflow execution。
- explicit payload 分离：`agent_payload` vs `runtime_payload`。
- ResultStore 写入和 workflow output materialization。
- `/api/callables` 和 Workbench callable projection。
- legacy direct run rejection 和 offline migration。
- GraphOps validation/dry-run safety gate。

它还不成熟的部分是：

- native external-agent Core v2 adapter。
- 完整 binding provenance。
- durable scheduler。
- GraphOps persistent apply。
- human approval barrier 和 scheduler 的闭环。
- artifact 内容级 validation。
- OS 级强隔离。

理解 ACC 的正确方式是：

```text
ACC owns boundaries, evidence, explicit data movement, and local workflow execution.
External agents own reasoning.
Humans own persistent mutation authority.
Legacy inputs are migration material, not runtime architecture.
```
