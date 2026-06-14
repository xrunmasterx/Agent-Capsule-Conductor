# ACC SDD 05: Interfaces And Workbench

## 1. Purpose

本文件定义 ACC 面向人、脚本、AI 工具和本地 runner 的交互面契约。它回答四个问题：

1. HTTP API、CLI、MCP、Workbench 分别解决什么问题。
2. 这些入口如何触发 workflow run、读取 run evidence、发起 GraphOps proposal、管理 Workbench task。
3. 哪些状态只是 UI projection/editor convenience，哪些状态才是 durable truth。
4. 错误、事件流、安全边界和后续开发验收标准是什么。

核心结论：**ACC 的交互面不是事实源，run evidence 和持久化 template 文件才是事实源。**

更直白地说，Workbench 可以编辑 canvas、显示 overlay、订阅 live stream、保存 task snapshot；HTTP API 可以触发运行和返回 projection；CLI/MCP 可以暴露自动化入口。但这些交互面都不能替代以下 durable facts：

- `workflows/*.accflow.json`
- `callables/**`
- `runs/<run_id>/run_summary.json`
- `runs/<run_id>/run_record.json`
- `runs/<run_id>/events.jsonl`
- `runs/<run_id>/nodes/<node_id>/**`
- `runs/<run_id>/result_store/**`
- GraphOps proposal / dry-run / approval / apply evidence

Workbench 的 `activeRunId`、`latestRunId`、`runsById`、live log buffer、canvas selection、assistant pending turn，都只是用户体验层的投影和便捷索引。它们可以丢失、刷新、重建；不能当作 runtime truth。

## 2. Ownership

### 2.1 HTTP API

HTTP API 由 `acc/server/app.py` 组装，统一挂载到 `/api` 前缀。当前 `create_app()` 注册这些 route group：

- `health`
- `agent_sessions`
- `authoring`
- `callables`
- `runs`
- `interactions`
- `runner`
- `artifacts`
- `workbench`
- `workflows`
- `debugger`
- `graphops`
- `decisions`

HTTP API 的职责是：

- 把 Workbench、外部客户端、本地 runner 请求转成 app service 调用。
- 对路径、run id、workflow path、artifact path 做安全校验。
- 返回 stable JSON projection。
- 对长时间运行的 run / agent turn 提供 SSE stream。
- 把 domain / app 层错误映射成 HTTP status code。

HTTP API 不拥有 runtime truth。`acc/server/run_manager.py` 明确写明：`WorkbenchRunManager` 只拥有 process-local execution handles 和 bounded FIFO queue，durable facts 是 `runs/<run_id>` 下的文件。

### 2.2 CLI

CLI 由 `acc/cli.py` 提供，基于 `typer`。它是脚本和本地开发入口，主要命令组包括：

- `acc server`
- `acc workflow validate`
- `acc workflow normalize`
- `acc workflow import-graph`
- `acc workflow run`
- `acc workflows list/show`
- `acc runs list/show`
- `acc callables list/show`
- `acc artifacts get/diff`
- `acc graphops`
- `acc mcp serve`
- `acc storage doctor/rebuild-index/gc/purge/pin/unpin/export-run`

CLI 的关键契约是机器可读输出：当命令声明 `--emit-json` 或 `--emit-conductor-json` 时，stdout 必须输出一个 JSON object，日志和错误进入 stderr。当前 `acc workflow run` 总是 `typer.echo(dump_json(result))`，并在非 `success` 状态退出 1；`acc run <legacy-ref>` 已禁止执行旧 runtime，提示使用 `acc workflow run <workflow.accflow.json>`。

CLI 不应绕过 Core v2 runtime、GraphOps、人审或 path safety。它可以调用同一批 app/control-plane service，但不能制造与 HTTP API 不一致的状态语义。

### 2.3 MCP

MCP 由 `acc/mcp_server/server.py` 和 `acc/mcp_server/tools.py` 提供，`acc mcp serve --project-root <path>` 以 stdio transport 暴露工具。`create_mcp_server()` 使用 `FastMCP("Agent Callable Conductor", json_response=True)`，注册以下能力：

- callable/workflow catalog：`acc_list_callables`、`acc_show_callable`、`acc_list_workflows`、`acc_show_workflow`
- Workbench snapshot：`acc_get_canvas_snapshot`
- run evidence：`acc_get_run_summary`、`acc_get_run_events`
- artifact：`acc_read_artifact`
- authoring：`acc_create_authoring_session`、`acc_send_authoring_message`
- canvas proposal：`acc_validate_canvas_proposal`、`acc_dry_run_canvas_proposal`
- GraphOps：`acc_create_graphops_proposal`、`acc_validate_graphops_proposal`、`acc_dry_run_graphops_proposal`
- temporary resource：`acc_list_temporary_resources`、`acc_promote_temporary_resource_dry_run`

MCP 的返回类型由 `McpToolResult` 约束，`status` 只能是：

- `valid`
- `invalid`
- `dry_run`
- `submitted`
- `rejected`
- `requires_approval`

每次 MCP tool 调用都会通过 `write_mcp_audit()` 写 audit 记录，携带 `request_id`、`tool_name`、`status`、`proposal_id`、`run_id`、`task_id`、`target_paths`、`errors` 等信息。MCP 因此是 AI/agent 自动化入口，但不是无审计后门。

MCP 可以创建 GraphOps proposal、validate、dry-run，但不暴露直接 apply 工具。这个边界符合 ACC 的治理原则：AI 可以提出和预演修改，持久化写入必须通过 GraphOps approval/apply 流程。

### 2.4 Workbench

Workbench 是 React 前端，核心入口在 `web/src/App.tsx` 和 `web/src/components/WorkflowViewer.tsx`。当前目录已经拆出若干模块：

- `web/src/api.ts`：HTTP API client。
- `web/src/stores/`：轻量 Zustand store，覆盖 workbench、run、assistant 的局部状态。
- `web/src/hooks/useRunStream.ts`：run SSE hook。
- `web/src/hooks/useAssistantStream.ts`：assistant turn SSE + polling hook。
- `web/src/components/canvas/`：canvas 编辑和节点渲染。
- `web/src/components/workbench/`：Workbench shell、task rail、workspace switcher、top bar。
- `web/src/components/execution/`：run dock、live output overlay。
- `web/src/components/assistant/`：assistant drawer、turn list。
- `web/src/components/authoring/`：authoring session / proposal review helpers。
- `web/src/components/inspector/`：selection detail and node detail surfaces。

当前实现仍然存在一个现实边界：`WorkflowViewer.tsx` 仍是大型复合组件，内部持有 canvas state、task state、run projection、live events、assistant state、GraphOps persistence review、graph conversion 等大量逻辑。`web/src/stores/*` 和子组件已经抽出部分结构，但不能把当前 Workbench 误读成完全薄壳化架构。

SDD 对后续开发的约束是：**继续拆分可以做，但拆分后仍必须保持 Workbench 是 projection/editor，不成为 durable runtime truth。**

## 3. System Interaction Model

ACC 的主要交互路径如下：

```text
User / Script / MCP / Runner
  -> HTTP API / CLI / MCP tools
  -> app service / GraphOpsService / WorkflowAppService / LocalRunnerService
  -> runtime / control ledger / result store / artifact store
  -> durable files under workflows/, callables/, runs/
  -> server projection / SSE / Workbench overlay
```

对于 Workbench 运行路径，当前主要链路是：

```text
Workbench canvas
  -> canvasToWorkflowGraph()
  -> runnerApi.submitJob()
  -> POST /api/runner/jobs
  -> workflow preflight
  -> claim_run()
  -> prepare_runtime_graph()
  -> WorkbenchRunManager.submit()
  -> WorkflowAppService.run()
  -> runs/<run_id> evidence
  -> GET /api/runs/{run_id}, /events, /stream
  -> Workbench run overlay
```

兼容链路仍存在：

```text
Workbench / API client
  -> POST /api/workflows/run-graph
  -> synchronous WorkflowAppService.run_sync()
```

但 Workbench 当前 `runWorkflowGraph()` 使用的是 `runnerApi.submitJob()`，不是直接 `api.submitGraphRun()`。因此 runner surface 已经成为当前 UI 的主要 run submission path。

## 4. HTTP API Surface

### 4.1 Server App Boundary

`acc/server/app.py` 的 `create_app(project_root)` 做三件事：

1. 创建 `FastAPI(title="Agent Callable Workbench Server", version="0.1.0")`。
2. 把 `project_root` 存在 `app.state.project_root`。
3. 安装 `local_runner_security_middleware` 并注册所有 route。

`acc/server/context.py` 提供 project root 和 path helper：

- `get_project_root(request)`
- `get_workbench_run_manager(request)`
- `project_path(request, *parts)`
- `configured_project_dir(project_root, env_name, default_value)`
- `resolve_inside_project(project_root, value)`
- `relative_project_path(project_root, path)`

所有需要解析项目内路径的 route 应使用这些 helper，避免手写 path traversal 逻辑。

### 4.2 Workflow API

Workflow API 在 `acc/server/routes/workflows.py`，前缀 `/api/workflows`。

主要职责：

- 列出 workflow：`GET /api/workflows`
- 读取 workflow：`GET /api/workflows/{workflow_id}`
- 保存 `.accflow.json`：`POST /api/workflows`、`PUT /api/workflows/{workflow_id}`
- 验证 workflow：`POST /api/workflows/{workflow_id}/validate`
- 运行已保存 workflow：`POST /api/workflows/{workflow_id}/run`
- 运行临时 graph：`POST /api/workflows/run-graph`
- 异步提交临时 graph：`POST /api/workflows/run-graph/submit`
- 管理 local binding：`GET/PUT /api/workflows/{workflow_id}/binding`
- 校验/选择 binding directory：`/binding/validate`、`/binding/select-directory`、`/binding/open-folder`

Workflow save 的关键机制：

- `workflow_storage_path()` 要求路径以 `.accflow.json` 结尾。
- 目标路径必须在 `workflows_dir` 下。
- `save_graph()` 会先通过 Workbench adapter 编译为 canonical bundle。
- `write_bundle_to_directory()` 使用 staging directory 写入 root/child workflow，再 validate，最后 replace。
- `validate_workflow_save_path()` 在替换目标文件前调用 `WorkflowAppService.validate()`。

Runtime graph 的关键机制：

- `preflight_runtime_graph()` 在创建 evidence 前验证 graph id 和 workflow refs。
- `claim_run_for_payload()` 使用 `claim_run()` 创建 run handle，并处理 `run_id`/`run_dir` 互斥。
- `prepare_runtime_graph()` 把 Workbench graph 写到 `runs/_workflow_function_specs/run-<hash>/root.accflow.json`。
- `write_runtime_spec_manifest()` 写 `runtime_specs.json`，记录 root、children、run_dir、workflow_id。

错误语义：

- graph id 缺失：400。
- workflow 保存路径不合法：400。
- workflow 已存在且未 force：409。
- workflow 找不到：404。
- validation 失败：400，可能包含 `{message, validation}`。
- `run_id` 已存在：409。
- `workspace` 与 `binding_path`/`binding_ref` 同时提供：400。
- `binding_path` 与 `binding_ref` 同时提供：400。

### 4.3 Run API

Run API 在 `acc/server/routes/runs.py`，前缀 `/api/runs`。

它是 Workbench 读取 runtime truth 的主通道。核心 endpoint：

- `GET /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/plan`
- `GET /api/runs/{run_id}/steps`
- `GET /api/runs/{run_id}/dispatches`
- `GET /api/runs/{run_id}/decisions`
- `GET /api/runs/{run_id}/control-ledger`
- `POST /api/runs/{run_id}/cancel`
- `GET /api/runs/{run_id}/nodes/{node_id}`
- `GET /api/runs/{run_id}/nodes/{node_id}/artifacts`
- `GET /api/runs/{run_id}/events`
- `GET /api/runs/{run_id}/nodes/{node_id}/events`
- `GET /api/runs/{run_id}/nodes/{node_id}/logs/{stream}`
- `GET /api/runs/{run_id}/stream`
- `GET /api/runs/{run_id}/projection/nodes`
- `GET /api/runs/{run_id}/projection/nodes/{node_id}`
- `GET /api/runs/{run_id}/projection/outputs/{target_field}`

Run API 的基本原则：

- `GET /api/runs/{run_id}` 读取 `run_summary.json` / run index projection。
- `GET /events` 使用 `RunEventProjectionService` 合并 root run 和 nested workflow events。
- node events 会合并 node `events.jsonl` 和关联 agent turn event log。
- logs 通过 offset + limit 读取 `stdout.log` / `stderr.log` delta。
- projection endpoints 从 `FilesystemResultStore` 和 `runtime.json` 读取 Workbench-safe view，不写磁盘。
- control ledger endpoints 从 run-scoped ledger 文件读取 plan/steps/dispatches/decisions。

run id / path safety：

- 所有 `{run_id}` 通过 `validate_http_run_id()` 调用 `validate_run_id()`。
- `{node_id}`、`{target_field}` 使用 `validate_path_component()`，禁止空值、`.`、`..`、路径分隔符。
- artifact listing 要求 artifact dir 在 project root 下。
- secret-like path 被 `reject_secret_like_path()` 过滤。

cancel 语义：

- `POST /api/runs/{run_id}/cancel` 不直接杀 durable fact。
- 它调用 `WorkbenchRunManager.cancel(run_id)`。
- queued run 会写 `cancel_requested` marker 并把 summary 写成 `cancelled`。
- active run 会写 `cancel_requested` marker，并尽量把 summary 写成 `cancel_requested`。
- 如果 run 不在 queued/running，则返回 400。

### 4.4 Run Stream API

`GET /api/runs/{run_id}/stream?after_seq=N` 返回 `text/event-stream`。

当前 SSE frame 类型包括：

- `node_log_delta`
- `agent_event`
- `live_event`
- `summary`

`node_log_delta` 直接承载 log delta：

```json
{
  "type": "node_log_delta",
  "run_id": "...",
  "node_id": "...",
  "stream": "stdout",
  "offset": 0,
  "next_offset": 100,
  "text": "...",
  "eof": false
}
```

`agent_event` 承载 agent event projection，带有 `session_id`、`turn_id`、`agent_session_id`、`agent_turn_id` 等字段。

`live_event` 是 Workbench-friendly 统一事件，来自 `acc/server/live_events.py` 的 `live_event_from_node_log()` 或 `live_event_from_agent_event()`，包含：

- `event_id`
- `seq`
- `source`
- `run_id`
- `node_id`
- `ui_node_id`
- `parent_node_id`
- `node_run_dir`
- `session_id`
- `turn_id`
- `type`
- `stream`
- `text`
- `payload`
- `timestamp`

`summary` 在 run 进入 terminal 状态时发送，并结束 stream。terminal 状态当前包括：

- `success`
- `failed`
- `cancelled`
- `crashed`

SSE 是 best-effort 通道。前端必须用 polling / direct GET 作为 durable fallback。当前 `WorkflowViewer.tsx` 和 `useRunStream.ts` 都遵守这个原则：stream frame malformed 时忽略，最终状态通过 `api.run()` 和 `api.runEvents()` 刷新。

### 4.5 Workbench API

Workbench API 在 `acc/server/routes/workbench.py`，前缀 `/api/workbench`。

主要职责：

- task list：`GET /api/workbench/tasks`
- create/update/delete task：`POST/PUT/DELETE /api/workbench/tasks`
- task canvas：`GET/PUT /api/workbench/tasks/{task_id}/canvas`
- canvas snapshot：`POST /api/workbench/canvas-snapshots`
- canvas snapshot read：`GET /api/workbench/canvas-snapshots/{task_id}`

这组 API 存的是 Workbench task/editor state，不是 runtime truth。字段如：

- `task_id`
- `title`
- `saved_workflow_ref`
- `active_run_id`
- `latest_run_id`
- `canvas_hash`
- `canvas_snapshot`
- `selection`
- `temporary_resources`

`PUT /tasks/{task_id}/canvas` 支持 optimistic concurrency：

- 请求体可带 `base_canvas_hash`。
- 也可使用 `If-Match` header。
- stale canvas 会映射成 409。

重要边界：

- `canvas_snapshot` 是 editor snapshot，不等价于 canonical `.accflow.json`。
- 临时资源 `temporary_resources` 不能直接 run/save 为 durable callable。
- 临时 agent template 需要经过 GraphOps proposal/dry-run/approval/apply 才能进入 `callables/agents/*.yaml`。

### 4.6 GraphOps API

GraphOps API 在 `acc/server/routes/graphops.py`，前缀 `/api/graphops`。

当前包含两套 surface：

1. legacy examples / patch preview：
   - `GET /api/graphops/examples`
   - `POST /api/graphops/validate`
   - `POST /api/graphops/dry-run`
   - `POST /api/graphops/apply`

2. transaction proposal flow：
   - `POST /api/graphops/proposals`
   - `GET /api/graphops/proposals`
   - `GET /api/graphops/proposals/{proposal_id}`
   - `POST /api/graphops/proposals/{proposal_id}/validate`
   - `POST /api/graphops/proposals/{proposal_id}/dry-run`
   - `POST /api/graphops/proposals/{proposal_id}/approve`
   - `POST /api/graphops/proposals/{proposal_id}/apply`
   - `POST /api/graphops/proposals/{proposal_id}/reject`

注意这里有两条不同路径：transaction proposal 的
`POST /api/graphops/proposals/{proposal_id}/apply` 是当前持久化治理路径；legacy patch
endpoint 的 `POST /api/graphops/apply-patch` 才会明确返回 400：
`GraphOps apply is not implemented in Option A`。

proposal approval 请求必须携带：

- `proposal_id`
- `target_paths`
- `base_hashes`
- `dry_run_digest`
- `approver`

这保证持久化 apply 绑定到人审过的 dry-run 结果和目标文件 base hash。

### 4.7 Agent Sessions API

Agent session API 在 `acc/server/routes/agent_sessions.py`，前缀 `/api/agent-sessions`。

它服务两类对话：

- run node 绑定的 agent session。
- Workbench assistant session。

主要 endpoint：

- `POST /api/agent-sessions`
- `GET /api/agent-sessions/{session_id}`
- `GET /api/agent-sessions/{session_id}/messages`
- `POST /api/agent-sessions/{session_id}/turns/submit`
- `GET /api/agent-sessions/{session_id}/turns/{turn_id}/events`
- `GET /api/agent-sessions/{session_id}/turns/{turn_id}/stream`
- `POST /api/agent-sessions/{session_id}/assistant-draft/validate`
- `POST /api/agent-sessions/{session_id}/output/publish`

创建 session 的输入有两种模式：

- `source.type = "run_node"`：从某个 run/node evidence 创建绑定 session。
- `source.type = "workbench_assistant"`：从 task canvas snapshot 创建 Workbench assistant session。

turn stream 的 SSE frame：

- `agent_event`
- `live_event`
- `terminal`
- `error`

`WorkbenchLiveBus` 是 process-local live bus。它维护每个 stream key 的 subscribers 和 seq。队列满时会丢弃旧事件并注入 `gap` live event，payload 为 `{reason: "live queue overflow"}`。因此前端必须把 live stream 当增量体验，不当完整历史。

terminal 状态包括：

- `success`
- `failed`
- `cancelled`
- `timeout`

### 4.8 Runner API

Runner API 在 `acc/server/routes/runner.py`，前缀 `/api/runner`。这是本地 runner 产品化入口，当前 Workbench 运行 task 主要走这里。

主要 endpoint：

- `GET /api/runner/health`
- `GET /api/runner/capabilities`
- `GET /api/runner/providers`
- `GET /api/runner/workspaces`
- `POST /api/runner/workspaces`
- `POST /api/runner/jobs`
- `GET /api/runner/jobs/{job_id}`
- `POST /api/runner/jobs/{job_id}/cancel`
- `GET /api/runner/runs/{run_id}/projection`
- `GET /api/runner/runs/{run_id}/stream`
- `GET /api/runner/artifacts/{artifact_id}/preview`

Runner job submission 的实际链路：

```text
POST /api/runner/jobs
  -> workflow_routes.preflight_runtime_graph()
  -> LocalRunnerService.validate_job_before_evidence()
  -> claim_run()
  -> workflow_routes.prepare_runtime_graph()
  -> WorkbenchRunManager.submit()
  -> LocalRunnerService.write_job_receipt()
```

拒绝 job 时，route 会写 rejected job receipt，再以 400 返回，detail 中包含 rejection payload 和 job receipt。

runner artifact preview 错误映射：

- `artifact_not_found` -> 404
- `artifact_policy_denied` -> 403
- 其他 `RunnerCapabilityError` -> 400

`/api/runner/runs/{run_id}/stream` 当前复用 `/api/runs/{run_id}/stream`。

### 4.9 Artifacts API

Artifact API 在 `acc/server/routes/artifacts.py`，前缀 `/api/artifacts`。

`GET /api/artifacts/read?path=<artifact_ref>` 读取 artifact 内容。错误映射：

- artifact 找不到：404
- policy denied / secret-like path：403，detail code 为 `artifact_policy_denied`
- artifact 太大：413
- encoding 不支持：415
- 其他 ACC 错误：400

Artifact API 必须保持只读。它只能读取被 runtime / result store / artifact manifest 暴露的安全内容，不能成为任意文件读取接口。

### 4.10 Interactions And Decisions API

Interactions API 在 `acc/server/routes/interactions.py`，挂在 `/api/runs/{run_id}/interactions` 下。它暴露 human gate 交互：

- list interaction
- get interaction
- answer interaction
- create interaction

`answer_run_interaction()` 通过 `answer_human_gate()` 写入 answer。它是 runtime human gate 的外部入口，不是普通 UI 表单状态。

Decisions API 在 `acc/server/routes/decisions.py`，前缀 `/api/decisions`。它返回 decision inbox projection，可包含 GraphOps 和 event-derived decision items。Workbench 的 `DecisionInboxPanel` 使用它来展示待处理审批/决策。

## 5. CLI Contract

CLI 面向脚本和本地工程师，必须保持稳定、机器可读、低副作用。

### 5.1 Command Groups

当前 Typer command groups：

```text
session
graphops
runs
callable
callables
workflow
workflows
migrate
conductor
events
artifacts
environment
ports
template
mcp
storage
```

### 5.2 JSON Output

命令使用 `dump_json()` 输出 JSON。错误使用 `log_stderr()` 并 `typer.Exit(1)`。

硬契约：

- 可脚本化命令在 JSON 模式下 stdout 只能输出 JSON payload。
- 错误、提示、human-readable log 必须进入 stderr。
- 非成功 runtime status 应返回非零 exit code。

### 5.3 Legacy Boundary

`acc run <legacy-ref>` 已不执行旧 runtime asset，会明确失败并提示：

```text
Use `acc workflow run <workflow.accflow.json>`.
```

legacy `*.graph.json` 应通过 `acc workflow import-graph <path>` 转成 `.accflow.json`。CLI 不应复活 pre-Core-v2 runtime。

### 5.4 Server And MCP

`acc server --host --port` 启动 FastAPI app。

`acc mcp serve --project-root` 启动 MCP stdio server。MCP server 和 HTTP server 应共享项目根、catalog、run evidence、GraphOps service 的语义，不应出现一边能绕过另一边不能绕过的权限路径。

## 6. MCP Contract

MCP 是给 AI agent 使用的受控接口面。

### 6.1 Tool Result Shape

所有工具返回 `McpToolResult`：

```text
status
summary
errors
warnings
proposal_id
run_id
links
data
```

工具不应该直接返回裸内部对象；即使内部 service 抛错，也要通过 `invalid_result()` 包装成：

```json
{
  "status": "invalid",
  "summary": "...",
  "errors": [{"code": "...", "message": "..."}],
  "warnings": [],
  "links": [],
  "data": {}
}
```

### 6.2 Authoring And GraphOps Boundary

MCP 可用于：

- 读取 canvas snapshot。
- 创建 authoring session。
- 发送 authoring message。
- validate/dry-run canvas proposal。
- 创建 GraphOps proposal。
- validate/dry-run GraphOps proposal。
- dry-run temporary resource promotion。

MCP 不应：

- 直接写 `.accflow.json`。
- 直接写 `callables/agents/*.yaml`。
- 直接 apply GraphOps proposal。
- 绕过 `dry_run_digest` / `base_hashes` / human approval。

### 6.3 Audit

每次 tool 调用必须写 audit。审计字段要能回答：

- 谁调用了什么 tool。
- 关联哪个 `task_id` / `run_id` / `proposal_id`。
- 目标路径是什么。
- 返回状态是什么。
- 是否产生错误。

这使 MCP 可以作为 AI 开发协作入口，而不是隐形 mutation channel。

## 7. Workbench Contract

### 7.1 Workbench Is Projection / Editor

Workbench 的核心职责：

- 编辑 task canvas。
- 浏览 callable/workflow resources。
- 把 canvas 转成 workflow graph。
- 提交 run。
- 显示 run overlay、logs、events、artifacts。
- 发起 assistant authoring。
- 审核并触发 GraphOps persistence。

Workbench 不能拥有：

- runtime status truth。
- node execution truth。
- artifact truth。
- GraphOps apply truth。
- workflow template truth。

这些事实必须从 API 再读回来：

- runtime status -> `GET /api/runs/{run_id}`
- events -> `GET /api/runs/{run_id}/events`
- logs -> `GET /api/runs/{run_id}/nodes/{node_id}/logs/{stream}`
- artifacts -> `GET /api/runs/{run_id}/nodes/{node_id}/artifacts` + `GET /api/artifacts/read`
- persistent workflow -> `GET /api/workflows/{workflow_id}`
- callable catalog -> `GET /api/callables`
- GraphOps result -> GraphOps proposal/apply manifest

### 7.2 Current State Model

当前 `WorkflowViewer.tsx` 内部 state 包括：

- `tasks`
- `activeTaskId`
- `canvas`
- `sourceGraph`
- `selection`
- `runsById`
- `runLogsById`
- `runLiveEventsById`
- `runtimeConfig`
- `workflowBindings`
- `evidenceDock`
- `assistantMessages`
- `assistantProposal`
- `assistantSessionId`
- `assistantPendingTurn`
- `assistantEvents`
- `assistantRequiredActions`
- `assistantGraphOpsReview`

这些状态分三类：

1. Durable editor state projection：
   - `tasks`
   - `canvas`
   - `activeTaskId`
   - `selection`
   - `temporaryResources`

2. Runtime projection：
   - `runsById`
   - `runLogsById`
   - `runLiveEventsById`
   - `workflowRun`
   - `runOverlay`

3. Assistant / authoring session projection：
   - `assistantSessionId`
   - `assistantPendingTurn`
   - `assistantEvents`
   - `assistantProposal`
   - `assistantGraphOpsReview`

只有第一类的一部分可以通过 `/api/workbench/tasks` 和 `/api/workbench/tasks/{task_id}/canvas` 持久化为 Workbench task/editor state。第二类必须可由 `runs/<run_id>` evidence 重建。第三类必须可由 agent session files / events 或 GraphOps evidence 重建。

### 7.3 Task And Canvas Persistence

Workbench 启动时：

1. 先从 `localStorage` 读取 legacy task store。
2. 调用 `api.workbenchTasks()` 读取 durable tasks。
3. 如果后端已有 tasks，则按 task id 调 `api.getWorkbenchTaskCanvas()` 加载 canvas。
4. 如果后端没有 tasks，则把 localStorage task 迁移到 backend。

编辑 canvas 时：

- `updateCanvas()` / `updateCanvasAndGraph()` 更新 React state。
- 周期性调用 `api.putWorkbenchTaskCanvas()` 保存 snapshot。
- 保存时使用 `captureAuthoringSnapshot()` 计算 `canvas_hash`。
- 保存失败不阻断本地编辑，因为 Workbench 编辑 state 仍可留在 browser。

这个设计意味着 `/api/workbench/*` 是 Workbench task store，不是 canonical workflow store。只有 `api.saveWorkflow()` 通过 `/api/workflows` 才写 `.accflow.json`。

### 7.4 Graph Conversion

Workbench canvas 与 runtime graph 的转换核心在 `canvasToWorkflowGraph()`：

- root canvas workflows -> `nodes`
- control canvas edges -> `control_edges` / `edges`
- data canvas edges -> `data_edges`
- boundary ports -> `exposed_inputs` / `exposed_outputs`
- workflow focus mode -> `workflow_input_bindings` / `workflow_output_bindings`
- Workbench UI layout -> `metadata`

保存 reusable workflow 时，`reusableWorkflowClassGraph()` 会改写：

- `workspace_policy.save_mode = "stateless_template"`
- `workspace_policy.default_state_mode = "stateless"`
- 去除 `binding_ref` 等 runtime/editor-specific fields。

`stripRuntimeStateFromCanvas()` 和 `sanitizeWorkflowClassNodeUi()` 的存在说明 Workbench 必须主动清理 runtime state，避免把 `status`、`runId`、`sessionId`、`event_log`、`output_path` 等字段写入 template。

Schema-driven data port 的 Workbench 规则：

- Agent/Tool 节点的业务 output ports 来自 `output_schema.properties.outputs.properties`。
- `main` output port 表示完整 `output.json`，不对应 `outputs.main` 字段。
- 无 `output_schema.properties.outputs.properties` 的旧节点继续使用 legacy `output_ports`。
- Input ports 不从 schema 推导；用户从 output port 拖到目标节点时，Workbench 可自动创建接收 input port。
- Workflow container 的对外 outputs 只由 boundary data edge / `workflow_output_bindings` 决定，内部 agent schema fields 不能自动泄漏到父图。
- schema 改名后，已存在的 data edge 要显示为 broken diagnostic，不应在保存或投影时被静默删除。

### 7.5 Run Submission

当前 `runWorkflowGraph()` 的路径：

1. 检查 temporary resource 是否阻止 run。
2. 生成 `runId = ui_workflow_<graph.id>_<Date.now()>`。
3. 构造 `runDir = runs/<runId>`。
4. 把 graph id 改成 run id，形成 `runnableGraph`。
5. 在 UI 中先创建 queued projection。
6. 调 `runnerApi.submitJob(runnableGraph, { runId, taskId, bindingRef })`。
7. 启动 `pollRunUntilTerminal()`。
8. SSE 同时通过 `EventSource(api.runStreamUrl(selectedRunId))` 提供 live update。

这说明 Workbench 的 run 状态是乐观投影：先显示 queued，再通过 API 拉取真实 `run_summary.json` 和 events 合并。

### 7.6 Polling And Streaming

Workbench 对 run 使用“双通道”：

- SSE：低延迟显示 live logs / agent events / summary。
- polling：定期 `api.run(runId)` + `api.runEvents(runId)`，重建 canonical projection。

SSE 错误或 malformed frame 不应破坏 durable view。前端注释已经明确：polling owns durable run state。

Assistant turn 也使用“双通道”：

- `EventSource(api.streamAgentTurnEventsUrl(sessionId, turnId))`
- 每秒 polling `api.getAgentSession()`、`api.getAgentSessionMessages()`、`api.getAgentTurnEvents()`

terminal 后刷新 final session state，清除 pending turn。

### 7.7 Assistant And Authoring

Workbench assistant 的创建路径：

```text
currentAuthoringSnapshot()
  -> api.authoringAgents()
  -> api.createWorkbenchAssistantSession()
  -> api.getAgentSessionMessages()
```

修改路径：

```text
submit assistant turn
  -> agent session events
  -> validateAssistantDraft()
  -> assistantProposal
  -> local apply to current canvas
```

临时资源持久化路径：

```text
temporary agent draft
  -> graphOpsTransactionForTemporaryAgent()
  -> api.createGraphOpsProposal()
  -> api.validateGraphOpsProposal()
  -> api.dryRunGraphOpsProposal()
  -> user reviews AssistantGraphOpsReview
  -> api.approveGraphOpsProposal()
  -> api.applyGraphOpsProposal()
  -> replaceTemporaryResourceWithCallable()
```

这里有一个非常重要的边界：

- assistant proposal 可以先应用到当前 canvas。
- 但 temporary resource 不能直接变成 persistent callable。
- persistent callable 必须通过 GraphOps approval/apply。

### 7.8 Extracted Stores And Components

`web/src/stores/workbenchStore.ts` 当前覆盖：

- active task id
- task ids
- connection mode
- edge view mode
- workspace view
- chrome layout
- node detail open state
- bottom dock mode

`web/src/stores/runStore.ts` 当前覆盖：

- `runsById`
- `runLogsById`
- `runtimeConfig`
- `workflowBindings`

`web/src/stores/assistantStore.ts` 当前覆盖：

- chat messages
- proposal
- session identity
- pending turn
- assistant events
- validation
- required actions
- GraphOps review
- undo token

这些 store 是 UI state holders，不是 persistence layer。后续迁移 `WorkflowViewer.tsx` 时，应继续把它们定位为 projection/cache，而不是替换 `/api/workbench` 或 run evidence。

## 8. Error Semantics

### 8.1 HTTP Status Mapping

通用规则：

- `400`：请求格式、业务前置条件、validation、path policy、runner capability 等错误。
- `401`：local runner token 缺失或无效。
- `403`：origin denied、artifact policy denied、secret-like path。
- `404`：run/workflow/callable/proposal/artifact/session 不存在。
- `409`：资源已存在、stale canvas hash、run id 冲突。
- `413`：artifact too large。
- `415`：artifact encoding unsupported。
- `500`：server 读取内部 YAML/JSON 等不可恢复内部错误；route 应尽量避免把用户输入 validation 错映射成 500。

### 8.2 Frontend Error Formatting

`web/src/api.ts` 的 `responseErrorMessage()` 会尝试解析 `payload.detail`：

- `detail` 是 string：追加到 `status statusText path` 后。
- `detail.message` 存在：优先显示 message。
- `detail.validation.errors` 存在：最多渲染前三个 validation issue。
- 其他 detail：JSON stringify。

因此后端返回结构化 detail 时，应优先使用：

```json
{
  "detail": {
    "code": "...",
    "message": "...",
    "validation": {
      "errors": []
    }
  }
}
```

而不是不可解析的长字符串。

### 8.3 Path And Auth Safety

`acc/server/security.py` 的 local runner middleware 支持 token gate：

- 如果 `local_token_required()` 为 false，直接放行。
- 如果 Origin 不在 allowlist，返回 403 `origin_denied`。
- 对 mutating method、artifact read、runner artifact preview、stream、folder select/open 等敏感路径要求 token。
- token 可来自 `LOCAL_TOKEN_HEADER` 或 `Authorization: Bearer <token>`。

默认 allowed origins：

- `http://127.0.0.1:5173`
- `http://localhost:5173`
- `http://127.0.0.1:3000`
- `http://localhost:3000`
- `tauri://localhost`
- `app://acc`

可通过 `ACC_LOCAL_RUNNER_ALLOWED_ORIGINS` 扩展。

## 9. Streaming Semantics

### 9.1 Run Stream Is Not Complete History

Run stream 是运行中增量输出，不能替代 `events.jsonl`。原因：

- SSE 连接可能断开。
- `after_seq` 只过滤 live projection seq，不等于 durable event seq。
- stream 会在 summary terminal 后结束。
- live logs 是 offset-based delta，客户端可能错过 chunk。

完整历史应从：

- `GET /api/runs/{run_id}/events`
- `GET /api/runs/{run_id}/nodes/{node_id}/events`
- `GET /api/runs/{run_id}`
- result store projection endpoints

读取。

### 9.2 Agent Turn Stream Is Best-Effort

Agent turn stream 通过 `WorkbenchLiveBus` 做 process-local fanout。队列满时会产生 `gap` 事件。

客户端必须：

- 允许重复事件。
- 允许 gap。
- 允许 stream error 后关闭。
- 用 `GET /messages`、`GET /events`、`GET /session` 刷新 canonical state。

### 9.3 Event Identity

Workbench live event 的主要 identity 字段：

- `event_id`
- `seq`
- `source`
- `run_id`
- `node_id`
- `ui_node_id`
- `parent_node_id`
- `node_run_dir`
- `session_id`
- `turn_id`

对于 nested workflow，`RunEventProjectionService` 会合成：

- `nested = true`
- `parent_node_id`
- `ui_node_id = <parent>__internal__<node>`
- `node_run_dir`

Workbench 不能只用 `node_id` 作为唯一 key；nested workflow 中不同层级可能有相同 `node_id`。应优先使用 `ui_node_id` 或 `node_run_dir`。

## 10. Interface Invariants

以下规则是后续开发必须保持的接口不变量：

1. Workbench 不把 runtime evidence 写回 template。
2. Workbench task state 不等价于 workflow template。
3. `activeRunId` / `latestRunId` 是指针，不是 run truth。
4. SSE stream 是 best-effort，不能替代 polling 和 evidence reads。
5. `/api/runs/*` 读的是 run evidence projection，不能写 template。
6. `/api/workflows/*` 写 template 前必须 canonicalize + validate。
7. `/api/workbench/*` 只写 editor/task state。
8. `/api/graphops/*` 是受控 mutation path，apply 需要 approval evidence。
9. `/api/runner/jobs` 可以提交 run，但必须先 preflight、validate capability、claim run。
10. `/api/artifacts/read` 必须执行 path/policy/size/encoding 防护。
11. CLI JSON 模式 stdout 只能输出 JSON；错误进入 stderr。
12. MCP tool 必须返回 `McpToolResult`，并写 audit。
13. nested workflow projection 必须保留 `ui_node_id` / `parent_node_id` / `node_run_dir`。
14. 对外状态名必须使用 canonical runtime status：`queued`、`running`、`success`、`failed`、`cancel_requested`、`cancelled`、`crashed` 等当前代码支持的名称。

## 11. Non-Goals

本文件不定义：

- Core domain model 字段全集。
- runtime scheduler 的完整状态机。
- result store / artifact store 的落盘 schema。
- GraphOps transaction handler 的内部实现。
- Workbench 具体视觉设计。
- 外部 provider 的内部协议。
- cloud backend 或 SaaS 控制面。

这些内容应分别在 domain/contracts、runtime/evidence、authoring/governance、verification/delivery 等 SDD 文件中定义。

## 12. Verification

### 12.1 Backend Verification

接口面变更后，至少应运行：

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
```

如果改动涉及 server routes，应额外运行 server tests：

```bash
python -m pytest -q tests/server
```

如果改动涉及 MCP：

```bash
python -m pytest -q tests/unit/test_mcp_server.py
```

如果改动涉及 runner/storage：

```bash
python -m pytest -q tests/server/test_runner_api.py tests/unit/test_storage.py tests/unit/test_storage_gc.py
```

### 12.2 Frontend Verification

Workbench/API client 变更后，应运行：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

### 12.3 Manual Acceptance Checks

关键手工验收：

1. Workbench 创建 task，刷新页面后 task/canvas 能从 `/api/workbench/tasks` 恢复。
2. 运行 task 后，UI 先显示 queued，再通过 `/api/runs/{run_id}` 和 stream 更新状态。
3. 关闭 SSE 或让 SSE malformed，不影响 polling 最终恢复 terminal status。
4. run 结束后，`runs/<run_id>/run_summary.json`、`events.jsonl`、node evidence 可被 API 读取。
5. 临时 agent resource 不能直接 run/save；必须通过 GraphOps dry-run 和 approval/apply。
6. artifact read 对 secret-like path、超大文件、不可读 encoding 返回正确错误。
7. MCP 创建 GraphOps proposal 后存在 audit record。
8. `acc workflow run ... --emit-json` 输出可被 JSON parser 直接解析。

## 13. Current Risks And Follow-Up

### 13.1 `WorkflowViewer.tsx` Still Owns Too Much

当前 `WorkflowViewer.tsx` 仍然包含大量状态和转换逻辑。风险不是“文件大”本身，而是职责容易混淆：

- canvas editor state
- run projection state
- live stream state
- assistant/authoring state
- GraphOps persistence review
- workflow graph conversion

后续拆分应按状态归属拆，而不是按 UI 区块机械拆：

- canvas model/conversion
- task persistence adapter
- run projection/cache
- assistant authoring session
- GraphOps review flow
- evidence reader

拆分过程中必须保留本文件的不变量：UI state 是 projection/cache，不能成为 durable truth。

### 13.2 Runner Surface Is Now In The Main UI Path

当前 Workbench `runWorkflowGraph()` 使用 `runnerApi.submitJob()`。这意味着 runner 不再只是可选外壳，而是当前 UI submit path 的一部分。

因此 runner API 的 capability validation、job receipt、auth、安全 preview policy 必须在后续 SDD 中被单独验收。否则 UI run 行为会和 `/api/workflows/run-graph/submit` 的兼容路径出现语义漂移。

### 13.3 Encoding / UI Text Drift

部分抽出的前端组件文件在当前读取结果中出现中文 mojibake，例如 `ExecutionDock.tsx`、`RunOverlay.tsx`、`AssistantDrawer.tsx`、`TaskRail.tsx` 等。这可能是文件编码、终端显示或历史写入问题。它不影响本文件定义的架构边界，但会影响 Workbench 用户可见文本质量。后续 UI 工作应单独验证真实浏览器渲染和源码编码。

## 14. Source Map

本文件基于以下当前代码事实：

- `acc/server/app.py`
- `acc/server/context.py`
- `acc/server/security.py`
- `acc/server/run_manager.py`
- `acc/server/run_projection.py`
- `acc/server/live_events.py`
- `acc/server/routes/workflows.py`
- `acc/server/routes/runs.py`
- `acc/server/routes/workbench.py`
- `acc/server/routes/graphops.py`
- `acc/server/routes/agent_sessions.py`
- `acc/server/routes/runner.py`
- `acc/server/routes/artifacts.py`
- `acc/server/routes/interactions.py`
- `acc/server/routes/decisions.py`
- `acc/app/run_events.py`
- `acc/app/control_projection.py`
- `acc/cli.py`
- `acc/mcp_server/server.py`
- `acc/mcp_server/tools.py`
- `acc/mcp_server/schemas.py`
- `web/src/api.ts`
- `web/src/stores/workbenchStore.ts`
- `web/src/stores/runStore.ts`
- `web/src/stores/assistantStore.ts`
- `web/src/hooks/useRunStream.ts`
- `web/src/hooks/useAssistantStream.ts`
- `web/src/components/WorkflowViewer.tsx`
- `web/src/components/workbench/*`
- `web/src/components/execution/*`
- `web/src/components/assistant/*`
- `web/src/components/authoring/*`
