# ACC 工作流编排深度研究报告

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
5. LLM 自改 workflow 风险高：如果 agent 可以直接改 workflow/capsule，就可能删除 human gate、放开危险权限或破坏 schema。

ACC 的问题定义不是“让 LLM 更聪明”，而是：

```text
成熟 agent 负责推理和工具循环。
ACC 负责执行边界、artifact、session、workspace、port 和权限。
Workflow/Conductor 负责确定性拓扑。
Human Authority 负责最终批准 workflow/capsule 变更。
```

## 当前架构如何解决

当前真实代码已经形成一条主链：

```text
acc.cli
  -> acc.app.WorkflowAppService
  -> acc.engine
  -> acc.store.FileSystemWorkflowStore
  -> acc.runtime
  -> acc.store artifact/inbox/outbox/event persistence
```

### 1. Domain：只表达概念和不变量

关键代码：

- `acc/domain.py`

它定义：

- `WorkflowTemplate`：可保存、可复用、无状态的 workflow 模板。
- `NodeSpec`：workflow 中的一个节点，可以是 `agent`、`tool` 或 `workflow`。
- `ControlEdge`：控制依赖，决定谁先跑。
- `DataEdge`：数据依赖，决定 artifact 从哪个 output port 到哪个 input port。
- `EnvironmentFrame`：一次 workflow 运行绑定出来的运行环境。
- `PermissionProfile`：节点运行权限，如 workspace 写权限、network、shell、env policy、timeout。
- `ArtifactBundle`：节点产物的稳定描述。

关键点：`domain` 不做文件 IO、不跑 subprocess、不知道 CLI/UI。这让核心概念可以独立验证。

### 2. Engine：只管 workflow 语义

关键代码：

- `acc/engine/__init__.py`

它负责：

- 解析 `.accflow.json` 为 `WorkflowTemplate`。
- 校验 node id、port、control edge、data edge。
- 拒绝 template 内保存本机绝对 workspace path。
- 校验权限：默认拒绝 `dangerous`、hermetic 模式拒绝 network、拒绝 full env inheritance。
- 计算 `topological_levels()`，把 DAG 拆成可并行执行层。
- 校验 `DataEdge` 的 source 必须是 target 的 control ancestor。

关键机制：

```text
ControlEdge = 执行顺序
DataEdge    = artifact 传输
```

这避免了一个常见错误：下游节点读取一个并不在控制路径上的上游产物。

### 3. Store：只管落盘和 artifact 边界

关键代码：

- `acc/store/__init__.py`

它负责：

- 创建 `run_dir`
- 创建 `environment_manifest.json`
- 写 `workflow_events.jsonl`
- 写每个节点的 `events.jsonl`
- 创建 `nodes/<node_id>/input.json`
- 写 `nodes/<node_id>/output.json`
- 写 `artifact_bundle.json`
- 管理 `inbox/` 和 `outbox/`
- 做 path traversal 防护

最关键的是 `materialize_clean_inbox_edge()`：

```text
upstream node outbox
  -> store materialize
  -> downstream node inbox
```

上游不能直接写下游 workspace。数据传输只能通过 store 管理的 port/inbox/outbox 合同。

### 4. Runtime：只管节点执行策略

关键代码：

- `acc/runtime/__init__.py`

它负责：

- retry
- timeout
- workspace write lock
- fake/tool/agent node 执行
- env whitelist 构造
- read-only / writes-run-only / writes-workspace 权限校验

当前 clean runtime 主要用于 hermetic fake/tool/agent 路径。真实 Codex/Claude capsule 仍通过 `acc.runner.CapsuleRunner` 和 adapter 层执行。

### 5. App：串起 engine / store / runtime

关键代码：

- `acc/app/__init__.py`

核心函数是 `run_workflow_template_instance()`。

执行流程：

```text
1. validate workflow input
2. prepare run dir
3. create EnvironmentFrame
4. engine.topological_levels()
5. 按 level 调度节点
6. materialize inbox
7. build node input
8. runtime 执行 node
9. store 写 output/artifacts/outbox
10. publish workflow outputs
11. 写 workflow summary / manifest / events
```

同一个 level 内用 semaphore 控制并发，因此 ACC 支持 DAG level parallel execution，但仍保持确定性拓扑。

### 6. CapsuleRunner：包装成熟外部 agent

关键代码：

- `acc/runner.py`
- `acc/adapters/generic_cli.py`
- `acc/adapters/codex_cli.py`
- `acc/adapters/claude_sdk.py`

`CapsuleRunner` 做的是 session 边界：

```text
capsule.yaml
  -> input validation
  -> session_manifest.json
  -> resolved_prompt.md
  -> workspace preparation
  -> adapter execution
  -> output.json validation
  -> artifact validation
  -> conductor_output.json
```

当 `--emit-conductor-json` 启用时，stdout 必须只有一个 JSON object。日志只能进入 stderr 或文件。这是 ACC 与 Conductor / CI / workflow engine 对接的关键合同。

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

- `input.json`
- `resolved_prompt.md`
- `output.json`
- `artifacts/`
- `artifact_bundle.json`
- `events.jsonl`
- `session_manifest.json`
- `workflow_run_manifest.json`

这让 ACC 更适合工程场景：调试、复现、批处理、CI、审计、Conductor script step。

### 3. Session 隔离明确

`Capsule Template` 是静态定义，`Session` 是一次运行实例。

这解决了一个常见混乱：

```text
同一个 agent 定义
  -> 可以创建多个独立 session
  -> 每个 session 有独立 run dir / artifacts / events / manifest
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

ACC 允许 LLM 辅助改 workflow/capsule，但边界是：

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
Conductor owns topology.
ACC owns capsule execution boundary.
External agents own reasoning/tool loop.
```

Conductor 可以调用：

```bash
uv run acc run <capsule_id> --input <input.json> --run-dir <run_dir> --emit-conductor-json
```

ACC 保证 stdout 是单个 JSON object，方便 Conductor script step 消费。

## 当前代码与文档的差距

### 1. `domain` 仍使用 `Path`

文档倾向 `domain` 使用 JSON-compatible primitive 或纯 value object。当前 `acc/domain.py` 中 `source_path`、`workspace_root` 等字段仍是 `Path`。

这不是 IO 违规，但比理想 domain 更贴近 Python 本地实现。未来如果要更强 portability，可以引入 path value wrapper 或 string-based domain model。

### 2. Engine 还不是完整状态机

文档里理想 engine 会有更完整的 execution plan / state transition API。当前 engine 主要负责 parse、validate、topological sort、failure policy helper。

真实执行循环在 `acc/app/__init__.py` 中。这是可接受的，但如果以后要做 debugger、resume、partial rerun，更明确的 engine state transition API 会更稳。

### 3. `RuntimeResult` 尚未成为统一返回类型

`acc/domain.py` 有 `RuntimeResult`，`acc/ports` 也定义了 `NodeRunnerProtocol`。但当前 `acc/runtime` 真实执行返回的是 `(dict, attempts)`。

这说明 ports/domain 已经铺了方向，但实现还没有完全收敛到 protocol-first。

### 4. env whitelist 未覆盖所有路径

`acc/runtime.build_allowed_env()` 已经拒绝 full env inheritance。但 `acc/runner.py` 某些 workflow capsule 路径仍有 `os.environ.copy()` 语义。

这和“默认不继承完整 host env”的理想合同存在差距。真实外部 agent 接入前，这一块应继续收紧。

### 5. CLI 还不够薄

`acc.cli` 已经把 workflow run/validate 委托给 `WorkflowAppService`，但仍直接连接 debugger、graphops、environment、control_plane 等模块。

它已经比早期更清晰，但还没有完全达到“CLI 只做参数解析和展示”的理想状态。

### 6. GraphOps real apply 仍偏 MVP

GraphOps 的安全设计是对的：validate、dry-run、human approval。但真实 destructive apply 还不是完整产品级闭环。

这符合“安全优先”的阶段性选择，但如果未来要让 agent 辅助修改 workflow，GraphOps 需要更完整的 semantic validation、diff preview、rollback 和 audit。

## 关键术语

### Capsule Template

静态可复用 agent 定义。它描述一个 agent 节点是谁、用什么 runtime、输入输出 schema 是什么、权限是什么。

### Session

一次具体执行实例。它有独立 `run_dir`、`session_manifest.json`、`events.jsonl`、`output.json` 和 artifacts。

### WorkflowTemplate

ACC 的 canonical workflow IR。它是保存下来的无状态 DAG 模板，不应该保存本机 workspace path。

### EnvironmentFrame

workflow 运行时绑定出来的环境。它把 workflow template 绑定到某个 workspace、inbox/outbox/artifact root。

### ControlEdge

控制依赖。它说明哪个节点必须在另一个节点之后执行。

### DataEdge

数据依赖。它说明某个节点的 output port 如何物化到另一个节点的 input port。

### Inbox / Outbox

节点间 artifact 传输边界。上游写 outbox，下游读 inbox，中间由 scheduler/store 物化。

### ArtifactBundle

一次节点产物的稳定清单。它让下游、调试器、人类审计可以知道产物有哪些、来自哪个节点、hash/路径是什么。

### GraphOps

LLM 辅助修改 workflow/capsule 的控制面。它的作用是把修改变成 patch、验证、dry-run 和人工审批，而不是让 LLM 直接改系统。

## 最终判断

ACC 的差异化不是“也能编排 agent”。这个方向上，市面上已经有很多项目。

ACC 真正有价值的地方是它选择了一个更窄、更硬的边界：

```text
local-first
artifact-first
session-isolated
workflow-template-based
environment-scoped
explicit inbox/outbox
external mature-agent wrapper
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
