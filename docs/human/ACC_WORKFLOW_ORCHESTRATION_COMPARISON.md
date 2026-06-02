# ACC 工作流编排深度研究报告

状态：对比分析文档。架构事实以 `docs/CURRENT_ARCHITECTURE.md` 为准；本文用于解释 ACC
和 Multica、Paperclip、LangGraph、Dify、Conductor 等方案的边界差异。

## 结论

ACC 是为了解决一个很具体的问题而生：把 Codex CLI、Claude、Cursor、Gemini 这类成熟外部 agent，包装成可编排、可隔离、可复现、可审计的本地 workflow 节点。

它不是 Multica / Paperclip 那种 agent 团队管理平台，也不是 LangGraph 那种写 agent 内部状态图的 SDK。ACC 的核心价值在于：不重造 LLM agent loop，只治理 agent 的执行边界、数据边界、产物边界、权限边界和人工审批边界。

一句话对比：

```text
Multica 管“谁来做 issue”。
Paperclip 管“agent 公司怎么运转”。
LangGraph 管“agent 内部状态图怎么写”。
ACC 管“外部成熟 agent 如何在本地 workflow 中可控、隔离、可产物化地运行”。
```

## ACC 要解决的问题

成熟 coding agent 已经能完成复杂任务，但单次 agent 运行天然缺少几个工程化约束：

1. 运行状态容易混在一起：同一个 agent 连续执行不同任务时，workspace、临时文件、上下文和输出容易污染。
2. 结果不稳定：agent 说“完成了”不等于有稳定的 `output.json`、artifact、event log 和 manifest。
3. 工作流边界不清：上游任务结果如何进入下游任务，很多系统依赖聊天上下文或隐式状态。
4. 权限边界不硬：真实 agent 会读写文件、调用 shell、继承环境变量、访问网络，需要外部执行边界约束。
5. LLM 自改 workflow 风险高：如果 agent 可以直接改 callable/workflow，就可能删除 human gate、放开危险权限或破坏 schema。

ACC 的问题定义不是“让 LLM 更聪明”，而是：

```text
成熟 agent 负责推理和工具循环。
ACC 负责执行边界、artifact、session、workspace、port 和权限。
Workflow/Conductor 负责确定性拓扑。
Human Authority 负责最终批准 callable/workflow 变更。
```

## 当前架构如何解决

当前真实代码已经收敛到 Core v2 callable-only 主链：

```text
canonical .accflow.json
  -> WorkflowFunctionTemplate
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> NodeInvocationSpec
  -> SessionInstance or child FunctionInvocation
  -> events / result_store / artifacts / run_summary
```

### 1. Domain：只表达概念和不变量

关键代码：

- `acc/domain.py`

它定义：

- `AgentClassTemplate` / `ToolClassTemplate`：可复用 agent/tool class。
- `WorkflowFunctionTemplate`：可保存、可复用、无状态的 workflow function body。
- `NodeInvocationSpec`：workflow function 中的一次 call site。
- `FunctionInvocation`：一次 workflow function runtime call。
- `ScopeFrame`：这次调用能看到的 cwd、inbox、outbox、artifact root 和 behavior snapshot。
- `SessionInstance`：一个 agent/tool 节点的具体执行实例。
- `ControlEdge`：控制依赖，决定谁先跑。
- `DataEdge`：数据依赖，决定 artifact 从哪个 output port 到哪个 input port。
- `PermissionProfile`：节点运行权限，如 workspace 写权限、network、shell、env policy、timeout。
- `ArtifactBundle`：节点产物的稳定描述。

关键点：`domain` 不做文件 IO、不跑 subprocess、不知道 CLI/UI。这让核心概念可以独立验证。

### 2. Engine：只管 workflow 语义

关键代码：

- `acc/engine/__init__.py`

它负责：

- 解析 canonical `.accflow.json` 为 `WorkflowFunctionTemplate`。
- 拒绝 Core v2 模板和节点中的未知字段。
- 拒绝旧 `capsule_id`、`input_mapping`、`runtime`、`tool`、`workflow_ref` 等旧节点语义。
- 校验 node id、port、control edge、data edge。
- 编译 `ExecutionPlan`。
- 计算 `callable_topological_levels()`，把 DAG 拆成可并行执行层。

关键机制：

```text
ControlEdge = 执行顺序
DataEdge    = 显式数据传输
```

这避免了一个常见错误：把“谁先执行”误解成“谁可以读取谁的全部上下文”。

### 3. Runtime evidence：只认运行事实文件

关键代码：

- `acc/store/__init__.py`
- `acc/app/core_v2_runtime.py`
- `acc/result_store/filesystem.py`

当前 Core v2 run directory 的关键事实文件是：

```text
run_record.json
run_summary.json
function_invocation.json
scope_frame.json
events.jsonl
result_store/
workflow_outputs/<port>/output.json
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/session_instance_manifest.json
nodes/<node_id>/output.json
nodes/<node_id>/artifact_bundle.json
nodes/<node_id>/events.jsonl
```

这组文件的意义是：CLI/API/Workbench/Debugger 应从这些运行事实投影 UI，而不是从旧
`node_runs/`、`workflow_graph.json` 或 `.graph.json` 反推真相。

### 4. App/runtime：串起 engine、registry、result store 和执行边界

关键代码：

- `acc/app/__init__.py`
- `acc/app/core_v2_loader.py`
- `acc/app/core_v2_runtime.py`
- `acc/callable_registry.py`

当前主入口是：

```text
WorkflowAppService.run
  -> run_clean_workflow_template
  -> run_core_v2_workflow_path
  -> load_workflow_function_template
  -> compile_execution_plan
  -> run_workflow_function_invocation
```

执行流程：

```text
1. load canonical Core v2 .accflow.json
2. compile ExecutionPlan
3. create FunctionInvocation and root ScopeFrame
4. 按 ExecutionPlan level 调度 NodeInvocationSpec
5. resolve agent_payload / runtime_payload / binding_manifest
6. 执行 CallableRef
7. 写 node output、artifact_bundle、events
8. 写 ResultStore 和 workflow_outputs
9. 更新 run_record / run_summary
```

同一个 level 内使用 `asyncio.gather()` 并发。这个调度是 run-scoped、进程内的轻量调度，不是
durable distributed scheduler。

### 5. Callable discovery：不再扫描 capsule YAML

关键代码：

- `acc/callable_registry.py`

当前 reusable callable class 从这里发现：

```text
callables/agents/*.yaml
callables/tools/*.yaml
```

旧 `capsules/*/capsule.yaml` 不再是产品运行时的可执行资产入口。真实外部 agent 仍由 mature
agent 自己负责 reasoning/tool loop；ACC 负责调用边界、payload、cwd、stdout/stderr、artifact 和
证据文件。当前默认测试路径主要依赖 hermetic fake/stub；native external-agent Core v2 adapter 仍是
后续需要补齐的边界。

## ACC 的核心优势

### 1. 不重造 agent loop

ACC 不把自己变成 Dify、LangGraph、AutoGen 或 CrewAI 那种 agent framework。它承认 Codex/Claude/Cursor 已经有成熟的 reasoning/tool loop。

ACC 只做外壳：

```text
prompt/input/schema
workspace/session
adapter
event/artifact
permission
workflow edge
```

优势是复杂度低，边界清楚，未来可以继续接入新的成熟 CLI agent。

### 2. Artifact-first，而不是 chat-first

很多 agent 平台的中心是 task/comment/chat/status。ACC 的中心是文件事实：

- `agent_payload.json`
- `runtime_payload.json`
- `binding_manifest.json`
- `output.json`
- `artifacts/`
- `artifact_bundle.json`
- `events.jsonl`
- `session_instance_manifest.json`
- `function_invocation.json`
- `scope_frame.json`
- `run_record.json`
- `run_summary.json`

这让 ACC 更适合工程场景：调试、复现、批处理、CI、审计、Conductor script step。

### 3. Invocation / Session 隔离明确

`AgentClassTemplate` / `ToolClassTemplate` / `WorkflowFunctionTemplate` 是静态定义，
`FunctionInvocation` / `ScopeFrame` / `SessionInstance` 是运行事实。

这解决了一个常见混乱：

```text
同一个 agent 定义
  -> 可以创建多个独立 SessionInstance
  -> 每个 SessionInstance 有独立 payload / output / events / artifact bundle
```

因此 bug 可以定位到 template 还是某次 session，而不是混在一个长期 agent 状态里。

### 4. Control/Data 分离

ACC 明确区分：

- `ControlEdge`：谁依赖谁完成。
- `DataEdge`：哪个 artifact 从哪个 port 传到哪个 port。

这比“把上游输出塞进下游 prompt”更可控，也比纯共享 state 更容易审计。

### 5. Local-first / Hermetic 默认

默认测试不依赖：

- Codex login
- Claude credentials
- Cursor / Gemini / Hermes
- network
- Conductor installation

这说明 ACC 的核心语义不是靠外部服务撑起来的，而是本地可验证的 runtime contract。

### 6. GraphOps 把 LLM 自改系统关进控制面

ACC 允许 LLM 辅助改 callable/workflow，但边界是：

```text
proposal -> validation -> dry-run -> human approval -> apply
```

这保留了 Human Authority，避免 agent 直接自我改造 workflow。

## 与 Multica 对比

### Multica 解决的问题

Multica 更像 agent-aware project management：让人类和 coding agents 在一个 workspace 中协作。Agent 可以被分配 issue、被 `@mention`、发评论、创建 issue。

公开资料显示，Multica 的 server 管 workspace、issue、task queue；本机 daemon 轮询任务，并在本地启动 Claude Code、Codex、Cursor、Gemini 等 CLI。

来源：

- [Multica Docs](https://multica.ai/docs)
- [Multica Agents](https://multica.ai/docs/agents)
- [How Multica works](https://multica.ai/docs/how-multica-works)
- [Project Resources](https://multica.ai/docs/project-resources)
- [Multica GitHub](https://github.com/multica-ai/multica)

### Multica 的核心抽象

```text
Workspace
  -> Project / Issue
  -> Task
  -> Agent
  -> Runtime
  -> local daemon
```

它的核心不是 workflow DAG，而是“任务被谁领取、在哪个本地 runtime 上跑、如何向协作空间汇报”。

### Multica 的优势

1. 人机协作体验更完整：issue、comment、mention、workspace member。
2. Runtime 管理更产品化：本机 daemon 可以暴露哪些 agent runtime 可用。
3. 对 coding task 分发更自然：像给同事派 issue 一样给 agent 派任务。
4. 更适合团队协作场景。

### ACC 相对 Multica 的优势

ACC 更适合“确定性 workflow 执行”：

- 有明确 DAG。
- 有显式 `ControlEdge` / `DataEdge`。
- 有 artifact bundle。
- 有 node-level inbox/outbox。
- 有 session manifest。
- 有 Conductor JSON stdout contract。

简化判断：

```text
Multica 更像 agent task board。
ACC 更像 local agent workflow runtime。
```

如果目标是“让 agent 像同事一样处理 issue”，Multica 更强。
如果目标是“把多个外部 agent 节点变成可复现 pipeline”，ACC 更强。

## 与 Paperclip 对比

### Paperclip 解决的问题

Paperclip 的目标是把多个 AI agents 组织成一个“公司”：有 company、agent、role、goal、task、approval、budget、audit。

它更像 agent organization / governance platform，而不是轻量本地 workflow runtime。

来源：

- [Paperclip GitHub](https://github.com/paperclipai/paperclip)
- [Paperclip site](https://paperclip.ing/)
- [Paperclip docs](https://paperclip.inc/docs)
- [Architecture Overview](https://paperclip.inc/docs/start/architecture)
- [How Paperclip Agents Work](https://paperclip.inc/docs/guides/agent-developer/how-agents-work)
- [Approvals](https://paperclip.inc/docs/guides/board-operator/approvals)
- [Costs and Budgets](https://paperclip.inc/docs/guides/board-operator/costs-and-budgets)

### Paperclip 的核心抽象

```text
Company
  -> Agent
  -> Role / Manager
  -> Goal
  -> Task / Issue
  -> Heartbeat
  -> Approval
  -> Budget
  -> Audit log
```

Agent 不是 workflow node，而更像一个有职位、职责、预算和审批规则的员工。

### Paperclip 的优势

1. Governance 强：budget hard stop、approval gate、audit log。
2. 组织模型强：agent 可以有 role、manager、goal。
3. 生命周期强：heartbeat、pause、terminate、manual invoke。
4. 更适合长期运行的 agent workforce。

### ACC 相对 Paperclip 的优势

ACC 更简单、更本地、更 artifact-first：

- 不要求数据库作为核心依赖。
- 不引入 company/org chart 模型。
- 不把 agent 做成长生命周期员工。
- 重点是一次 workflow run 的可复现结果。

简化判断：

```text
Paperclip 管 agent 组织治理。
ACC 管 workflow 节点执行边界。
```

如果目标是“多个 agent 长期围绕目标运营”，Paperclip 更强。
如果目标是“把 agent 执行变成可审计 pipeline”，ACC 更强。

## 与 LangGraph 对比

### LangGraph 解决的问题

LangGraph 是 LangChain 生态中的低层 orchestration runtime，用来构建 long-running、stateful、多 actor 的 LLM 应用。

来源：

- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

### LangGraph 的核心抽象

```text
StateGraph
  -> State
  -> Node
  -> Edge / ConditionalEdge
  -> Checkpoint
  -> Thread
  -> Interrupt
```

它的一等对象是共享 state 和 checkpoint，不是 filesystem artifact bundle。

### LangGraph 的优势

1. 适合写 agent 内部控制流。
2. 支持循环、条件分支、interrupt、resume。
3. checkpoint / durable execution 成熟。
4. LangChain / LangSmith 生态完整。

### ACC 相对 LangGraph 的优势

ACC 不要求开发者把 agent 的内部控制流重写成 Python/TypeScript graph。

ACC 的节点可以是成熟外部 CLI agent：

```text
Codex CLI
Claude Code / SDK
Cursor CLI
Gemini CLI
generic CLI
```

ACC 只关心：

- 这个 agent 的输入是什么；
- 在哪个 workspace 跑；
- 权限是什么；
- 输出 schema 是什么；
- artifact 存在哪里；
- 下游怎么拿到产物。

简化判断：

```text
LangGraph 适合构建 agent brain。
ACC 适合编排 mature agent body。
```

## 与其他同类项目的定位

### Dify

来源：[Dify Docs](https://docs.dify.ai/en/guides/workspace/app)

Dify 更偏 AI app platform：工作流、RAG、应用发布、UI、模型配置、团队协作。它的目标是快速构建和运营 AI 应用。

ACC 不做应用平台，不做数据库优先 artifact backend，不做 SaaS。

### CrewAI

来源：[CrewAI Docs](https://docs.crewai.com/introduction)

CrewAI 更偏 role-based multi-agent framework：定义 agents、tasks、crew、process。它适合把多个 LLM agent 组织成协作任务。

ACC 不定义 agent 的 reasoning loop，也不把 agent 行为写成框架内对象；ACC 包装外部成熟 agent。

### AutoGen

来源：[AutoGen GitHub](https://github.com/microsoft/autogen)

AutoGen 更偏 multi-agent conversation/programming framework，强调多个 agent 之间的消息交互和工具调用。

ACC 不以多 agent 对话为核心，而以 workflow node、artifact 和 session 为核心。

### Conductor

来源：[Conductor Docs](https://docs.conductor-oss.org/)

Conductor 是通用 workflow orchestrator，强在企业级任务编排、状态机、worker、重试、可观测性。

ACC 与 Conductor 的关系不是替代，而是互补：

```text
ACC owns its local workflow/callable topology and execution evidence.
Conductor can be an external production orchestration/export target.
ACC owns callable/workflow execution boundaries.
External agents own reasoning/tool loop.
```

Conductor 可以调用：

```bash
uv run acc workflow run <workflow.accflow.json> --input <input.json> --run-dir <run_dir> --emit-json
```

ACC 保证 machine-readable flag 下 stdout 是单个 JSON object，方便 Conductor script step 消费。兼容
`acc run ... --emit-conductor-json` 的 stdout 合同仍应保持，但它不是 Core v2 workflow 的新主入口。

## 当前代码与文档的差距

### 1. 运行证据命名仍有历史漂移

部分历史 goal 文档仍写 `function_invocation_manifest.json`、`scope_frame_manifest.json`、
`workflow_run_manifest.json` 或 `workflow_summary.json`。当前 Core v2 runtime 实际写
`function_invocation.json`、`scope_frame.json`、`run_record.json` 和 `run_summary.json`。

这会影响 Debugger/Inspector/API 投影层：投影层应读取当前 runtime 事实，或显式兼容旧文件名，而不能只按历史 goal 文件名查找。

### 2. native external-agent Core v2 adapter 仍未完全成熟

Core v2 已经建立 class-template、scope、session、payload 和 result-store 边界，但默认验证主要依赖
hermetic fake/stub。真实 Codex/Claude/Cursor/Gemini 长流程接入应走 native Core v2 adapter，而不是恢复
旧 `CapsuleRunner`。

### 3. binding provenance 还偏轻

`agent_payload.json`、`runtime_payload.json`、`binding_manifest.json` 已经分离，但 `binding_manifest` 仍主要记录输入 key。后续如果要让 RunInspector 解释“这个字段来自哪个上游 port、selector 是什么、是否 required、如何 materialize”，需要增强 provenance。

### 4. GraphOps real apply 仍偏 MVP

GraphOps 的安全设计是对的：validate、dry-run、human approval。但真实 persistent apply 还不是完整产品级闭环。

这符合“安全优先”的阶段性选择。未来如果要让 agent 辅助修改 workflow，GraphOps 需要更完整的 semantic diff、backup/apply manifest、rollback 和 audit。

### 5. durable scheduler 不是当前事实

当前 Core v2 workflow 调度是 run-scoped、进程内、按拓扑 level 执行。Workbench 的
`WorkbenchRunManager` 是轻量 server-scoped execution handle manager，不是持久化分布式队列。

### 6. 历史术语仍会干扰读者

`run_clean_workflow_template`、`run-graph` endpoint、一些旧 plain-language 文档里的 `Capsule`、
`WorkflowTemplate`、`NodeSpec`、`EnvironmentFrame` 都有历史原因。判断是否当前 runtime 事实，要看代码是否消费
Core v2 `WorkflowFunctionTemplate` / `NodeInvocationSpec`，而不是看旧名字。

## 关键术语

### AgentClassTemplate / ToolClassTemplate

静态可复用 agent/tool class 定义。它描述一个 class 用什么 runtime/runner、默认 prompt、权限、端口和 artifact contract。

### WorkflowFunctionTemplate

ACC 的 canonical workflow function IR。它是保存下来的无状态函数体，不应该保存 run dir、session id、本机 workspace binding、历史输出或 agent memory。

### NodeInvocationSpec

workflow function 内的一次 call site。它通过 `CallableRef` 调用 agent class、tool class 或 child workflow function，并携带 invocation-scoped prompt/input/bindings。

### FunctionInvocation / ScopeFrame

一次 workflow function 调用及其运行 scope。`ScopeFrame` 拥有 cwd、inbox、outbox、artifact root、environment root 和 behavior snapshot evidence。

### SessionInstance

一个 agent/tool 节点的具体执行实例。它有独立 `session_instance_manifest.json`、`events.jsonl`、`output.json`、stdout/stderr 和 artifact bundle。

### ControlEdge

控制依赖。它说明哪个节点必须在另一个节点之后执行。

### DataEdge

数据依赖。它说明某个节点的 output port 如何物化到另一个节点的 input port。

### Inbox / Outbox

节点间 artifact 传输边界。上游写 outbox，下游读 inbox，中间由 scheduler/store 物化。

### ArtifactBundle

一次节点产物的稳定清单。它让下游、调试器、人类审计可以知道产物有哪些、来自哪个节点、hash/路径是什么。

### GraphOps

LLM 辅助修改 callable/workflow 的控制面。它的作用是把修改变成 patch、验证、dry-run 和人工审批，而不是让 LLM 直接改系统。

## 最终判断

ACC 的差异化不是“也能编排 agent”。这个方向上，市面上已经有很多项目。

ACC 真正有价值的地方是它选择了一个更窄、更硬的边界：

```text
local-first
artifact-first
session-isolated
workflow-function-based
scope-frame-scoped
explicit inbox/outbox
external mature-agent boundary
human-approved GraphOps
```

因此它最适合的场景是：

- 多个成熟 coding agent 组成 deterministic workflow；
- 每个节点需要独立 session 和 artifact；
- 产物要能被下游稳定消费；
- workflow 需要本地可复现；
- default tests 必须 hermetic；
- 需要和 Conductor / CI / script step 对接；
- LLM 可以辅助改 workflow，但不能默认自动应用危险变更。

不适合的场景是：

- 要完整团队协作看板：更像 Multica。
- 要 agent 公司治理、预算、org chart：更像 Paperclip。
- 要写复杂 agent 内部循环、interrupt、checkpoint state machine：更像 LangGraph。
- 要快速搭 AI 应用平台、RAG、发布 UI：更像 Dify。

ACC 的战略判断应该继续保持窄而硬：少做平台表层，多强化执行边界、artifact 合同、GraphOps 安全闭环和真实外部 agent runner 的权限隔离。
