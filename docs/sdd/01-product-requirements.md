# ACC Product Requirements

## 1. Purpose

本文定义 ACC 在 SDD 体系下的产品级需求。它回答 **ACC 是什么、为谁服务、用户要完成哪些端到端工作流、哪些事情不做、什么叫交付成功**。

本文只描述 what / why，不描述实现计划、任务拆分或重构步骤。实现设计应在后续 SDD 文档中展开。

本文受 [00-constitution.md](00-constitution.md) 约束。若本文与 constitution 冲突，以 constitution 为准。

## 2. Evidence Basis

本文基于以下代码和文档事实：

- `AGENTS.md`: 当前项目契约、Core v2 callable-only 架构、不变量、Workbench 规则。
- `README.md`: 产品定位、CLI/API/Workbench/GraphOps/测试入口。
- `docs/CURRENT_ARCHITECTURE.md`: definition/execution、control/data、template/runtime、human-governed editing 四个分离。
- `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`: ACC 的第一性原理问题定义。
- `docs/research/agent_orchestration_comparison/README.md`: 对比同类 agent orchestration 系统后形成的产品边界，尤其是 ACC 保持 human-controlled deterministic workflow 的定位。
- `acc/cli.py`: `callable`、`workflow`、`runs`、`graphops`、`template`、`storage`、`mcp` 等 CLI 表面。
- `acc/server/app.py` 和 `acc/server/routes/*`: FastAPI 产品表面，包括 `workflows`、`runs`、`callables`、`graphops`、`authoring`、`agent_sessions`、`interactions`、`decisions`、`artifacts`、`runner`。
- `web/src/api.ts`、`web/src/components/WorkflowViewer.tsx`、`web/src/stores/*`: Workbench graph-first UI、task/canvas/run projection、assistant authoring、GraphOps review、run evidence inspection。

## 3. Product Positioning

ACC 是一个 **local-first workflow runtime and Workbench**，用于把成熟外部 agent 或本地 tool 包装成可复用、可审计、可组合的 callable asset。

用大白话说，ACC 不试图自己变成一个新的“大脑”。它像一个本地工作流运行台：

- 用户把 Codex、Claude、Cursor、Gemini、自定义 CLI 或本地脚本包装成可调用资源。
- 用户把这些资源像函数一样接成 workflow。
- ACC 负责隔离每次运行、搬运输入输出、记录证据、展示结果、约束修改。
- 外部 agent 负责自己的推理和内部工具调用。
- 人负责定义流程、审批持久化修改、判断结果是否可接受。

产品一句话：

```text
ACC turns reusable agent/tool/workflow definitions into auditable local runtime invocations,
with explicit data movement and human-governed mutation.
```

## 4. First-Principles Product Problem

ACC 要解决的核心问题不是“怎么调用一个 agent”。调用 agent 本身只是 subprocess、API 或 MCP 适配问题。

真正困难的是：当多个成熟 agent/tool 被组合成可复用 workflow 时，系统必须同时保持以下边界清晰：

1. **定义不是执行**
   `AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate` 是可复用定义；一次真实运行是 `FunctionInvocation`、`ScopeFrame`、`SessionInstance` 和 run evidence。

2. **控制流不是数据流**
   控制边只说明谁先谁后；数据必须通过 ports、bindings、inbox、outbox、result store、artifact references 或 workflow-call bindings 显式移动。

3. **运行证据不是 UI 状态**
   Workbench 可以显示、筛选、选中、折叠、缓存，但运行事实来自 `runs/<run_id>/` 下的证据文件和投影 API。

4. **AI 帮助不是变更 authority**
   AI 可以生成 proposal，但持久化修改 workflow/callable 必须经过 validation、dry-run、人类 review 和 approval。

5. **local-first 不是临时开发模式**
   本地运行、本地 evidence、本地 API、hermetic tests 是产品底座。云同步、远程 runner、外部服务只能作为可选扩展。

如果这些边界不清晰，ACC 会退化成不可调试的脚本拼接器、UI 状态驱动的临时 demo，或绕过人审的 agent 自修改系统。

## 5. Target Users

### 5.1 Primary Users

**Agent workflow builder**

需要把多个已有 agent/tool 编排成稳定 workflow 的用户。关注点是：

- 能复用已有 callable。
- 能在画布上理解控制流和数据流。
- 能运行并检查每个节点的真实输入、输出、日志和 artifacts。
- 能把 workflow 保存成 canonical `.accflow.json`。

**AI-assisted engineer**

使用 ACC 辅助大型开发项目、代码审查、文档生成、迁移、分析任务的工程师。关注点是：

- 外部 agent 能在受控工作区执行。
- 运行结果可审计、可复盘、可比较。
- AI 修改建议不能直接污染持久化模板。
- 后续 AI 可以通过 spec 和 evidence 理解项目现状。

**Local tool integrator**

把本地命令、脚本、已有 CLI、特定 provider 接入 ACC 的开发者。关注点是：

- 有清晰的 callable contract。
- stdout/stderr、日志、产物、失败状态能被 ACC 收集。
- 默认测试不依赖真实外部 provider。

**Workbench operator**

主要通过 Web UI 使用 ACC 的用户。关注点是：

- 可以创建任务画布、拖拽资源、编辑输入、保存 workflow。
- 可以提交异步运行，不阻塞整个 UI。
- 可以同时查看多个 task/run。
- 可以从 run evidence 回到节点级详情。

### 5.2 Secondary Users

**ACC core developer**

维护 runtime、server、Workbench、GraphOps、storage、adapter 的开发者。关注点是：

- 需求和架构边界清晰。
- 不同模块的职责不互相污染。
- 测试和验收标准能防止架构回退。

**Automation / MCP consumer**

通过 CLI、MCP 或 HTTP API 调用 ACC 的自动化系统。关注点是：

- 机器可读输出稳定。
- API response 能追溯到 durable evidence。
- 错误和状态名可预测。

## 6. Product Scope

### 6.1 In Scope

ACC 当前产品范围包括：

- 管理 reusable callable assets：
  - `AgentClassTemplate`
  - `ToolClassTemplate`
  - `WorkflowFunctionTemplate`
- 用 graph-first Workbench 编排 workflow。
- 保存 canonical workflow 到 `workflows/<id>.accflow.json`。
- 从 legacy `*.graph.json` 显式迁移到 `.accflow.json`。
- 提交同步或异步 workflow run。
- 为每次 run 创建 isolated runtime evidence。
- 通过 API/UI/CLI 查看 run summary、events、node outputs、logs、artifacts。
- 通过 GraphOps 进行 human-governed 持久化修改。
- 通过 assistant/authoring surface 生成 canvas 或 callable 修改 proposal。
- 通过 CLI 和 MCP 暴露脚本化入口。
- 保持默认验证 hermetic。

### 6.2 Conditionally In Scope

以下能力属于产品扩展，但不能反向污染 Core v2 内核：

- local runner pairing / token / workspace alias。
- cloud sync 或远程控制面投影。
- 真实 Codex/Claude/Cursor/Gemini/Hermes provider smoke test。
- 更高级 supervisor 动态调度。
- 多机器或分布式 worker。

这些能力必须保持 opt-in，不能成为默认开发、默认测试或 Core v2 run 的前置条件。

### 6.3 Out of Scope

ACC 明确不做：

- 不实现新的自定义 LLM reasoning/tool loop。
- 不把外部 agent 内部 reasoning 接管到 ACC。
- 不默认引入数据库、云后端、Kubernetes、SaaS control plane。
- 不把 Workbench local state 当作 runtime truth。
- 不让 LLM 直接修改 durable workflow/callable assets。
- 不把 legacy runtime graph 恢复成 active product runtime。
- 不把 `ControlEdge` 当作隐式数据权限。
- 不保证外部 agent 本身的回答质量、推理正确性或 provider 可用性。

## 7. Product Concepts

### 7.1 Callable Asset

Callable asset 是 ACC 可复用的最小行为资产。它可以是 agent class、tool class，也可以是 workflow function。

需求含义：

- 用户应能发现、查看、创建、更新、删除或引用 callable asset。
- callable asset 应描述可复用行为，而不是保存某次运行的临时状态。
- Workbench task node 引用 callable asset，但 node 自己只配置 invocation-scoped 输入。

### 7.2 Workflow Function

Workflow function 是可复用的 workflow body。它不是一次运行，也不是 UI 画布截图。

需求含义：

- workflow 必须有稳定 id、nodes、edges、ports 和 callable references。
- workflow 可以被另一个 workflow 作为 callable 调用。
- workflow 保存格式以 `.accflow.json` 为 canonical source。

### 7.3 Invocation

Invocation 是一次真实调用。一次 workflow run 会生成 `FunctionInvocation`，节点执行会生成 `SessionInstance` 或 child `FunctionInvocation`。

需求含义：

- 每次 run 必须能定位到自己的 run id、scope、节点证据和终态。
- 多次运行同一个 workflow 不得污染模板。
- 多个 Workbench task/run 不得共享一个全局运行状态。

### 7.4 Evidence

Evidence 是运行事实，包括 summaries、events、manifests、node inputs/outputs、logs、artifacts、control ledger projections。

需求含义：

- UI 和 API 只能投影 evidence，不能凭空制造 durable execution facts。
- 用户应能从 run summary 追到节点级输入、输出、日志、artifact。
- 失败路径也必须留下可检查证据。

### 7.5 GraphOps Proposal

GraphOps proposal 是对 workflow/callable durable assets 的受控修改提案。

需求含义：

- AI 生成的修改必须先作为 proposal 存在。
- proposal 应可 validate、dry-run、review、approve、apply 或 reject。
- destructive apply 必须显式 human approval。

## 8. End-to-End User Workflows

### WF-1: Discover Reusable Assets

用户需要查看当前项目中有哪些可复用 agent、tool、workflow。

典型入口：

- CLI: `acc callable list`、`acc callables list`、`acc workflows list`
- API: `GET /api/callables`、`GET /api/workflows`
- Workbench: resource rail / callable browser

成功结果：

- 用户能看到 callable id、kind、version、description、runtime/provider、ports、artifact contract。
- 用户能区分 class-level template 和 task-level invocation。
- 查看的资源不包含上一次运行的临时状态。

### WF-2: Define Or Update A Callable Asset

用户需要创建或修改一个 reusable agent/tool template。

典型入口：

- API: `POST /api/callables/agents`
- API: `PUT /api/callables/agents/{callable_id}`
- Workbench assistant temporary resource draft
- GraphOps proposal

成功结果：

- 新 callable 能被 registry 发现。
- callable contract 能被 workflow node 引用。
- class-level prompt、permissions、ports 和 artifact contract 可检查。
- 权限升级或 destructive change 进入 review/approval 路径。

### WF-3: Compose A Workflow In Workbench

用户需要在画布上把 callable 组合成 workflow。

典型入口：

- Workbench graph canvas
- Resource rail drag/drop
- Node inspector
- Edge mode: control / data

成功结果：

- 用户能创建 nodes、control edges、data edges、ports、workflow containers。
- 控制依赖和数据绑定在 UI 上可区分。
- task canvas 能保存 authoring state。
- 保存时生成 canonical `.accflow.json`，而不是 runtime evidence。
- 无效 workflow 在保存或运行前能被明确拒绝。

### WF-4: Save And Validate Workflow

用户需要把当前 workflow 作为 reusable template 持久化。

典型入口：

- API: `POST /api/workflows`
- API: `PUT /api/workflows/{workflow_id}`
- API: `POST /api/workflows/{workflow_id}/validate`
- CLI: `acc workflow validate`
- CLI: `acc workflow normalize`

成功结果：

- workflow 路径限制在 allowed workflows directory。
- 保存格式为 `.accflow.json`。
- 保存前后都能 validation。
- legacy `*.graph.json` 只能通过 explicit import/normalize 路径迁移。
- template 中不写入 `run_id`、logs、outputs、conversation memory。

### WF-5: Run Workflow

用户需要执行一个 workflow，并得到 run id 和后续可检查证据。

典型入口：

- CLI: `acc workflow run <workflow.accflow.json> --run-dir ... --emit-json`
- API: `POST /api/workflows/{workflow_id}/run`
- API: `POST /api/workflows/run-graph`
- API: `POST /api/workflows/run-graph/submit`
- Workbench: async submit

成功结果：

- 每次 run 生成独立 run id / run dir。
- run 使用 `FunctionInvocation`、`ScopeFrame`、`SessionInstance` 语义。
- run 能处理 input payload、workspace binding、binding ref 或 workspace alias。
- run 的 stdout/stderr/logs 不污染机器可读 JSON。
- terminal status 使用 canonical names。
- cancel 请求能进入明确状态，而不是丢失。

### WF-6: Inspect Evidence

用户需要从运行结果追踪到真实输入、输出、日志、events 和 artifacts。

典型入口：

- API: `GET /api/runs/{run_id}`
- API: `GET /api/runs/{run_id}/events`
- API: `GET /api/runs/{run_id}/nodes/{node_id}`
- API: `GET /api/runs/{run_id}/nodes/{node_id}/artifacts`
- API: `GET /api/artifacts/read?path=...`
- API: `GET /api/runs/{run_id}/stream`
- Workbench run dock / evidence dock / inspector
- CLI: `acc runs show`、`acc workflow inspect`、`acc workflow events`

成功结果：

- 用户能看到 run summary。
- 用户能查看节点 input/output、stdout/stderr、events、artifact bundle。
- nested workflow evidence 能被投影到父 workflow 视图。
- artifact preview 做 path safety 和 secret-like path 过滤。
- UI 切换 task 不会清空另一个 task 的 run evidence。

### WF-7: Ask Assistant To Help Author

用户需要让 AI 辅助修改 canvas、节点、输入、ports 或生成 temporary resource。

典型入口：

- API: `POST /api/authoring/sessions`
- API: `POST /api/authoring/sessions/{session_id}/messages`
- API: `POST /api/agent-sessions`
- Workbench assistant drawer / bottom dock

成功结果：

- assistant 能基于 canvas snapshot、selection、catalog 提出 proposal。
- proposal 可 validation / dry-run。
- 临时资源在用户确认前不成为 durable callable。
- assistant 输出可以被用户 apply 到当前 canvas，但 durable asset mutation 必须走 GraphOps 或等效治理路径。

### WF-8: Govern Persistent Changes With GraphOps

用户需要把 AI 或人提出的 workflow/callable 修改变成可审查、可批准、可应用的 durable change。

典型入口：

- API: `POST /api/graphops/proposals`
- API: `POST /api/graphops/proposals/{proposal_id}/validate`
- API: `POST /api/graphops/proposals/{proposal_id}/dry-run`
- API: `POST /api/graphops/proposals/{proposal_id}/approve`
- API: `POST /api/graphops/proposals/{proposal_id}/apply`
- API: `POST /api/graphops/proposals/{proposal_id}/reject`
- CLI: `acc graphops ...`
- Workbench GraphOps review UI / decisions inbox

成功结果：

- proposal 有目标路径、base hash、dry-run digest、approval 记录。
- 未经 approval 的 destructive apply 被拒绝。
- apply 后能追溯是哪个 proposal、谁批准、改了哪些 assets。
- legacy dry-run-only GraphOps patch 与新 proposal path 边界清楚。

### WF-9: Automate Through CLI / MCP / API

自动化系统或外部 agent 需要通过稳定接口使用 ACC。

典型入口：

- CLI: `acc workflow run`、`acc callable list`、`acc runs show`、`acc template export/import`
- MCP: `acc mcp serve`
- HTTP API: `/api/*`

成功结果：

- JSON 输出可被脚本稳定解析。
- API response 与 durable evidence 或 explicit app service 对应。
- 错误返回能说明是 validation、path safety、provider capability、not found 还是 runtime failure。

### WF-10: Manage Local Runner Extension

用户可选择通过 local runner 表面管理 workspace alias、capabilities、jobs 和 projections。

典型入口：

- API: `GET /api/runner/health`
- API: `GET /api/runner/capabilities`
- API: `GET /api/runner/workspaces`
- API: `POST /api/runner/jobs`
- API: `GET /api/runner/runs/{run_id}/projection`

成功结果：

- runner 能暴露本地能力，但不能成为 Core v2 默认运行前置条件。
- token/security middleware 保护 local-debug 或 runner-sensitive surface。
- runner job 最终仍映射到 ACC run evidence，而不是独立事实系统。

## 9. Functional Requirements

### PR-1: Callable Asset Management

- **PR-1.1** 用户必须能列出所有可用 callable assets。
- **PR-1.2** 用户必须能查看单个 callable 的 kind、runtime、version、ports、permissions、artifact contract 和 metadata。
- **PR-1.3** 用户必须能创建或更新 agent callable。
- **PR-1.4** 删除或覆盖 callable 必须有明确错误、冲突和治理边界。
- **PR-1.5** callable template 不得保存 run-scoped 状态。

Priority: P0

验收口径：

- `GET /api/callables` 和 `acc callable list` 可返回一致的资源视图。
- `GET /api/callables/{callable_id}` 和 `acc callable show` 可检查 template contract。
- 新增/更新 callable 后可被 Workbench palette 或 workflow compiler 引用。

### PR-2: Workflow Authoring And Persistence

- **PR-2.1** Workbench 必须以 graph canvas 作为主要 workflow authoring surface。
- **PR-2.2** 用户必须能创建、编辑、删除或连接 workflow nodes。
- **PR-2.3** UI 必须区分 control edges 和 data edges。
- **PR-2.4** workflow 保存必须生成 canonical `.accflow.json`。
- **PR-2.5** 保存前必须进行 workflow validation。
- **PR-2.6** workflow template 不得持久化 runtime evidence。

Priority: P0

验收口径：

- `POST /api/workflows` / `PUT /api/workflows/{workflow_id}` 只接受合法 `.accflow.json` 目标路径。
- `acc workflow validate` 能在 CLI 中验证 canonical workflow。
- Workbench 保存后的 workflow 能再次加载并运行。

### PR-3: Workflow Execution

- **PR-3.1** 用户必须能通过 CLI、API 和 Workbench 执行 workflow。
- **PR-3.2** Workbench 默认应使用 async submit path。
- **PR-3.3** 每次 run 必须有独立 `run_id` 和 run evidence。
- **PR-3.4** runtime 必须通过 explicit ports/bindings/materialization 搬运数据。
- **PR-3.5** run terminal status 必须使用 canonical names。
- **PR-3.6** cancel、failed、crashed 等失败路径必须可观察。

Priority: P0

验收口径：

- `POST /api/workflows/run-graph/submit` 返回可追踪 run handle。
- `GET /api/runs/{run_id}` 能读取 run summary。
- `GET /api/runs/{run_id}/events` 能读取 run events。
- CLI `--emit-json` 输出是单个 JSON object。

### PR-4: Evidence Inspection

- **PR-4.1** 用户必须能从 run summary 进入 node-level evidence。
- **PR-4.2** 用户必须能查看 node input、output、stdout、stderr、events。
- **PR-4.3** 用户必须能查看 artifact list 和安全 preview。
- **PR-4.4** Workbench evidence dock 必须按 selected task/run 显示对应 projection。
- **PR-4.5** nested workflow evidence 必须能被投影，而不能丢失在子目录中。

Priority: P0

验收口径：

- `GET /api/runs/{run_id}/nodes/{node_id}` 返回节点投影。
- `GET /api/runs/{run_id}/nodes/{node_id}/artifacts` 返回 artifact references。
- `GET /api/runs/{run_id}/stream` 可提供 live projection。
- Workbench 切换 task/run 后显示的 evidence 与 selected run 匹配。

### PR-5: Human-Governed Mutation

- **PR-5.1** AI 或 assistant 产生的 durable change 必须先成为 proposal。
- **PR-5.2** proposal 必须支持 validate。
- **PR-5.3** proposal 必须支持 dry-run。
- **PR-5.4** destructive apply 必须要求 human approval。
- **PR-5.5** approval 必须绑定 target paths、base hashes 和 dry-run digest。
- **PR-5.6** rejected proposal 不得修改 durable assets。

Priority: P0

验收口径：

- `POST /api/graphops/proposals/{proposal_id}/apply` 在未满足 approval 条件时失败。
- decisions inbox 能展示需要人审的 run failures / interactions / GraphOps proposals。
- Workbench GraphOps review 不直接绕过 validation 和 dry-run。

### PR-6: Assistant Authoring

- **PR-6.1** 用户必须能基于当前 canvas 和 selection 启动 authoring session。
- **PR-6.2** assistant 必须接收 canvas snapshot，而不是读取不受控 UI 内存。
- **PR-6.3** assistant proposal 必须可 validation。
- **PR-6.4** assistant 可生成 temporary resource，但 durable publish 必须受治理。
- **PR-6.5** assistant turn events 必须能 stream 或轮询展示。

Priority: P1

验收口径：

- `POST /api/authoring/sessions` 创建 session。
- `POST /api/authoring/proposals/validate` 返回 proposal validation。
- Workbench assistant drawer 能展示 proposal、required actions、GraphOps review。

### PR-7: Workbench Multi-Task And Multi-Run

- **PR-7.1** Workbench 必须支持多个 task。
- **PR-7.2** 每个 task 可有自己的 canvas、active run、latest run。
- **PR-7.3** UI 不得用全局 `isRunning` 表示所有任务运行状态。
- **PR-7.4** run projections 必须按 `run_id + task_id` 区分。
- **PR-7.5** 切换 task 不得清空其他 task 的 run evidence。

Priority: P0

验收口径：

- task rail / overview 能显示各 task 的 run pointer。
- run store 以 run id 管理 projections/logs。
- 同时存在多个 run 时 UI 能选择并展示正确 evidence。

### PR-8: CLI And Automation Contract

- **PR-8.1** CLI 必须覆盖 callable discovery、workflow validation/run、run inspection、GraphOps、template bundle、storage inspection 等核心能力。
- **PR-8.2** 机器可读输出必须保持 stdout 单 JSON object。
- **PR-8.3** 日志、warnings、progress 必须进入 stderr 或 evidence files。
- **PR-8.4** legacy runtime 命令不得悄悄执行旧架构。
- **PR-8.5** CLI 错误应明确说明迁移或替代路径。

Priority: P0

验收口径：

- `acc workflow run ... --emit-json` 可被 JSON parser 直接解析。
- `acc run <legacy-ref>` 不执行 legacy runtime，并提示使用 `acc workflow run <workflow.accflow.json>`。
- `acc workflow import-graph` 只输出 `.accflow.json`。

### PR-9: Local-First Operation

- **PR-9.1** Core workflows 必须能在本地项目目录中运行。
- **PR-9.2** 默认测试不得依赖网络、真实外部 provider、付费服务或云状态。
- **PR-9.3** runtime evidence 必须写入本地可检查文件。
- **PR-9.4** artifact 和 path API 必须做 path safety。
- **PR-9.5** cloud/runner 扩展不得成为默认前置条件。

Priority: P0

验收口径：

- backend hermetic tests 可在无 provider credential 的环境运行。
- `runs/<run_id>/` 下可检查 summary/events/node evidence。
- artifact preview 不允许 path traversal 或 secret-like path 泄漏。

### PR-10: Optional Runner / Cloud Extension

- **PR-10.1** runner surface 可暴露 health、capabilities、providers、workspaces、jobs、run projection。
- **PR-10.2** runner job 必须最终映射到 ACC run evidence。
- **PR-10.3** runner-sensitive endpoint 必须受 local token/security policy 保护。
- **PR-10.4** cloud sync 只能上传 projection 或受控 artifact，不得泄漏本地 secret/path。
- **PR-10.5** runner/cloud failure 不得破坏 local Core v2 run。

Priority: P2

验收口径：

- `/api/runner/*` 能表达能力和拒绝原因。
- 未配置 runner 时 Core v2 local workflow 仍可运行。
- runner projection 与 `/api/runs/{run_id}` 的 evidence 边界一致。

## 10. Quality Requirements

### QR-1: Auditability

每次 workflow run 必须留下足够 evidence，使用户能回答：

- 运行的是哪个 workflow。
- 输入是什么。
- 哪些节点执行了。
- 每个节点真实收到什么 payload。
- 每个节点输出了什么。
- 哪些 artifact 被生成。
- 失败发生在哪里。
- 人类做过哪些 approval/decision。

Priority: P0

### QR-2: Deterministic Boundaries

ACC 不承诺外部 agent 的输出确定性，但必须承诺边界确定性：

- workflow definition 可复用。
- runtime scope 独立。
- 输入输出路径可追踪。
- status transition 可解释。
- evidence 文件职责清楚。

Priority: P0

### QR-3: Safety

产品必须默认防止：

- template/runtime state 混写。
- path traversal。
- secret-like artifact preview。
- 未审批 GraphOps apply。
- 通过 UI 状态伪造 run truth。
- 通过 legacy asset 绕开 Core v2。

Priority: P0

### QR-4: Explainability For Future AI Development

ACC 的 spec、docs、evidence 和 code surface 必须足够清晰，使后续 AI agent 能理解：

- 当前产品边界。
- callable/runtime/evidence 的术语。
- 哪些路径是 source of truth。
- 哪些修改需要 GraphOps/human gate。
- 哪些测试代表验收。

Priority: P0

### QR-5: Incremental Evolution

ACC 必须允许逐步演进 Workbench、runner、cloud sync、supervisor，但新增能力不能破坏 Core v2 稳定不变量。

Priority: P1

## 11. Priority Model

| Priority | Meaning | Product Rule |
| --- | --- | --- |
| P0 | Core product contract | 不满足则 ACC 不能被视为可交付 Core v2 产品。 |
| P1 | Important workflow quality | 不满足会显著降低 Workbench/authoring 可用性，但不应阻断 Core runtime。 |
| P2 | Optional product extension | 可作为后续产品化能力，不得成为 Core v2 前置条件。 |

当前 P0 主线：

1. callable discovery and template contract。
2. workflow authoring, save, validate。
3. local workflow execution。
4. run evidence inspection。
5. GraphOps human-governed mutation。
6. Workbench multi-task/multi-run projection。
7. CLI/API machine-readable integration。
8. hermetic verification。

## 12. Acceptance Criteria

ACC 作为 SDD 驱动的可交付产品，至少满足以下验收口径。

### AC-1: Product Identity Is Clear

给定本文和 constitution，后续开发者或 AI agent 应能明确判断：

- ACC 是 local-first callable workflow runtime and Workbench。
- ACC 不拥有 custom LLM reasoning loop。
- ACC 的核心价值在 execution boundary、evidence、explicit data movement、human governance。

### AC-2: Core User Workflows Are Supported

用户应能完成：

1. 发现 callable。
2. 创建或编辑 workflow。
3. 保存 canonical `.accflow.json`。
4. 运行 workflow。
5. 查看 run evidence。
6. 通过 assistant 生成 proposal。
7. 通过 GraphOps 审批并应用 durable change。

### AC-3: Runtime Evidence Is Inspectable

任意已提交 run 应能回答：

- `run_id` 是什么。
- 当前 status 是什么。
- run summary 在哪里。
- events 在哪里。
- 每个 node 的 input/output/log/artifact 在哪里。
- nested workflow 是否有可投影 evidence。

### AC-4: Workbench Does Not Own Runtime Truth

Workbench 可以保存 task/canvas authoring state，但不得把以下内容写成 template semantics：

- terminal status。
- prior output。
- run logs。
- `run_id` as workflow meaning。
- agent memory。
- artifacts。

### AC-5: GraphOps Protects Durable Mutation

任何 AI 生成的 durable workflow/callable 修改都必须可追溯到：

- proposal。
- validation result。
- dry-run evidence。
- human approval。
- apply manifest 或 rejection reason。

### AC-6: Local-First Defaults Hold

默认开发和测试不需要：

- cloud backend。
- database。
- Kubernetes。
- paid provider。
- network。
- real Codex/Claude/Cursor/Gemini/Hermes smoke run。

### AC-7: Integration Contracts Hold

CLI/API/MCP consumers 应能依赖：

- JSON emit stdout 是单一 JSON object。
- logs 不污染 machine-readable output。
- API projections 对应 durable evidence 或 explicit app services。
- status names 不被 UI/API 随意发明。

## 13. Open Product Questions

以下问题不阻塞本文作为产品需求基线，但需要在后续 SDD 文档或 amendment 中明确：

1. `runner` / `cloud_sync` 是否作为正式产品交付范围，还是保持 P2 extension。
2. supervisor 动态调度应如何在不破坏 human-governed deterministic workflow 的前提下演进。
3. Workbench 中 temporary resources 到 durable callable 的 publish 流程是否全部归入 GraphOps。
4. legacy YAML workflow 在 UI/API 中的读取兼容保留多久。
5. artifact preview 的 secret-like path 规则是否需要扩展到内容级 redaction。

## 14. Non-Goals Recap

本文明确不要求 ACC：

- 成为 Dify/LangGraph/Paperclip 风格的 agent-native autonomous company。
- 成为数据库优先的云端任务平台。
- 复刻外部 agent 的内部 memory/reasoning。
- 自动判断外部 agent 输出是否正确。
- 默认并行扩展到多机调度。
- 用 UI store 替代 run evidence。
- 用 AI proposal 替代 human approval。

ACC 的产品成功标准不是“让 AI 自动做一切”，而是让可复用 agent/tool/workflow 在本地、可审计、可验证、人类可治理的边界内完成复杂工程工作。
