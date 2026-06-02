目标：将 ACC 重构为完全基于新面向对象模型的单一架构，删除旧架构本身。

本 goal 的重点不是“旧逻辑不在 hot path 里”，而是：

1. 产品代码只以新的 OO 对象模型表达系统。
2. 旧架构对象、旧 schema、旧 runner、旧 registry、旧 graph runtime 不再作为架构存在。
3. legacy 输入只能作为迁移器读取的原始文档格式，不允许通过旧 domain class、旧 registry、旧 runner 复活。
4. CLI/API/Debugger/GraphOps/Workbench/Conductor export 都必须围绕新对象模型工作。

## 新架构的基本思想

ACC 的核心对象必须按“定义对象”和“运行对象”分层：

### 可复用定义对象

- `AgentClassTemplate`
- `ToolClassTemplate`
- `WorkflowFunctionTemplate`
- `CallableRef`
- `InputBinding`
- `OutputBinding`
- `WorkflowCallBinding`
- `RuntimePolicy`
- `RetryPolicy`
- `TimeoutPolicy`
- `PermissionProfile`
- `PromptPolicy`
- `ArtifactContract`

这些对象表达“可复用能力是什么”。它们必须是 stateless 的，不允许保存 run dir、session id、workspace absolute binding、历史输出、agent memory。

### 编译与调度对象

- `NodeInvocationSpec`
- `ExecutionPlan`
- `ExecutionNode`
- `DAGScheduler`

这些对象表达“这次 workflow function 如何被调用和调度”。它们只能消费 canonical `WorkflowFunctionTemplate`，不能消费旧 `WorkflowTemplate` / `NodeSpec` / `.graph.json`。

### 运行事实对象

- `FunctionInvocation`
- `ScopeFrame`
- `NodeInvocationRun`
- `SessionInstance`
- `ArtifactBundle`
- `ResultStore`
- `RunRecord`
- `EventLog`
- `FailureRecord`

这些对象是 runtime truth。CLI/API/Debugger/RunInspector 只能从这些对象投影，不允许从旧 manifest、`node_runs/`、`workflow_graph.json` 或 `.graph.json` 推断事实。

## 必须删除的旧架构

以下对象和路径不是“降级兼容对象”，而是必须从产品代码中删除：

- `NodeSpec`
- `WorkflowTemplate`
- `NodeSpec.raw`
- `CapsuleSpec`
- `CapsuleRegistry`
- `CapsuleRunner`
- `CallableKind.legacy_capsule`
- `BindingMode`
- `LegacyPassthroughBinding`
- `legacy_full`
- `mixed binding mode`
- `legacy_capsule_id`
- `input_mapping`
- `legacy_value_edges`
- `upstream_context`
- `.graph.json` runnable workflow
- old `WorkflowGraph` as runtime object
- old workflow graph schema as active schema
- old workflow run schema as active schema
- `node_runs/`
- `workflow_graph.json`
- legacy run manifests as source of truth
- `ACC_USE_CALLABLE_DISPATCH`
- `run_legacy_graph_template`
- `run_workflow_template_instance(WorkflowTemplate, ...)`
- `execute_legacy_capsule_node`
- `is_legacy_capsule_node`
- `resolve_legacy_node_input`
- `resolve_legacy_value_edge`
- `fill_legacy_upstream_context_fields`
- `mirror_legacy_node_run`
- `write_legacy_run_compatibility_files`

## 允许保留的 legacy 边界

只允许以下位置出现 legacy 名称或 legacy 字段：

- `acc.migration.*`：只能把 legacy raw document 转成 Core v2 对象或文件。
- `tests/migration/*`：只能验证 legacy input 可以迁移。
- explicit rejection tests：只能验证 legacy input 不能 run / validate / save / list。
- historical docs / archived fixtures：只能作为历史证据，不参与默认发现、默认运行、默认保存。

重要限制：

- migration 代码不能复用 `CapsuleSpec` / `CapsuleRegistry` / `WorkflowTemplate` / `NodeSpec`。
- migration 代码只能把 legacy YAML/JSON 当作 raw dict/document 解析，然后输出 Core v2 对象。
- 不允许创建“兼容版旧对象”来绕过删除目标。

## 核心执行链

唯一合法执行链必须是：

```text
canonical .accflow.json
  -> parse WorkflowFunctionTemplate
  -> validate pure domain constraints
  -> compile ExecutionPlan
  -> create FunctionInvocation
  -> create root ScopeFrame
  -> schedule NodeInvocationSpec
  -> resolve explicit bindings from ResultStore / workflow input
  -> materialize agent_payload / runtime_payload / binding_manifest
  -> execute CallableRef as SessionInstance
  -> capture stdout / stderr / exit code
  -> validate output / artifact contract
  -> write ArtifactBundle
  -> write ResultStore
  -> finalize SessionInstance
  -> append EventLog
  -> update RunRecord
  -> project CLI / API / Debugger / Workbench view
```

这条链中禁止出现：

- `NodeSpec`
- `WorkflowTemplate`
- `CapsuleSpec`
- `CapsuleRegistry`
- `CapsuleRunner`
- `node.raw`
- legacy branch
- `.graph.json` direct execution
- legacy payload
- legacy run manifest

## 不可变原则

### 新模型唯一原则

`acc.app`、`acc.runtime`、`acc.store`、`acc.engine`、`acc.server`、`acc.debugger`、`acc.graphops` 的产品路径只能消费新模型。

旧模型不能作为 adapter、fallback、compatibility registry 或 hidden normalization path 存在。

### 兼容不进入产品代码原则

不允许：

```python
if old_format:
    run_old_path()
else:
    run_new_path()
```

旧格式只能：

```text
raw legacy document -> migration parser -> canonical v2 output
raw legacy document -> explicit rejection with migration hint
historical fixture -> read-only documentation evidence
```

### 禁止 raw 偷渡语义

不允许任何产品代码读取：

```text
node.raw["legacy_capsule_id"]
node.raw["input_mapping"]
node.raw["legacy_value_edges"]
node.raw["upstream_context"]
node.raw["permissions"]
node.raw["retry"]
node.raw["timeout_seconds"]
metadata["legacy_*"]
```

这些能力必须变成强类型字段：

- `CallableRef`
- `InputBinding`
- `RuntimePolicy`
- `PermissionProfile`
- `PromptPolicy`
- `ArtifactContract`

### 外部 agent 边界原则

ACC 不实现自定义 LLM reasoning loop 或 tool-calling loop。

ACC 只负责：

- 输入边界
- cwd / scope
- 权限声明
- prompt / package materialization
- adapter invocation
- artifact capture
- event / manifest evidence
- failure classification

### Evidence-first 原则

每次运行必须能解释：

- 调用了哪个 `WorkflowFunctionTemplate`
- 哪个 `FunctionInvocation`
- 哪个 `ScopeFrame`
- 哪个 `NodeInvocationSpec`
- 哪个 `SessionInstance`
- 输入来自哪里
- 输出写到哪里
- artifact 是什么
- 失败在哪一层
- stdout / stderr 在哪里

## Phase 0：重新冻结删除边界

目标：把“旧架构完全删除”作为新 contract，而不是只做 hot-path 搜索通过。

必须更新：

- `docs/refactor_core_v2/GOAL.md`
- `docs/refactor_core_v2/CORE_V2_CONTRACT.md`
- `docs/refactor_core_v2/INVENTORY.md`
- `docs/refactor_core_v2/DELETION_PLAN.md`
- `docs/refactor_core_v2/ACCEPTANCE.md`

`INVENTORY.md` 必须列出每一个旧对象、旧 schema、旧 command、旧 API、旧 test、旧 fixture。

分类只能是：

- `delete`
- `replace with Core v2`
- `migration raw input only`
- `explicit rejection test only`
- `historical docs only`

禁止分类为：

- `temporary runtime compatibility`
- `hot path adapter`
- `fallback execution path`
- `legacy authoring surface`
- `compatibility registry`

Phase 0 验收：

```bash
uv run pytest -q
uv run ruff check .
```

## Phase 1：收敛 OO domain model

目标：`acc.domain` 只表达新 OO 架构。

必须保留或建立：

- `ClassTemplate`
- `AgentClassTemplate`
- `ToolClassTemplate`
- `WorkflowFunctionTemplate`
- `CallableRef`
- `NodeInvocationSpec`
- `ExecutionPlan`
- `ExecutionNode`
- `RuntimePolicy`
- `RetryPolicy`
- `TimeoutPolicy`
- `PermissionProfile`
- `PromptPolicy`
- `ArtifactContract`
- `InputBinding`
- `OutputBinding`
- `WorkflowCallBinding`
- `FunctionInvocation`
- `ScopeFrame`
- `NodeInvocationRun`
- `SessionInstance`
- `ArtifactBundle`
- `ResultStoreAddress`
- `RunRecord`
- `EventRecord`
- `FailureRecord`

必须从 `acc.domain` 删除：

- `NodeSpec`
- `WorkflowTemplate`
- `CallableKind.legacy_capsule`
- `BindingMode`
- `LegacyPassthroughBinding`
- any `legacy_*` runtime field
- any `raw` semantic channel

Phase 1 测试：

- `tests/unit/test_core_v2_domain_model.py`
- `tests/unit/test_core_v2_serialization.py`
- `tests/unit/test_core_v2_validation.py`

必须覆盖：

- valid workflow function
- duplicate node id
- missing callable ref
- invalid binding source
- invalid artifact path
- invalid permission profile
- invalid workflow output binding
- serialization round trip
- metadata cannot affect execution
- raw / legacy fields rejected

## Phase 2：重写 canonical loader / validator / compiler

目标：`.accflow.json` 直接解析为 `WorkflowFunctionTemplate`，不经过旧 graph 或旧 workflow object。

必须存在：

- `parse_workflow_function_template(payload)`
- `load_workflow_function_template(path)`
- `validate_workflow_function_template(template)`
- `compile_execution_plan(template, workflow_input)`

必须删除：

- `parse_clean_workflow_template -> WorkflowTemplate`
- `normalize_workflow_function_template(WorkflowTemplate)`
- `normalize_node_invocation_spec(NodeSpec)`
- active old workflow graph schema usage

Core v2 `.accflow.json` 原则：

- `schema_version = acc.core.v2`
- nodes 使用 `callable_ref`
- 输入输出使用 explicit bindings
- `control_edges` 只表达 readiness
- data movement 只通过 bindings / ResultStore selector
- metadata 不影响 runtime

禁止字段：

- `legacy_capsule_id`
- `capsule_id`
- `input_mapping`
- `legacy_value_edges`
- `legacy_passthrough`
- `binding_mode`
- `kind`
- `runtime`
- `tool`
- `workflow_ref`
- `raw`

`.graph.json` 策略：

```text
acc workflow run old.graph.json       -> fail with migration hint
acc workflow validate old.graph.json  -> fail with migration hint
acc workflows list                    -> must not list .graph.json as runnable workflow
acc workflows show old.graph.json     -> fail with migration hint
acc migrate graph old.graph.json -o new.accflow.json -> offline conversion only
```

Phase 2 测试：

- `tests/unit/test_core_v2_loader.py`
- `tests/unit/test_core_v2_execution_plan.py`
- `tests/unit/test_legacy_graph_rejected.py`
- `tests/unit/test_legacy_graph_migration_tool.py`
- `tests/integration/test_workflow_import_graph.py`

## Phase 3：删除 Capsule 架构，建立 CallableClass 架构

目标：`CallableRegistry` 是唯一可执行资产发现入口。旧 capsule 不再是产品架构。

新资产位置：

```text
callables/agents/*.yaml
callables/tools/*.yaml
workflows/*.accflow.json
```

必须删除或替换：

- `CapsuleSpec`
- `CapsuleRegistry`
- `CapsuleRunner`
- `capsules/*/capsule.yaml` as executable asset
- `/api/capsules/*` as product runtime surface
- `acc capsule ...` authoring commands unless rewritten to `acc callable ...`
- `acc run <capsule_id>`
- `acc batch-run` with `capsule_id`

允许的迁移命令：

```text
acc migrate capsule capsules/<id>/capsule.yaml --out callables/agents/<id>.yaml
acc migrate capsule capsules/<id>/capsule.yaml --out callables/tools/<id>.yaml
```

迁移规则：

- `kind=agent_session` -> `AgentClassTemplate`
- `kind=atomic` -> `ToolClassTemplate`
- `kind=acc_workflow` -> `WorkflowFunctionTemplate` ref
- `runtime` -> adapter / runner field
- `permissions` -> `PermissionProfile`
- `prompt` -> `PromptPolicy`
- `schema` -> callable interface
- `artifacts` -> `ArtifactContract`
- `lifecycle` -> lifecycle policy if still needed

禁止：

- `CallableRef -> CapsuleSpec -> CapsuleRunner`
- `ClassTemplate contains CapsuleSpec payload`
- legacy capsule id controls execution
- capsule API silently wrapping new callable runtime

Phase 3 验收搜索：

```bash
rg -n "CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc -g "*.py"
```

预期：

- 只允许 `acc/migration/*` 命中。
- 不允许 `acc/app`、`acc/runtime`、`acc/store`、`acc/engine`、`acc/server`、`acc/debugger`、`acc/graphops`、`acc/cli.py` 命中。

## Phase 4：重写 workflow app hot path

目标：`WorkflowAppService.run()` 只接受 canonical `.accflow.json` v2，只执行 `WorkflowFunctionTemplate + ExecutionPlan`。

新主入口形态：

```python
run_workflow_function_invocation(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
) -> RunRecord
```

必须删除：

- `run_legacy_graph_template`
- `run_workflow_template_instance`
- `execute_legacy_capsule_node`
- `is_legacy_capsule_node`
- `resolve_legacy_node_input`
- `resolve_legacy_value_edge`
- `fill_legacy_upstream_context_fields`
- `mirror_legacy_node_run`
- `write_legacy_run_compatibility_files`
- `ACC_USE_CALLABLE_DISPATCH`

Phase 4 测试：

- `tests/integration/test_core_v2_workflow_run.py`
- `tests/integration/test_core_v2_workflow_failure.py`
- `tests/integration/test_core_v2_workflow_bindings.py`
- `tests/integration/test_core_v2_workflow_artifacts.py`

必须覆盖：

- single node success
- multi-node DAG success
- parallel ready set if supported
- node failure stops dependents
- independent node behavior
- missing binding fail-fast
- artifact capture success
- artifact missing failure
- workflow output materialization
- `--emit-json` stdout exactly one JSON object
- logs only on stderr/files

## Phase 5：重写 binding 和 payload contract

目标：explicit binding 是唯一输入路径。

新输入产物：

```text
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
```

规则：

- `agent_payload.json` 只包含显式绑定给 agent/tool 的字段。
- `runtime_payload.json` 只包含 ACC runtime metadata。
- `binding_manifest.json` 记录每个字段来源、selector、producer、required/optional。
- `control_edges` 不传数据。
- data movement 只通过 BindingResolver + ResultStore。

禁止默认注入：

- `node`
- `workflow`
- `input`
- `inbox`
- `upstream_context`
- legacy 5-segment payload

Phase 5 验收：

```bash
rg -n "BindingMode|LEGACY_FULL|MIXED|LegacyPassthroughBinding|upstream_context|input_mapping|legacy_value_edges" acc -g "*.py"
```

预期：

- 只允许 `acc/migration/*` 或 explicit rejection tests 命中。

## Phase 6：重写 runtime / scheduler / session lifecycle

目标：runtime 只执行 `CallableRef`，scheduler 只调度 `ExecutionPlan`，`SessionInstance` 是 node execution lifecycle 的唯一事实。

runtime 责任：

- resolve `CallableRef -> AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate`
- materialize payload
- create `SessionInstance(status=running)`
- execute adapter / subprocess / workflow call
- capture stdout / stderr / exit code
- validate output / artifact contract
- write `ArtifactBundle`
- write `ResultStore`
- finalize `SessionInstance`
- append `EventLog`

状态机：

```text
planned -> scheduled -> running -> succeeded
                            -> failed
                            -> cancelled
                            -> timeout
```

原子提交顺序：

1. adapter output written to staging
2. output / artifact validation
3. `ResultStore.put`
4. `ArtifactBundle` publish
5. `SessionInstance` finalize
6. `RunRecord` update
7. `EventLog` append `node_completed`

失败路径：

1. `SessionInstance` finalize failed
2. `EventLog` append `node_failed`
3. `FailureRecord` records layer and cause
4. no completed node commit

Phase 6 测试：

- `tests/integration/test_core_v2_tool_callable.py`
- `tests/integration/test_core_v2_agent_callable.py`
- `tests/integration/test_core_v2_runtime_failure.py`
- `tests/unit/test_core_v2_scheduler.py`
- `tests/unit/test_core_v2_session_lifecycle.py`

## Phase 7：重写 store / manifest / result store / artifact

目标：持久化层只围绕新运行事实组织。

新事实来源：

- `RunRecord`
- `FunctionInvocation`
- `ScopeFrame`
- `NodeInvocationRun`
- `SessionInstance`
- `ArtifactBundle`
- `ResultStore`
- `EventLog`
- `FailureRecord`

新 run directory 不得出现：

- `node_runs/`
- `workflow_graph.json`
- `format: legacy_graph`
- `legacy_compatibility: true`
- `binding_mode: legacy_full`
- old `workflow_run.json` as source of truth

建议布局：

```text
run_record.json
function_invocation.json
scope_frame.json
events.jsonl
result_store/
nodes/<node_id>/node_invocation_run.json
nodes/<node_id>/session_instance_manifest.json
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/artifact_bundle.json
nodes/<node_id>/stdout.txt
nodes/<node_id>/stderr.txt
failures/<failure_id>.json
```

`workflow_summary.json` 如果保留，只能是 projection，不能作为 source of truth。

Phase 7 测试：

- `tests/unit/test_core_v2_result_store.py`
- `tests/unit/test_core_v2_event_log.py`
- `tests/unit/test_core_v2_run_record.py`
- `tests/integration/test_core_v2_run_directory.py`
- `tests/integration/test_core_v2_artifact_manifest.py`

## Phase 8：重写 CLI / API / Debugger / Workbench projection

目标：所有用户表面只表达新 OO 模型。

CLI 允许：

```text
acc workflow run workflow.accflow.json
acc workflow validate workflow.accflow.json
acc migrate graph old.graph.json --out workflow.accflow.json
acc migrate capsule capsules/<id>/capsule.yaml --out callables/...
acc callable list/show/validate
acc runs show <run_id>
acc runs events <run_id>
acc runs artifacts <run_id>
```

CLI 不允许：

```text
acc workflow run old.graph.json
acc workflow validate old.graph.json
acc workflows list includes .graph.json
acc run old_capsule_id
acc capsule test old_capsule_id
acc batch-run with capsule_id
```

旧命令如果暂时保留，必须只做 clear rejection，不得导入 `CapsuleRegistry` 或执行旧对象。

API 原则：

- server route 只调用 app use case。
- server projection 只读 `RunRecord` / `EventLog` / `ResultStore` / `ArtifactBundle`。
- server 不做 graph normalization。
- server 不补 legacy fields。
- server 不推断 runtime state。
- `/api/capsules/*` 必须删除或迁移为 `/api/callables/*`。
- `/api/workflows/run-graph` 必须删除、改名或只接受 canonical Core v2 payload。

Debugger 原则：

- new debugger / replay 基于 `RunRecord + EventLog + ResultStore`。
- legacy run inspector 如果保留，只能在 `acc.migration` 或 explicit historical inspector 中 read-only。
- 不得再用 `.graph.json` 临时文件作为 replay source。

Workbench 原则：

- Workbench canvas 保存 canonical Core v2 `.accflow.json`。
- Workbench node inspector 显示 `NodeInvocationSpec`、binding evidence、ResultStore、ArtifactBundle、SessionInstance。
- Workbench 不生成 `capsule_id`、`legacy_capsule_id`、`input_mapping`、`upstream_context`。

Phase 8 测试：

- `tests/cli/test_core_v2_workflow_cli.py`
- `tests/cli/test_core_v2_legacy_cli_rejection.py`
- `tests/server/test_core_v2_workflow_routes.py`
- `tests/server/test_core_v2_run_projection.py`
- `tests/integration/test_core_v2_debugger_projection.py`
- Workbench changed 时运行 web tests。

## Phase 9：GraphOps 接入新 OO 模型

目标：GraphOps 只操作 canonical model。

GraphOps 输入：

- `WorkflowFunctionTemplate`
- `NodeInvocationSpec`
- `CallableRef`
- `InputBinding`
- `OutputBinding`
- `PermissionProfile`

GraphOps 输出：

- `Proposal`
- `ValidationReport`
- `DryRunReport`
- `ApplyPlan`

GraphOps 不允许：

- understand legacy graph as runtime object
- generate legacy fields
- write `.graph.json`
- use old `WorkflowGraph` as source of truth
- add node with `capsule_id`
- use `connect_nodes` legacy shorthand
- mutate raw node dict with old node shape

Persistent apply 门禁：

- validation passed
- dry-run passed
- human approval present
- target path within workspace
- destructive operation has explicit operation record
- output file contains no legacy runtime fields

Phase 9 测试：

- `tests/unit/test_core_v2_graphops_proposal.py`
- `tests/unit/test_core_v2_graphops_validation.py`
- `tests/unit/test_core_v2_graphops_dry_run.py`
- `tests/integration/test_core_v2_graphops_apply.py`

## Phase 10：物理删除旧架构

目标：真正删除旧架构，而不是只让 hot path 搜索通过。

必须删除或重写：

- `acc.registry`
- `acc.schemas.CapsuleSpec`
- `acc.capsule_authoring`
- `acc.scaffold` old capsule scaffold
- `acc.conductor_export` old graph/capsule export
- `acc.debugger` old graph replay path
- `acc.control_plane` capsule-driven workflow discovery
- `acc.server.routes.capsules`
- old workflow graph schemas
- old workflow run schemas
- old session manifest schema if tied to `capsule_id`
- old node run summary schema
- old `.graph.json` examples from active examples
- old capsule YAML examples from active examples

Allowed archival location:

```text
docs/historical/
tests/fixtures/legacy/
tests/migration/
```

这些位置里的文件不得被 default discovery、CLI list、Workbench list、server list 当成 runnable product assets。

必须删除或重写的测试意图：

- legacy byte-equivalence tests
- tests that depend on `binding_mode=legacy_full`
- tests that mutate `template.nodes[node].raw`
- tests that instantiate `CapsuleRunner`
- tests that validate old graph schema as active product schema
- tests that expect `/api/capsules/*` to drive runtime

替代测试目标：

- legacy input can migrate
- legacy input cannot run directly
- canonical v2 semantics are stable
- new runtime never reads raw
- new run record is source of truth
- callables replace capsules as executable assets

## 最终验收硬门禁

整个 goal 完成必须满足：

1. `acc.app` / `acc.runtime` / `acc.store` / `acc.engine` / `acc.server` / `acc.debugger` / `acc.graphops` 零 `NodeSpec` old usage。
2. 产品代码零 `WorkflowTemplate`。
3. 产品代码零 `node.raw` semantic read。
4. 产品代码零 `CapsuleSpec`。
5. 产品代码零 `CapsuleRegistry`。
6. 产品代码零 `CapsuleRunner`。
7. 产品代码零 `legacy_capsule_id` / `input_mapping` / `legacy_value_edges` runtime usage。
8. `CallableKind` 不包含 `legacy_capsule`。
9. `BindingMode` / `legacy_full` / `mixed` 被删除。
10. `.graph.json` 不可 run / validate / save / list / show，只能 migrate 或 explicit reject。
11. Capsule YAML 不驱动 runtime，只能 migrate 或 archival。
12. `ResultStore` 是 binding 和 workflow output 的唯一读取源。
13. `SessionInstance` 是 node execution lifecycle 的唯一状态源。
14. `ScopeFrame` 是 cwd / inbox / outbox / artifact / env path 的唯一来源。
15. `RunRecord` / `EventLog` 是 inspect / debug / projection 的事实来源。
16. 新 run dir 不写 `node_runs/`、`workflow_graph.json`、`legacy_compatibility`。
17. CLI `--emit-json` stdout exactly one JSON object。
18. logs 只进 stderr 或文件，不污染 stdout。
19. artifact path escape 被拒绝。
20. scope cwd escape 被拒绝。
21. migration output path 被检查。
22. GraphOps apply target path 被检查。
23. active examples 中没有 legacy `.accflow.json` 字段。
24. active API 中没有 `/api/capsules/*` runtime surface。
25. default tests 不通过 `collect_ignore` 藏旧架构失败；历史测试必须迁移到 `tests/migration` 或 `tests/fixtures/legacy`。

最终搜索门禁：

```bash
rg -n "NodeSpec|WorkflowTemplate|node\.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|legacy_compatibility|mirror_legacy_node_run|execute_legacy_capsule_node|CapsuleSpec|CapsuleRegistry|CapsuleRunner|ACC_USE_CALLABLE_DISPATCH|upstream_context|workflow_graph\.json|node_runs" acc -g "*.py"
```

预期：

- 除 `acc/migration/*` 外无命中。
- `acc/migration/*` 命中必须是 raw legacy input parser 或 migration provenance，不能实例化旧架构 class。

```bash
rg -n "capsule_id|\.graph\.json|workflow_graph_schema|workflow_run_schema|node_run_summary_schema|session_manifest_schema" acc schemas examples tests -g "*.py" -g "*.json" -g "*.yaml"
```

预期：

- active product code 无 runtime usage。
- active examples 无 legacy runnable asset。
- schemas 中无 active old runtime schema。
- tests 中 legacy 命中只在 `tests/migration`、explicit rejection tests、historical fixtures。

最终必须运行：

```bash
uv run pytest -q
uv run ruff check .
```

如果改了 server/API：

```bash
uv run pytest tests/server -q
```

如果改了 CLI：

```bash
uv run pytest tests/cli -q
```

如果 `tests/cli` 不存在，必须运行覆盖 CLI 的 integration tests，并在报告中明确说明：

```bash
uv run pytest tests/integration/test_core_v2_workflow_cli.py tests/integration/test_core_v2_capsule_cli_rejection.py tests/integration/test_workflow_import_graph.py tests/integration/test_graphops_dry_run.py -q
```

如果改了 Workbench：

```bash
cd web
npm run test -- --run
npm run build
```

## 给 Codex 的执行约束

执行顺序必须是：

1. 先确认新 OO 模型是否能表达旧能力。
2. 再替换 runtime usage。
3. 再替换 CLI/API/Debugger/Workbench/GraphOps usage。
4. 再替换 active tests usage。
5. 再迁移 active examples。
6. 最后删除 dead code / dead schema / dead tests。

不要从“删文件”开始。

正确删除策略是：

1. 先替换产品调用点。
2. 增加 Core v2 replacement tests。
3. 增加 legacy rejection / migration tests。
4. 删除旧代码。
5. 删除或迁移旧测试。
6. 跑最终搜索门禁和全量验证。

如果发现新模型表达不了旧能力，禁止把旧字段塞进 `raw` 或 `metadata.legacy_*`。

正确处理是：

1. 暂停该 phase。
2. 记录缺失语义。
3. 扩展新 OO canonical model。
4. 增加 validation 和测试。
5. 再继续迁移。
