# ACC SDD Constitution

## 1. 文档定位

这份文档是 Agent Capsule Conductor（ACC）的 SDD 顶层宪法。它不是功能清单，也不是代码目录说明，而是后续所有
requirements、design、implementation plan、task、code review、测试验收都必须服从的最高约束。

如果后续 spec、计划、代码、UI、API 或 agent 生成补丁与本文冲突，默认以本文为准。只有经过本文第 10 节的 amendment
流程，才能修改这些约束。

ACC 的一句话模型是：

```text
ACC 把可复用的 agent/tool/workflow 定义，转成隔离的一次性 runtime invocation；
只通过显式 ports、bindings、inbox/outbox 和 artifacts 移动数据；
用本地 evidence 记录执行事实；
用 GraphOps 和 human approval 治理持久化变更。
```

换成更直白的话：ACC 的价值不是“自己做一个更聪明的 LLM agent”，而是给成熟外部 agent 和本地工具提供一个可复用、可审计、可回放、可治理的执行边界。

## 2. SDD 工作模式

ACC 采用 **spec-anchored SDD**，不是一次性瀑布文档，也不是当前阶段的 spec-as-source。

这意味着：

- 新增重要能力前，必须先让 spec 说明目标、边界、数据流、失败路径和验证方式。
- 实现完成后，如果代码事实改变了产品契约，必须回写 spec。
- 对已有行为，代码和 run evidence 是事实来源；spec 要约束后续演进，不能凭空覆盖当前实现。
- AI 生成代码时，应先读取相关 spec，再定位最小修改点。

每个重要变更都应能追踪到：

```text
intent
  -> requirement
  -> design decision
  -> implementation task
  -> code change
  -> verification evidence
```

如果某个变更说不清这条链路，它就不应该进入核心架构。

## 3. 第一性原理

ACC 的核心复杂度来自四个“必须分开”的东西。

### 3.1 Definition 不是 execution

`AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate` 是可复用定义；`FunctionInvocation`、`ScopeFrame`、
`SessionInstance` 是一次运行事实。

这个边界不能混。定义像 C++ 里的 class/function，运行像 object instance/call frame。把运行态写回定义，会导致一个 task 的输出、状态、路径、conversation memory 污染另一个 task。

代码锚点：

- `acc/models.py` 中这些对象都是独立的 frozen dataclass。
- `acc/app/runtime/orchestrator.py` 在 run 启动时创建 `FunctionInvocation` 和 `ScopeFrame`，并写入 `function_invocation.json`、`scope_frame.json`。
- `acc/app/runtime/executor.py` 为 node 创建 `SessionInstance` 和节点级 evidence。

### 3.2 Control flow 不是 data flow

`ControlEdge` 只回答“谁先谁后”；`DataEdge`、bindings、ports、inbox/outbox、artifact refs 才回答“谁能读到什么”。

如果把调度顺序等价成数据权限，下游节点就可能读到未声明的上游文件，nested workflow 也会意外继承父 scope 的数据。

代码锚点：

- `docs/CURRENT_ARCHITECTURE.md` 明确 control dependency 和 data dependency 分离。
- `acc/runtime/transfer_policy.py`、`acc/runtime/node_payload.py`、`acc/app/runtime/workflow_io.py` 承担数据搬运和 payload 解析职责。
- `acc/engine/workflow_validation.py` 对 workflow 结构、ports、bindings 做静态检查。

### 3.3 Evidence 不是 projection

`run_record.json`、`run_summary.json`、`events.jsonl`、node manifests、artifact bundles 是运行事实；server response、Workbench state、SSE event、cloud sync delta 都只是 projection。

Projection 可以为了可读性折叠、过滤、补充 display metadata，但不能改变事实含义。

代码锚点：

- `acc/app/control_projection.py` 的模块注释说明它是 run-scoped control ledger 的 read-only projection。
- `acc/server/run_projection.py` 和 `/api/runs/.../projection/...` 是 ResultStore/runtime side-channel 的只读视图。
- `web/src/components/workflow-viewer/runState.ts` 提供 `stripRuntimeStateFromCanvas()`，防止把 runtime projection 存回 canvas。

### 3.4 LLM assistance 不是 authority

外部 agent 或 LLM 可以提出修改建议，但不能直接拥有持久化工作流资产的修改权。

ACC 允许 agent 参与 authoring，是因为 GraphOps 把 mutation 变成 typed proposal、validation、dry-run、human approval、apply。没有这条治理链路，ACC 会变成不可审计的 self-modifying system。

代码锚点：

- `acc/graphops.py` 的 `GraphOpsService` 是 proposal 创建、validate、dry-run、approve、apply 的统一入口。
- `acc/server/routes/graphops.py` 暴露 `/api/graphops/proposals/...`。
- `tests/server/test_graphops_api.py` 覆盖 dry-run 不 mutation、未 approval 不能 apply、approval 后才 apply。

### 3.5 Local machine 不是 cloud authority

ACC 是 local-first。远程 runner、cloud sync、paired control plane 可以是产品扩展，但不能反向成为 Core v2 执行的前提，也不能让 cloud intent 自动等价成本地 human approval。

代码锚点：

- `acc/cloud_sync.py` 明确 cloud projection 不是 local truth。
- `acc/runner.py`、`acc/server/routes/runner.py` 属于产品化接入层，而不是 Core v2 运行时的必要条件。
- `tests/unit/test_cloud_sync.py` 和 `tests/server/test_runner_api.py` 中有 projection redaction 和 local path 权限边界测试。

## 4. 不可违反原则

以下原则使用 RFC 风格语义：

- `MUST`：必须满足，违反就是架构错误。
- `MUST NOT`：禁止，除非先 amend 本宪法。
- `SHOULD`：默认应满足，例外必须记录原因和风险。
- `MAY`：允许，但不能破坏 `MUST` 规则。

### Article 1: Core v2 callable-only 是唯一当前产品架构

**规则**

ACC 的当前核心架构 MUST 保持 Core v2 callable-only：

```text
WorkflowFunctionTemplate
  -> FunctionInvocation
  -> ScopeFrame
  -> NodeInvocationSpec
  -> SessionInstance or child FunctionInvocation
  -> outbox/artifacts/events/manifests
  -> downstream inbox materialization
```

Canonical workflow 文件 MUST 是：

```text
workflows/<id>.accflow.json
```

Legacy `*.graph.json` MAY 被 import 或作为历史 fixture 读取，但 MUST NOT 成为新 runtime、Workbench save/run、Debugger projection、GraphOps apply 的事实源。

**成立原因**

ACC 之前经历过 legacy runtime、capsule、graph、clean-core 多阶段演化。如果继续让多个 runtime 同时拥有产品语义，任何 AI 后续开发都会被历史名字误导：它会看见旧类、旧 manifest、旧 examples，然后把兼容入口当成当前架构。

Core v2 callable-only 的价值是把系统收敛到一个主轴：可复用定义、一次性调用、隔离 scope、稳定 evidence。

**失败模式**

- 新代码重新实例化旧 runtime class。
- Workbench 保存 legacy raw graph 字段，并让 runtime 解释这些字段。
- Debugger 或 projection 读取旧 `workflow_graph.json` 当 truth。
- `.graph.json` 被当作 active workflow，而不是 import-only。

**验证方式**

- `rg -n "legacy|graph\\.json|accflow|WorkflowFunctionTemplate|run_core_v2_workflow_path" acc tests docs`
- 运行 Core v2 workflow loader/runtime 测试。
- 检查新增 API 和 UI save path 是否输出 `.accflow.json`。

### Article 2: Template MUST NOT 存 runtime state

**规则**

以下内容 MUST NOT 作为 template semantics 写入 `AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate` 或 `NodeInvocationSpec`：

- `run_id`
- `session_id`
- run directory
- local absolute workspace binding
- previous output
- transient node status
- terminal runtime status
- execution log path
- conversation memory
- artifact path from a previous run

这些内容 MUST 只存在于 run-scoped evidence、local binding 文件、agent session evidence 或明确标注的 UI convenience state 中。

**成立原因**

Template 是可复用行为定义；runtime state 是某一次运行的结果。把二者混起来，相当于把一次函数调用的 stack frame 写进函数定义。后果不是“文档不优雅”，而是直接破坏复用和并发。

**失败模式**

- 两个 task 使用同一个 template 时互相覆盖 run 状态。
- Workbench 切换 task 后看到上一次 task 的输出。
- 一个 agent class 继承了上一次 session 的 conversation memory。
- 保存 workflow 后，里面包含本机绝对路径，其他机器无法运行。

**验证方式**

- `rg -n "run_id|session_id|activeRunId|latestRunId|output_path|stderr_log|stdout_log" workflows callables web/src acc`
- 检查 `stripRuntimeStateFromCanvas()` 是否用于保存 Workbench canvas。
- 检查 `tests/server/test_workbench_canvas_snapshots_api.py`、`tests/server/test_workbench_core_v2_api.py` 是否覆盖 task/run 分离和 bad task id。

### Article 3: Data movement MUST explicit

**规则**

上游节点 MUST NOT 直接写入下游 workspace。所有跨节点、跨 workflow、跨 scope 的数据移动 MUST 经过 ACC 拥有的显式机制：

```text
PortContract
DataEdge
binding
inbox
outbox
ResultStore
ArtifactBundle
workflow-call binding
```

Control scheduling MUST NOT 自动赋予 data access。

**成立原因**

Workflow 的可审计性依赖“谁把什么数据交给了谁”能被复盘。直接写 downstream workspace 会把数据流藏进文件系统副作用里，导致 replay、debugger、artifact review 和权限审计都失效。

**失败模式**

- B 节点依赖 A 生成的文件，但 workflow graph 看不出这条依赖。
- nested workflow 读到 parent scope 未声明的数据。
- rerun-from-node 时结果不一致，因为隐藏文件没有被重放。
- downstream 输入检查通过，但实际执行读取了 workspace 中的旧文件。

**验证方式**

- 检查 node payload、binding manifest、outbox/inbox materialization。
- `rg -n "binding_manifest|outbox|inbox|result_store|ArtifactBundle|transfer_policy" acc tests`
- 用 rerun/replay/debugger 测试确认输入来自 evidence，而不是隐式 workspace residue。

### Article 4: Runtime evidence MUST be auditable truth

**规则**

每次 workflow execution MUST 产生 run-scoped evidence。文件集合可以加法扩展，但新增 evidence 必须仍然投影自 Core v2 invocation/session/result 概念。

当前核心 evidence 包括：

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

Status names MUST 使用 canonical names，例如：

```text
success
failed
cancelled
crashed
```

UI MAY 使用 `queued`、`running`、`cancel_requested`、`not_run` 等 projection 状态，但不能伪造 terminal truth。

**成立原因**

ACC 是 local-first，没有数据库作为最终事实源。run directory 就是事实数据库。如果 evidence 不完整或职责混乱，后续所有 projection、debugger、replay、cloud sync、assistant review 都会建立在不可靠的输入上。

**失败模式**

- `run_summary.json` 说 success，但 control ledger 仍 active。
- events 丢失 sequence，SSE/polling 无法增量读取。
- node output 只存在 UI state，不存在 run evidence。
- projection 端点把缺失 evidence 补成 success。

**验证方式**

- 检查 run 目录中 `function_invocation.json`、`scope_frame.json`、`events.jsonl`、node manifests 是否存在。
- `rg -n "write_json\\(|write_json_atomic|append_jsonl_locked|FixedRunControlLedgerWriter|run_summary" acc tests`
- 运行 run projection、control ledger、Core v2 workflow tests。

### Article 5: `FixedRunControlLedgerWriter` is the sole mutable run control writer

**规则**

Run control state 的持久化 mutation MUST 通过 `FixedRunControlLedgerWriter` 或后续明确替代者完成。普通 API route、Workbench、projection loader、assistant session、cloud sync MUST NOT 绕过控制账本直接改写 plan/dispatch/decision truth。

**成立原因**

ACC 不是只跑一个简单 DAG。它还要处理 human gate、supervisor、handoff、resume、cancel、nested workflow 和 replay。如果多个模块都能随手改 run status 或 dispatch 状态，就会出现“UI 认为可继续、runtime 认为 terminal、ledger 认为 waiting”的分裂。

**失败模式**

- Human approval 后 DAG 不继续，因为 scheduler state 和 ledger state 不一致。
- cancel marker 被 UI 清理，但 runtime 仍继续执行。
- resume path 只改一个 projection 文件，没有恢复 dispatch。
- run finalization 被重复写入，导致 events 和 summary 不一致。

**验证方式**

- `rg -n "FixedRunControlLedgerWriter|transition_step|transition_dispatch|DecisionRecord|RunPlan|PlanStep" acc tests`
- control ledger API tests 应只读 projection。
- resume/human gate/cancel tests 应覆盖 ledger 状态和 run summary 的一致性。

### Article 6: GraphOps MUST be governed mutation

**规则**

持久化修改 callable/workflow/resource assets 的 AI-assisted path MUST 走 GraphOps 或等价治理链路：

```text
proposal
  -> validation
  -> dry-run
  -> semantic diff / target paths / digest
  -> human approval
  -> apply
  -> apply manifest
```

Destructive 或 privilege-expanding change MUST NOT apply without explicit human approval。

**成立原因**

ACC 允许外部 agent 参与编辑 ACC 自己的 workflow。如果没有 GraphOps，系统会变成“运行中的 agent 可以无审计地改掉未来要运行的 workflow”。这是递归自动化里最危险的部分。

**失败模式**

- LLM 删除 human gate。
- LLM 给 agent template 加 `danger-full-access`。
- LLM 绕过 schema validation，写出不可执行 workflow。
- LLM 基于旧 base hash apply，覆盖用户刚保存的修改。
- Runtime 临时判断被写回 template，污染未来运行。

**验证方式**

- `rg -n "GraphOpsService|dry_run|approve|apply|dry_run_digest|stale_base|human_approved" acc tests`
- `tests/server/test_graphops_api.py` 必须证明 dry-run 不 mutation、未 approval 不能 apply、approval 校验 digest/base hashes。
- 禁止 GraphOps 修改 `runs/<run_id>` evidence 当作 reusable template。

### Article 7: Layer boundaries MUST remain enforceable

**规则**

纯层 MUST 保持纯计算：

```text
acc.models
acc.serialization
acc.validation
acc.state_machine
acc.engine
```

这些层 MUST NOT：

- read/write filesystem；
- spawn subprocess；
- 读取 host environment；
- import FastAPI / React / Workbench；
- 调用外部 agent/tool；
- 写 run evidence。

Runtime effects MUST 留在：

```text
acc.runtime
acc.app.runtime
acc.adapters
acc.store
acc.storage
acc.result_store
```

`acc.server` MUST 是 thin API/projection layer。`web/` MUST 是 interaction/projection layer。

**成立原因**

ACC 后续会大量让 AI 读 spec 后改代码。层边界如果不硬，AI 很容易为了“快速修 bug”让 engine 读文件、让 route 写业务状态、让 UI 成为事实源。短期看代码少，长期会把系统变成不可验证的副作用网络。

**失败模式**

- `acc.engine` 里出现 `Path.read_text()` 或 subprocess。
- FastAPI route 直接改 ledger 文件，而不是调用 app service。
- UI local state 变成 run terminal status。
- storage helper 在多个模块复制，原子写/path safety 行为分叉。

**验证方式**

- `rg -n "open\\(|read_text|write_text|subprocess|FastAPI|React|fetch" acc/engine acc/models.py acc/state_machine.py acc/validation.py`
- 代码 review 检查 import direction。
- 新增 filesystem helper 时优先扩展 `acc/storage.py`、`acc/store` 或 `acc/utils.py`，不要局部 copy-paste。

### Article 8: Workbench MUST remain projection plus editor

**规则**

Workbench 可以编辑 workflow/callable authoring state，可以展示 run evidence projection，但 MUST NOT 成为 runtime truth。

Workbench MAY 保存：

- selected task；
- selected node；
- local canvas layout；
- `activeRunId` / `latestRunId` convenience pointer；
- assistant proposal preview；
- temporary authoring state。

Workbench MUST NOT 把以下内容保存为 template semantics：

- terminal node status；
- previous output；
- log path；
- artifact path；
- run id as workflow meaning；
- agent memory；
- runtime error state。

Multiple concurrent runs MUST 以 `run_id + task_id` 或等价 key 区分。一个全局 `isRunning` singleton 作为 durable model 是架构错误；作为当前 selected task 的 UI disable flag 可以存在，但不能成为全局运行事实。

**成立原因**

Workbench 是人使用 ACC 的主要表面。它必须让人看见事实，但不能为了交互方便把事实搬进 React state。否则刷新、切换 task、多 run、后台 run、server restart 都会破坏一致性。

**失败模式**

- 切换 task 后旧 run overlay 消失。
- task A 正在运行时 task B 被全局 disabled。
- 保存 canvas 时把 node output 存进 `.accflow.json`。
- inspector 显示的是 placeholder，而不是 run evidence。

**验证方式**

- `rg -n "stripRuntimeStateFromCanvas|activeRunId|latestRunId|isRunning|run_id|task_id" web/src tests/server`
- frontend tests 应覆盖多 task、多 run、canvas 保存不带 runtime state。
- server API 应通过 run evidence 读取 node detail、events、logs、artifacts。

### Article 9: CLI machine-readable stdout MUST stay clean

**规则**

当 CLI 使用 `--emit-conductor-json`、`--emit-json` 或等价 machine-readable flag 时，stdout MUST exactly contain one JSON object。

Logs、warnings、progress、diagnostics MUST go to stderr or files。

**成立原因**

ACC 本身会被其他 agent、脚本、workflow runner 调用。stdout JSON 是外部自动化最脆弱也最关键的契约。只要多打印一行 log，上游 parser 就会失败。

**失败模式**

- `print()` 调试污染 stdout。
- adapter 把外部 agent stdout 直接透传到 ACC CLI stdout。
- error path stdout 输出半个 JSON，stderr 又输出 diagnostics。
- PowerShell redirect 编码导致 JSON smoke 判断不可靠。

**验证方式**

- `rg -n "emit-conductor-json|emit-json|dump_json|log_stderr|print\\(" acc tests`
- CLI smoke test 用 `json.loads(result.stdout)` 或 `python -m json.tool` 验证 stdout。
- error path 测试确认 stdout empty，stderr 有错误。

### Article 10: Default verification MUST be hermetic

**规则**

Default tests MUST NOT require real Codex、Claude、Cursor、Gemini、Hermes、network、paid services、cloud account、browser login 或外部 credentials。

External smoke tests MAY exist, but MUST be opt-in and clearly marked。

**成立原因**

ACC 要服务的是本地开发和 AI-assisted refactor。如果默认测试依赖外部服务，后续 agent 每次改动都无法可靠验证，CI 也会变成环境运气。

**失败模式**

- 默认 pytest 调真实 Codex CLI。
- 默认 tests 依赖网络数据或付费 API。
- 外部 provider 不可用时测试随机失败。
- hermetic fixture 与生产 path 分叉太大，测试通过但真实 adapter 从未覆盖关键 contract。

**验证方式**

- `tests/conftest.py` 默认设置 `ACC_RUN_MODE=hermetic`。
- `rg -n "ACC_RUN_MODE|ACC_ENABLE_EXTERNAL_AGENT_EXECUTION|FakeCodex|network|skipif" tests acc`
- 新增真实 provider smoke test 时必须放在 opt-in 路径，并在文档里标注环境变量和跳过条件。

### Article 11: Local-first MUST remain the default product boundary

**规则**

Core ACC MUST NOT require database、cloud backend、Kubernetes、SaaS control plane、remote runner 或 network service 才能运行。

Runner、cloud sync、paired control plane MAY exist as optional product extensions，但它们 MUST NOT：

- 改变 Core v2 callable runtime 的前提；
- 把 cloud job intent 当成本地 execution approval；
- 上传本地绝对路径、secret-like paths 或 provider identifiers；
- 让 remote state 覆盖 local evidence truth；
- 绕过 GraphOps approval。

**成立原因**

ACC 的基本可信边界是本地项目目录和本地 evidence。云能力可以增加协作和可见性，但如果云变成 authority，ACC 的 local-first 可审计性会被削弱。

**失败模式**

- Cloud job 携带 `F:\...` 绝对路径并让本地执行。
- Cloud projection 把 redacted evidence 当完整 run truth。
- Remote approval 被当作 GraphOps human approval。
- Runner DTO 暴露本地 secret-like path。

**验证方式**

- `rg -n "Cloud job intent cannot|absolute paths|redact|projection|runner" acc/cloud_sync.py acc/runner.py tests`
- runner/cloud sync tests 应覆盖 path redaction、local token、projection 不暴露 absolute paths。
- Core workflow tests 不应 import 或依赖 cloud sync。

### Article 12: Security and path safety MUST be centralized

**规则**

Run IDs、artifact refs、workflow paths、binding paths、preview paths MUST validate against traversal、absolute path escape、drive prefix、secret-like exposure。

Filesystem mutation SHOULD use centralized helpers such as：

```text
validate_run_id
claim_run
prepare_runtime_run_dir
write_json_atomic
write_text_atomic
append_jsonl_locked
```

ACC-owned run directories SHOULD be marked, and destructive operations MUST NOT target unmarked arbitrary directories.

**成立原因**

ACC 处理的是本地文件系统和外部工具执行。路径边界错一次，就可能把用户项目外的文件暴露给 UI/API/cloud sync，或者删除非 ACC 目录。

**失败模式**

- `../` 读出项目外文件。
- artifact preview 暴露 `.env`、credential、provider token。
- run cleanup 删除用户自己创建的目录。
- 多个 `write_json` helper 行为不一致，导致部分 evidence 非原子写。

**验证方式**

- `rg -n "validate_run_id|claim_run|prepare_runtime_run_dir|write_json_atomic|append_jsonl_locked|reject_secret_like" acc tests`
- `tests/unit/test_storage.py` 应覆盖 run id rejection、marker、atomic write、JSONL sequence。
- artifact/server tests 应覆盖 traversal 和 secret-like path rejection。

## 5. 状态、事实和投影的职责表

| 类别 | 例子 | 是否 durable truth | 允许谁写 |
| --- | --- | --- | --- |
| Template | `.accflow.json`, `AgentClassTemplate`, `ToolClassTemplate` | 是，定义态 truth | Workbench save/API/GraphOps，受 validation 约束 |
| Invocation evidence | `function_invocation.json`, `scope_frame.json`, node manifests | 是，运行态 truth | Runtime/store/ledger writer |
| Event evidence | `events.jsonl`, node `events.jsonl` | 是，时序 truth | Runtime/event helpers |
| Control ledger | `RunPlan`, `PlanStep`, `DispatchEnvelope`, `DecisionRecord` | 是，控制态 truth | `FixedRunControlLedgerWriter` |
| Result/artifact evidence | `result_store/`, `workflow_outputs/`, `ArtifactBundle` | 是，输出 truth | Runtime/result store/artifact store |
| Server response | `/api/runs/...`, `/api/graphops/...` | 否，projection | Server routes/app services |
| Workbench state | selected node, layout, activeRunId/latestRunId | 否，UI convenience | Frontend stores/API |
| Cloud projection | redacted run projection delta | 否，remote projection | Cloud sync extension |

## 6. SDD 交付约束

任何后续 SDD 文档都必须回答以下问题：

1. 这个 spec 是否违反本文任一 article？
2. 它新增或修改了哪些 durable truth？
3. 它的 input、processing、output、persistent state、failure mode 分别是什么？
4. 它如何保持 template/runtime state 分离？
5. 它如何通过 evidence 验证？
6. 它是否影响 GraphOps/human approval/security/path safety？
7. 它是否新增默认外部依赖？如果有，为什么不是 opt-in？

实现任务必须能映射回 spec section 和 verification item。没有可验证出口的设计，不应进入 implementation。

## 7. 默认验证基线

默认 backend 验证：

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
uv run pytest -q
uv run ruff check .
```

默认 frontend 验证：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

根据修改范围，可以运行更小的 focused tests；但最终交付记录 MUST 说明：

- 实际运行了哪些命令；
- 哪些命令未运行；
- 未运行的原因；
- 剩余风险；
- 对应的 constitution/spec 条款。

## 8. 架构违规判定标准

以下情况默认判定为架构违规：

- `acc.engine`、`acc.models`、`acc.state_machine` 产生 IO、副作用或依赖 server/UI。
- Template 写入 run-specific state。
- Runtime 直接读取 legacy graph 字段作为当前产品语义。
- Upstream node 直接写 downstream workspace。
- Workbench 或 server projection 覆盖 run evidence。
- GraphOps proposal 未 dry-run/approval 即 apply。
- CLI JSON 模式 stdout 出现非 JSON log。
- 默认 tests 依赖真实外部 provider 或网络。
- Cloud/runner extension 改变 Core v2 local runtime 前提。
- 新增 ad hoc filesystem helper 绕过 path safety / atomic write。

如果为了短期修复必须临时违反，需要：

1. 在 PR/交付说明中显式标注 violation。
2. 给出风险和影响范围。
3. 添加回收任务。
4. 不得把临时例外写成新常态。

## 9. 代码事实抽查清单

维护本文或评审重大架构变更时，至少抽查这些位置：

```text
AGENTS.md
docs/CURRENT_ARCHITECTURE.md
docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md
docs/concepts/CAPSULE_TEMPLATE_SESSION.md
docs/concepts/GRAPHOPS_CONTROL_PLANE.md

acc/models.py
acc/serialization.py
acc/validation.py
acc/state_machine.py
acc/engine/
acc/ledger_writer.py
acc/app/runtime/
acc/runtime/
acc/storage.py
acc/store/
acc/result_store/
acc/graphops.py
acc/server/routes/graphops.py
acc/cli.py

web/src/components/workflow-viewer/runState.ts
web/src/components/WorkflowViewer.tsx
web/src/stores/

tests/unit/test_storage.py
tests/unit/test_runtime_policy.py
tests/server/test_graphops_api.py
tests/server/test_workbench_canvas_snapshots_api.py
tests/server/test_workbench_core_v2_api.py
tests/integration/test_core_v2_workflow_run.py
```

建议抽查命令：

```bash
rg -n "WorkflowFunctionTemplate|FunctionInvocation|ScopeFrame|SessionInstance|ArtifactBundle" acc tests docs
rg -n "GraphOpsService|dry_run|approve|apply|human_approved|stale_base" acc tests docs
rg -n "stripRuntimeStateFromCanvas|activeRunId|latestRunId|isRunning|task_id|run_id" web tests docs
rg -n "emit-conductor-json|emit-json|dump_json|log_stderr|print\\(" acc tests docs
rg -n "ACC_RUN_MODE|ACC_ENABLE_EXTERNAL_AGENT_EXECUTION|FakeCodex|hermetic" tests acc docs
rg -n "validate_run_id|claim_run|prepare_runtime_run_dir|write_json_atomic|append_jsonl_locked" acc tests docs
```

## 10. Amendment 流程

本文可以修改，但不能静默漂移。修改本文必须通过显式 SDD amendment：

1. 引用当前规则。
2. 说明 proposed replacement。
3. 解释为什么旧规则不再符合 ACC 产品方向。
4. 列出受影响的 spec、代码模块、API、UI、tests、evidence files。
5. 给出失败模式和迁移风险。
6. 添加或更新验证标准。
7. 经人工 review 后再实现。

如果代码事实已经与本文冲突，不能直接假设代码正确。正确处理方式只有两种：

- 修代码，使它重新符合 constitution。
- 提交 amendment，用证据说明 constitution 应改变。

Silent drift is not allowed.
