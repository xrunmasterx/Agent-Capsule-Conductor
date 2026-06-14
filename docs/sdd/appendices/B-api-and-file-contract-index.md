# B. API And File Contract Index

本文是 ACC SDD 的 API 与文件契约索引。它不是接口教程，也不是代码清单；它的目标是让后续开发者和 AI 在改动 ACC 时能快速判断：

- 一个 endpoint 是事实写入入口，还是只读投影。
- 一个文件是 durable truth，还是 cache / projection / compatibility artifact。
- 谁负责写，谁负责读。
- 改动它会影响哪些测试和安全边界。

当前索引基于以下代码事实：

- `acc/server/app.py`
- `acc/server/routes/`
- `acc/app/runtime/workflow_io.py`
- `acc/runtime/io.py`
- `acc/storage.py`
- `acc/storage_refs.py`
- `acc/run_index.py`
- `acc/ledger_writer.py`
- `acc/store/control_ledger.py`
- `acc/cloud_sync.py`
- `acc/runner.py`
- 补充核对：`acc/control_plane.py`、`acc/result_store/filesystem.py`、`acc/server/security.py`、`acc/storage_index.py`、`acc/storage_gc.py`

## 1. Stability Labels

| Label | 含义 |
| --- | --- |
| Stable | 已经是当前架构不变量，修改需要同步 SDD、测试和调用方。 |
| Stable Projection | 外部可见但本身不是事实源；可演进字段，但不能改变背后的 source of truth。 |
| Compatibility | 为旧格式或过渡期保留；不得扩展成新的核心路径。 |
| Evolving | 产品化或新能力正在成型；修改前要确认是否已经被 Workbench / tests 依赖。 |
| Internal | 内部实现细节；可以改，但必须保持上层契约不破。 |

## 2. HTTP API Contract Index

### 2.1 App-Level Route Mounting

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `create_app(project_root)` registers all `/api/*` routers | `acc.server.app` | FastAPI router registration, not durable state | `create_app()` | Workbench, tests, local runner clients | Stable | `tests/server/*` through TestClient fixtures | `local_runner_security_middleware` is installed globally before routers. |
| `GET /api/health`, `GET /api/version`, `GET /api/runtime/config` | `acc.server.routes.health` | Process/runtime config | none | Workbench, smoke checks | Stable Projection | server smoke tests, runtime policy tests | `runtime/config` reveals only mode booleans, not secrets. |

### 2.2 Workflow Definition And Run Submission APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/workflows` | `acc.server.routes.workflows` | `workflows/*.accflow.json`, legacy `*.yaml` | none | Workbench workflow picker | Stable Projection | `tests/server/test_workbench_core_v2_api.py`, `tests/server/test_workflows_storage_contract.py` | Only returns project-relative paths. |
| `GET /api/workflows/{workflow_id}` | `acc.server.routes.workflows` | `workflows/<id>.accflow.json` or legacy YAML | none | Workbench loader, API clients | Stable Projection | `tests/server/test_workbench_core_v2_api.py` | Rejects direct path traversal by requiring direct `.accflow.json` lookup or catalog match. |
| `POST /api/workflows` | `acc.server.routes.workflows` | `workflows/<id>.accflow.json` plus child `.accflow.json` files | `save_graph()` via staged bundle write | Workbench, GraphOps-adjacent authoring flows | Stable | `tests/server/test_workbench_core_v2_api.py`, `tests/server/test_workflows_storage_contract.py` | `workflow_storage_path()` requires `.accflow.json` and rejects paths outside workflows dir; save validates before replace. |
| `PUT /api/workflows/{workflow_id}` | `acc.server.routes.workflows` | `workflows/<id>.accflow.json` | `save_graph()` | Workbench | Stable | `tests/server/test_workbench_core_v2_api.py` | Same path and validation rules as create. |
| `POST /api/workflows/{workflow_id}/validate` | `acc.server.routes.workflows` | Workflow file validation result | none | Workbench validation UI, tests | Stable Projection | `tests/server/test_workbench_core_v2_api.py` | Does not persist. |
| `POST /api/workflows/run-graph` | `acc.server.routes.workflows` | New run evidence under `runs/<run_id>/` | `claim_run_for_payload()`, `prepare_runtime_graph()`, `WorkflowAppService.run_sync()` | Compatibility synchronous clients | Compatibility | `tests/server/test_workbench_core_v2_api.py` | Creates run dir only after preflight and runner environment validation. |
| `POST /api/workflows/run-graph/submit` | `acc.server.routes.workflows` | New run evidence under `runs/<run_id>/`; active handle in `WorkbenchRunManager` | `claim_run_for_payload()`, `prepare_runtime_graph()`, async manager | Workbench primary async run path | Stable | `tests/server/test_workbench_core_v2_api.py`, `tests/unit/test_workbench_run_manager.py` | Validates graph, workspace/binding/provider capacity before durable run evidence. |
| `POST /api/workflows/{workflow_id}/run` | `acc.server.routes.workflows` | New run evidence under `runs/<run_id>/` | `WorkflowAppService.run_sync()` | CLI-like API clients | Stable | workflow server tests | `run_id` validated by `claim_run()`; legacy `run_dir` accepted only as exact `runs/<run_id>`. |
| `GET /api/workflows/{workflow_id}/binding` | `acc.server.routes.workflows` | `bindings/<workflow_id>.binding.local.json` | none | Workbench binding panel | Stable Projection | `tests/server/test_workbench_core_v2_api.py` | Returns `valid/missing/invalid`; does not expose beyond project-relative binding path. |
| `PUT /api/workflows/{workflow_id}/binding` | `acc.server.routes.workflows` | `bindings/<workflow_id>.binding.local.json` | `save_workflow_binding()` | Runtime environment resolution | Stable | `tests/server/test_workbench_core_v2_api.py` | Requires existing workspace directory; writes via temp replace. |
| `POST /api/workflows/{workflow_id}/binding/validate` | `acc.server.routes.workflows` | Filesystem existence of workspace path | none | Workbench binding panel | Stable Projection | `tests/server/test_workbench_core_v2_api.py` | Validates local path, no persistence. |
| `POST /api/workflows/{workflow_id}/binding/select-directory` | `acc.server.routes.workflows` | OS directory picker result | none | Workbench local UX | Evolving | `tests/server/test_workbench_core_v2_api.py` | Requires local auth when token mode is enabled. |
| `POST /api/workflows/{workflow_id}/binding/open-folder` | `acc.server.routes.workflows` | `bindings/` folder | may create `bindings/` dir | Local UX | Evolving | workflow server tests | Ensures `bindings/` remains inside project root; requires local auth in product token mode. |

### 2.3 Run Projection, Events, Logs, And Control Ledger APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/runs` | `acc.server.routes.runs`, `acc.run_index` | `runs/index.json`, rebuilt from `runs/*/run_summary.json` | `rebuild_run_index()` as needed | Workbench run list | Stable Projection | `tests/unit/test_run_index.py`, `tests/server/test_runs_projection_api.py` | Ignores missing/unparseable summaries by projecting invalid runs where possible. |
| `GET /api/runs/{run_id}` | `acc.server.routes.runs` | `runs/<run_id>/run_summary.json` fallback chain | none | Workbench run detail | Stable Projection | `tests/server/test_runs_projection_api.py` | `validate_run_id()` rejects path traversal and `_`-prefixed internal dirs. |
| `POST /api/runs/{run_id}/cancel` | `acc.server.routes.runs`, `WorkbenchRunManager` | Active task handle; may lead to `run_summary.json` update | `WorkbenchRunManager.cancel()` | Workbench run dock | Stable | `tests/unit/test_workbench_run_manager.py` | Only canonical run id accepted. |
| `GET /api/runs/{run_id}/events` | `acc.server.routes.runs`, `RunEventProjectionService` | `runs/<run_id>/events.jsonl` plus nested run event logs | runtime/ledger event appenders | Workbench event view, stream bootstrap | Stable Projection | `tests/server/test_runs_projection_api.py` | Tolerant JSONL parsing; no raw path input besides run_id. |
| `GET /api/runs/{run_id}/nodes/{node_id}/events` | `acc.server.routes.runs` | `runs/<run_id>/nodes/<node_id>/events.jsonl` plus agent turn event projection | runtime and agent turn services | Node inspector | Stable Projection | `tests/server/test_runs_projection_api.py` | `node_id` is a safe path component only. |
| `GET /api/runs/{run_id}/nodes/{node_id}/logs/{stdout|stderr}` | `acc.server.routes.runs` | Effective node `stdout.log` / `stderr.log`, including session-backed logs | adapter/runtime | Workbench log tail | Stable Projection | `tests/server/test_runs_projection_api.py` | Stream is enum-limited; offset/limit bounded. |
| `GET /api/runs/{run_id}/stream` | `acc.server.routes.runs` | Node logs and agent event logs | none; streams projections | Workbench live execution UI | Stable Projection | `tests/server/test_runs_projection_api.py`, live stream tests | SSE endpoint requires local auth when token mode is enabled. |
| `GET /api/runs/{run_id}/nodes/{node_id}` | `acc.server.routes.runs`, `acc.app.run_projection` | `run_summary.json` node entry | none | Node inspector | Stable Projection | `tests/server/test_run_projection_api.py` | Adds artifact URL but does not read artifact content. |
| `GET /api/runs/{run_id}/nodes/{node_id}/artifacts` | `acc.server.routes.runs` | `NodeRunSummary.artifact_dir` inside run evidence | none | Artifact browser | Stable Projection | `tests/server/test_artifacts_api.py`, `tests/server/test_runner_api.py` | Artifact dir must be inside project root; secret-like filenames are omitted. |
| `GET /api/runs/{run_id}/plan` | `acc.server.routes.runs`, `acc.app.control_projection` | `runs/<run_id>/run_plan.json` | `FixedRunControlLedgerWriter.initialize/finalize` | Control ledger UI | Stable Projection | `tests/server/test_control_ledger_api.py`, `tests/unit/test_control_ledger_store.py` | Missing ledger is projected with warnings, not fabricated as truth. |
| `GET /api/runs/{run_id}/steps` | same | `runs/<run_id>/plan_steps.jsonl` | `FixedRunControlLedgerWriter.transition_step()` | Control ledger UI | Stable Projection | `tests/server/test_control_ledger_api.py` | JSONL sequence/order must be valid. |
| `GET /api/runs/{run_id}/dispatches` | same | `runs/<run_id>/dispatches.jsonl` | `FixedRunControlLedgerWriter.start/complete/fail_dispatch()` | Control ledger UI | Stable Projection | `tests/server/test_control_ledger_api.py` | Dispatch transition sequence is validated. |
| `GET /api/runs/{run_id}/decisions` | same | `runs/<run_id>/decisions.jsonl` | `FixedRunControlLedgerWriter` | Decision review UI | Stable Projection | `tests/server/test_control_ledger_api.py` | Decision evidence refs are relative to run dir. |
| `GET /api/runs/{run_id}/control-ledger` | same | Aggregate of `run_plan.json`, `plan_steps.jsonl`, `dispatches.jsonl`, `decisions.jsonl`, `events.jsonl` | runtime control ledger writer | Control ledger aggregate view | Stable Projection | `tests/server/test_control_ledger_api.py` | Aggregation must not mutate ledger. |
| `GET /api/runs/{run_id}/projection/nodes` | `acc.server.routes.runs`, `acc.server.run_projection` | `runs/<run_id>/result_store/` | runtime result store writers | Workbench data projection | Evolving | `tests/server/test_runs_projection_api.py`, `tests/unit/test_run_projection.py` | Uses typed `RunId`/`NodeId`; target ids validated. |
| `GET /api/runs/{run_id}/projection/nodes/{node_id}` | same | `result_store/<node_id>/*.json` | runtime result store writers | Node data view | Evolving | run projection tests | `node_id` safe component only. |
| `GET /api/runs/{run_id}/projection/outputs/{target_field}` | same | `result_store/__workflow_outputs/<target_field>.json` and `workflow_outputs/<target_field>/output.json` | `write_workflow_outputs()` | Workflow output view | Evolving | `tests/unit/test_run_projection.py`, workflow output tests | `target_field` safe component only. |

### 2.4 Artifact APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/artifacts/read?path=<artifact_ref>` | `acc.server.routes.artifacts`, `acc.control_plane` | Registered run or node artifact ref resolving through run evidence | none | Workbench artifact preview, MCP tools | Stable | `tests/server/test_artifacts_api.py`, `tests/unit/test_mcp_server.py` | Raw project paths are denied; max read size is `MAX_ARTIFACT_READ_BYTES`; only UTF-8 text; secret-like names denied. |
| Versioned artifact refs: `artifact:v1:<run_id>:run:<relative_path>` | `acc.storage_refs` | `RunSummary.artifact_dir` under claimed run dir | ref makers/readers | Artifact APIs, runner projection | Stable | `tests/unit/test_storage.py`, `tests/server/test_artifacts_api.py` | `run_id` and relative path are validated; `..` and absolute paths rejected. |
| Versioned node artifact refs: `artifact:v1:<run_id>:node:<node_id>:<relative_path>` | `acc.storage_refs` | `NodeRunSummary.artifact_dir` under claimed run dir | ref makers/readers | Node artifacts, runner projection | Stable | `tests/unit/test_storage.py`, `tests/server/test_runner_api.py` | `node_id` must be a single safe component. |
| Legacy artifact refs: `run:<run_id>:artifact:<path>`, `run:<run_id>:node:<node_id>:artifact:<path>` | `acc.storage_refs`, `acc.control_plane` | Same as versioned refs | compatibility readers | Existing UI/tests/MCP | Compatibility | `tests/server/test_artifacts_api.py`, `tests/unit/test_storage.py` | Keep read compatibility; new writers should prefer `artifact:v1`. |

### 2.5 Callable, Authoring, GraphOps, Decisions, And Debug APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/callables`, `GET /api/callables/{callable_id}` | `acc.server.routes.callables`, `acc.callable_registry` | `callables/agents/*.yaml`, `callables/tools/*.yaml`, built-ins | none | Workbench resource picker | Stable Projection | callable and MCP tests | Relative source paths only. |
| `POST /api/callables/agents` | `acc.server.routes.callables`, `acc.control_plane` | `callables/agents/<id>.yaml` | `save_agent_callable_payload()` | Callable registry | Stable | callable API tests, GraphOps tests | `CALLABLE_ID_RE` allows only `[A-Za-z0-9_.-]+`; validates registry after temp replace. |
| `PUT /api/callables/agents/{callable_id}` | same | same | same with overwrite | Callable registry | Stable | callable API tests | Path and body ids must match. |
| `DELETE /api/callables/agents/{callable_id}` | same | `callables/agents/<id>.yaml` | file unlink | Callable registry | Stable | callable API tests | Only agent callables through this route; no arbitrary path delete. |
| `GET /api/authoring/agents` | `acc.server.routes.authoring` | Authoring agent registry/service | none | Workbench assistant selector | Evolving | `tests/server/test_authoring_api.py`, `tests/unit/test_authoring_service.py` | Projection only. |
| `POST /api/authoring/sessions`, `GET /api/authoring/sessions/{session_id}` | `acc.app.authoring` | Authoring session store under ACC runtime storage | service writes session state | Workbench assistant | Evolving | authoring tests | Session ids are service-owned. |
| `POST /api/authoring/sessions/{session_id}/messages` | `acc.app.authoring` | Authoring session turns/events | service writes turn state | Workbench assistant | Evolving | authoring tests | Does not directly mutate workflow files. |
| `POST /api/authoring/proposals/validate`, `/dry-run` | `acc.app.authoring` | Proposal validation/dry-run artifacts | service may write proposal scratch only | Workbench proposal review | Evolving | authoring tests | Dry-run must not write durable workflow/callable/run truth. |
| Legacy `POST /api/graphops/validate`, `/dry-run`, `/apply` | `acc.server.routes.graphops` | `examples/graphops/*.patch.json` | validate/dry-run no write; apply not implemented | Demo tooling | Compatibility | GraphOps API tests | Patch path restricted to `examples/graphops`; apply always errors in Option A. |
| `POST /api/graphops/proposals` | `acc.graphops.GraphOpsService` | `runs/_graphops_proposals/<proposal_id>/proposal.json` and related staging | GraphOps service | Workbench review, decisions inbox | Stable | `tests/server/test_graphops_api.py`, `tests/unit/test_graphops_v3.py`, governance tests | Proposal is not apply; target paths/policies validated by service. |
| `GET /api/graphops/proposals`, `GET /api/graphops/proposals/{proposal_id}` | same | `runs/_graphops_proposals/*` | none | Workbench review | Stable Projection | GraphOps tests | Projection only. |
| `POST /api/graphops/proposals/{proposal_id}/validate` | same | proposal state / validation result | GraphOps service | review UI | Stable | GraphOps tests | Must not apply durable mutation. |
| `POST /api/graphops/proposals/{proposal_id}/dry-run` | same | dry-run staging/evidence | GraphOps service | review UI | Stable | GraphOps tests | Staging is not source of truth. |
| `POST /api/graphops/proposals/{proposal_id}/approve` | same | proposal approval record | GraphOps service | apply gate | Stable | GraphOps governance tests | Requires target paths, base hashes, dry-run digest, approver. |
| `POST /api/graphops/proposals/{proposal_id}/apply` | same | approved proposal transaction | GraphOps service writes target files | workflows/callables registry | Stable | GraphOps v3 tests | Must require prior approval; stale base hash must block. |
| `POST /api/graphops/proposals/{proposal_id}/reject` | same | proposal status | GraphOps service | review UI | Stable | GraphOps tests | No target mutation. |
| `GET /api/decisions` | `acc.server.routes.decisions`, `acc.app.decisions` | Decision inbox aggregated from run control ledger, GraphOps, events | none | Workbench decision rail | Stable Projection | `tests/server/test_decisions_api.py` | Limit bounded; projection only. |
| `POST /api/debugger/runs/{run_id}/replay` | `acc.server.routes.debugger` | Existing run evidence | none | Debug tools | Internal | debugger tests | Resolves inside project root. |
| `POST /api/debugger/diff` | same | Existing run dirs | none | Debug tools | Internal | debugger tests | Both paths resolved inside project root. |

### 2.6 Human Interaction APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/runs/{run_id}/interactions` | `acc.server.routes.interactions`, `acc.app.interactions` | run-scoped interaction records | none | Workbench human gate UI | Stable Projection | `tests/server/test_run_interactions_lifecycle.py`, run lifecycle tests | Current `_run_dir()` checks existence but does not call `validate_run_id`; callers should not pass arbitrary path-like values. |
| `GET /api/runs/{run_id}/interactions/{interaction_id}` | same | specific interaction record | none | Workbench human gate detail | Stable Projection | interaction tests | Interaction lookup owned by service. |
| `POST /api/runs/{run_id}/interactions/{interaction_id}/answer` | `acc.app.human_gate_service` | interaction answer and run state | `answer_human_gate()` | runtime resume path | Stable | interaction lifecycle tests | Answer payload is schema-loose; service must validate meaning. |
| `POST /api/runs/{run_id}/interactions` | `acc.app.interactions` | new interaction record | `create_interaction()` | tests/dev tooling, human gate | Evolving | interaction tests | Should remain run-scoped; avoid global interaction storage. |

### 2.7 Agent Session APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /api/agent-sessions` | `acc.server.routes.agent_sessions`, `acc.app.agent_sessions` | `.acc/sessions/*` or `runs/_agent_sessions/*` depending session kind | `AgentTurnService` | Workbench assistant, run-node chat | Evolving | `tests/server/test_agent_sessions_api.py` | `workspace_alias` is resolved by `LocalRunnerService`; unsupported source types rejected. |
| `GET /api/agent-sessions/{session_id}` | same | session manifest | none | Workbench assistant/chat UI | Evolving | agent session tests | Session id handled by service. |
| `GET /api/agent-sessions/{session_id}/messages` | same | session messages | none | Chat UI | Evolving | agent session tests | Projection only. |
| `POST /api/agent-sessions/{session_id}/turns/submit` | same | turn record and turn events | `AgentTurnService.submit_agent_turn()` plus task manager | Agent turn executor | Evolving | agent session tests | Expected provider session id can protect continuity. |
| `GET /api/agent-sessions/{session_id}/turns/{turn_id}/events` | same | `turns/<turn_id>/events.jsonl` | none | Chat UI | Evolving | agent session tests | Tolerant event projection. |
| `GET /api/agent-sessions/{session_id}/turns/{turn_id}/stream` | same | turn events and live bus | none | Chat UI SSE | Evolving | agent session tests | SSE requires local auth when token mode is enabled. |
| `POST /api/agent-sessions/{session_id}/assistant-draft/validate` | same | latest turn/draft state | service validation | Assistant proposal UI | Evolving | agent session tests | Does not publish output. |
| `POST /api/agent-sessions/{session_id}/output/publish` | same | session output publication state | service | Workbench canvas/resource update path | Evolving | agent session tests | Uses `expected_turn_id` to avoid stale publish. |

### 2.8 Workbench APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/workbench/tasks` | `acc.app.workbench_tasks` | `.acc/tasks/*/task.json` | none | Workbench task rail | Evolving | `tests/server/test_workbench_canvas_snapshots_api.py`, workbench task tests | Projection only. |
| `POST /api/workbench/tasks` | same | `.acc/tasks/<task_id>/task.json` | `WorkbenchTaskService.create()` | Workbench task rail | Evolving | workbench tests | Task state is UI/product state, not workflow template truth. |
| `GET /api/workbench/tasks/{task_id}` | same | task record | none | Workbench | Evolving | workbench tests | Service validates task id. |
| `PUT /api/workbench/tasks/{task_id}` | same | task record | `WorkbenchTaskService.update()` | Workbench | Evolving | workbench tests | `active_run_id/latest_run_id` are pointers, not runtime facts. |
| `DELETE /api/workbench/tasks/{task_id}` | same | tombstoned task record | `WorkbenchTaskService.tombstone()` | Workbench | Evolving | workbench tests | Tombstone, not arbitrary delete. |
| `PUT /api/workbench/tasks/{task_id}/canvas` | same | `.acc/tasks/<task_id>/canvas*.json` style service-owned canvas state | `WorkbenchTaskService.put_canvas()` | Workbench canvas | Evolving | workbench tests | Supports `If-Match` / `base_canvas_hash`; stale updates return 409. |
| `GET /api/workbench/tasks/{task_id}/canvas` | same | canvas state | none | Workbench canvas | Evolving | workbench tests | Projection only. |
| `POST /api/workbench/canvas-snapshots` | `acc.app.workbench_snapshots` | `runs/_workbench_canvas_snapshots` or service-owned snapshot store | `WorkbenchCanvasSnapshotService.publish()` | Runtime graph preparation | Evolving | `tests/server/test_workbench_canvas_snapshots_api.py` | Snapshot is an authoring/runtime overlay, not canonical workflow file. |
| `GET /api/workbench/canvas-snapshots/{task_id}` | same | latest canvas snapshot | none | `prepare_runtime_graph()` | Evolving | workbench snapshot tests | Projection only. |

### 2.9 Runner APIs

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/runner/health` | `acc.runner.LocalRunnerService` | `.acc/runner/runner.json`, `.acc/runner/pairing.json` | `ensure_runner_record()` updates `last_seen_at` | Local product shell / cloud pairing | Evolving | `tests/server/test_runner_api.py` | May create runner files as side effect. |
| `GET /api/runner/capabilities` | same | `.acc/runner/capabilities.json` | `capabilities(write=True)` | Cloud/product shell | Evolving | `tests/server/test_runner_api.py` | Hides local workspace paths; exposes aliases and provider availability. |
| `GET /api/runner/providers` | same | provider detection | may ensure runner record | UI capability view | Evolving | runner API tests | No secrets returned. |
| `GET /api/runner/workspaces` | same | `.acc/runner/workspaces.json` | may ensure defaults | product shell | Evolving | runner API tests | `local_debug=true` exposes local paths and requires local token. |
| `POST /api/runner/workspaces` | same | `.acc/runner/workspaces.json` | `add_workspace()` | runner job validation | Evolving | runner API tests | Mutating endpoint requires local token in token mode; validates directory exists. |
| `POST /api/runner/jobs` | `acc.server.routes.runner`, `LocalRunnerService`, `WorkbenchRunManager` | `.acc/runner/jobs/<job_id>.json` and `runs/<run_id>/` if accepted | preflight, `claim_run()`, `prepare_runtime_graph()`, `write_job_receipt()` | local runner clients | Evolving | `tests/server/test_runner_api.py` | Rejects unsupported providers/dangerous permissions before run evidence; queue capacity checked before claim. |
| `GET /api/runner/jobs/{job_id}` | `LocalRunnerService` | `.acc/runner/jobs/<job_id>.json` | none | product shell | Evolving | runner API tests | `job_id` must start with `job_`. |
| `POST /api/runner/jobs/{job_id}/cancel` | `LocalRunnerService`, `WorkbenchRunManager` | job receipt and active run handle | updates job status; may cancel active run | product shell/cloud side | Evolving | runner API tests | Terminal run status wins if manager no longer owns handle. |
| `GET /api/runner/runs/{run_id}/projection` | `LocalRunnerService` | `runs/<run_id>/run_summary.json` | none | product shell/cloud projection | Evolving | runner API tests | Default hides absolute paths; `local_debug` requires token. |
| `GET /api/runner/runs/{run_id}/stream` | delegates `GET /api/runs/{run_id}/stream` | run event/log projections | none | product shell | Evolving | runner API tests | SSE requires local auth when token mode is enabled. |
| `GET /api/runner/artifacts/{artifact_id}/preview` | `LocalRunnerService` | registered artifact ref decoded from URL-safe base64 id | none | product shell/cloud preview | Evolving | runner API tests | Raw paths denied; secret-like paths denied; returns metadata only, not file content. |

## 3. Durable File And Directory Contract Index

### 3.1 Project Runtime Roots

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workflows/<id>.accflow.json` | Workflow template store | Yes: canonical workflow template | Workflows API, GraphOps apply, possibly MCP/CLI | Loader, Workbench, runtime preparation | Stable | `tests/server/test_workbench_core_v2_api.py`, `tests/unit/test_workbench_adapter.py`, `tests/unit/test_workflow_refs.py` | Path must stay under workflows dir and end with `.accflow.json`. |
| `workflows/*.yaml` | Legacy workflow store | Legacy source | legacy authors only | workflow list/get compatibility | Compatibility | workflow tests | Do not expand as new canonical format. |
| `bindings/<workflow_id>.binding.local.json` | Local workflow binding | Local environment source for run workspace | Workflows binding API | runtime environment resolution | Stable | workflow binding tests | Must stay under `bindings/`; contains local absolute workspace path and should not sync to cloud. |
| `callables/agents/<id>.yaml` | Callable registry | Yes for agent class template | Callables API, GraphOps apply | CallableRegistry, Workbench picker | Stable | callable, GraphOps, MCP tests | Callable id regex prevents path escape. |
| `runs/<run_id>/` | Runtime evidence root | Yes for one run invocation | `claim_run()`, runtime orchestrator | run APIs, Workbench, GC, cloud sync | Stable | `tests/unit/test_storage.py`, run API tests | Must be claimed by `.acc-run-marker.json`; `run_id` validated. |
| `.acc/` | Product/local metadata root | Yes for task/runner/index/GC metadata | services under `acc.app`, runner, storage index/GC | Workbench, runner, GC | Evolving | storage/runner/workbench tests | May contain local-only paths/tokens; never treat as cloud-safe by default. |

### 3.2 Run Directory Core Evidence

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs/<run_id>/.acc-run-marker.json` | `acc.storage` | Ownership marker for canonical run dir | `claim_run()`, `write_run_marker()` | `assert_acc_run_dir()`, artifact resolver, GC/index | Stable | `tests/unit/test_storage.py`, `tests/server/test_runner_api.py` | Prevents ACC from reading/deleting arbitrary folders as run evidence. |
| `runs/<run_id>/function_invocation.json` | runtime orchestrator | Invocation identity/evidence | runtime startup via `function_invocation_payload()` | control ledger decision refs, debugging | Stable | runtime tests | Must not be edited by UI. |
| `runs/<run_id>/scope_frame.json` | runtime orchestrator | Scope cwd/inbox/outbox/artifact evidence | runtime startup via `scope_frame_payload()` | control ledger decision refs, debugging | Stable | runtime tests | Contains local paths; cloud projection must redact. |
| `runs/<run_id>/run_record.json` | runtime orchestrator | Runtime record fallback truth | runtime via `run_record_payload()` | `run_index.load_run_summary()` fallback, debug tools | Stable | `tests/unit/test_run_index.py` | Path fields are local evidence, not cloud-safe. |
| `runs/<run_id>/run_summary.json` | `acc.app.runtime.workflow_io`, `acc.run_index` | Primary run projection consumed by server | `write_core_v2_run_summary()`, lifecycle helpers | `/api/runs`, runner projection, cloud sync, GC/index | Stable | `tests/unit/test_run_index.py`, run API tests | Must use canonical statuses: `success`, `failed`, `cancelled`, `crashed`, plus active states where applicable. |
| `runs/<run_id>/node_summary.json` | legacy/single-node run compatibility | Compatibility projection | `run_index.write_node_summary()` | `load_run_summary()` fallback | Compatibility | `tests/unit/test_run_index.py` | Do not make it the preferred Core v2 summary. |
| `runs/index.json` | `acc.run_index` | Run list projection/cache | `rebuild_run_index()`, summary writers, storage GC | `/api/runs`, tools | Stable Projection | `tests/unit/test_run_index.py`, storage GC tests | Rebuildable; not stronger than per-run evidence. |
| `runs/<run_id>/cancel_requested` | run manager/cloud sync | Cancellation marker | `LocalCloudSyncService.acknowledge_cancel_intent()` and manager flows | runtime/manager cancellation checks | Evolving | cloud sync/workbench manager tests | Marker only requests cancellation; terminal summary remains final truth. |
| `runs/<run_id>/retention.json` | storage GC | Retention policy for object | `StorageGCService.set_pinned/export_run` | GC/index | Evolving | `tests/unit/test_storage_gc.py` | Controls deletion/export behavior; local-only by default. |
| `runs/<run_id>/tombstone.json` | storage GC | Deletion audit marker | `StorageGCService.apply_plan()` | GC/doctor/index | Evolving | storage GC tests | Written only after owned cleanup path assertion. |

### 3.3 Node Evidence Files

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs/<run_id>/nodes/<node_id>/input.json` | runtime executor/control ledger | Dispatch input evidence | runtime node preparation | dispatch envelope refs, debug tools | Stable | runtime/control ledger tests | `node_id` must be safe component. |
| `runs/<run_id>/nodes/<node_id>/agent_payload.json` | runtime executor | Adapter input payload projection | runtime executor | `node_summary_from_session_manifest()`, debugging | Stable | runtime tests | May contain prompt/local context; not cloud-safe by default. |
| `runs/<run_id>/nodes/<node_id>/resolved_prompt.md` | runtime executor/adapter | Human-readable prompt evidence | runtime executor | run summary/node inspector | Stable Projection | node summary tests | May contain sensitive prompt data. |
| `runs/<run_id>/nodes/<node_id>/output.json` | runtime executor | Node output payload | adapter/runtime | control ledger result refs, Workbench node view | Stable | runtime tests | Output schema should match callable artifact contract. |
| `runs/<run_id>/nodes/<node_id>/session_instance_manifest.json` | runtime executor | SessionInstance evidence | runtime via `session_instance_payload()` | run summary builder, ledger audit | Stable | control ledger/run summary tests | Required before dispatch can be marked `success`. |
| `runs/<run_id>/nodes/<node_id>/artifact_bundle.json` | runtime executor | ArtifactBundle evidence | runtime via `artifact_bundle_payload()` | ledger audit, artifact projection | Stable | control ledger tests | Required before dispatch success; relative paths only. |
| `runs/<run_id>/nodes/<node_id>/events.jsonl` | runtime executor / agent event projection | Node event stream | `append_event()` or adapter/session projections | `/api/runs/.../events`, cloud sync | Stable | run projection tests, cloud sync tests | JSONL parser is tolerant for projection, but ledger writers should emit valid JSON objects. |
| `runs/<run_id>/nodes/<node_id>/stdout.log` | adapter/runtime | stdout stream evidence | external adapter | log APIs/SSE/run summary | Stable | run projection tests | Not exposed through artifact APIs because secret-like exact name is denied. |
| `runs/<run_id>/nodes/<node_id>/stderr.log` | adapter/runtime | stderr stream evidence | external adapter / runtime error helper | log APIs/SSE/run summary | Stable | run projection tests | Not exposed through artifact APIs because secret-like exact name is denied. |
| `runs/<run_id>/nodes/<node_id>/artifacts/` | runtime executor/adapter | Node artifact directory | adapter/tool/session | artifact list/read, runner projection, cloud manifest | Stable | artifact and runner tests | Must remain under claimed run dir; secret-like names filtered. |
| `runs/<run_id>/artifacts/` | runtime/workflow | Run-level artifact directory | runtime/tool/session | artifact APIs, cloud manifest | Stable | artifact/cloud tests | Same registered artifact policy as node artifacts. |

### 3.4 Workflow Outputs And ResultStore

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs/<run_id>/workflow_outputs/<target_port>/output.json` | `acc.app.runtime.workflow_io` | Workflow output materialization | `write_workflow_outputs()` | users, legacy readers, run summary output path | Stable | workflow output/run projection tests | Required workflow output missing raises `AccError`. |
| `runs/<run_id>/result_store/<node_id>/<port_id>.json` | `acc.result_store.filesystem` | Typed port result manifest | `FilesystemResultStore.put()` via runtime helpers | run projection APIs | Evolving | `tests/unit/test_run_projection.py`, server run projection tests | Manifest bundle relative path must be relative to `runs/<run_id>/`. |
| `runs/<run_id>/result_store/<node_id>/<port_id>.bin` | `acc.result_store.filesystem` | Inline bytes for inline materialization | `FilesystemResultStore.put()` | projection layer | Evolving | result store/run projection tests | Written atomically; not directly exposed as raw artifact. |
| `runs/<run_id>/result_store/<node_id>/<port_id>/` | result store future reference dir | Reserved/reference materialization root | future result store writers | future selectors | Evolving | limited | Keep under run dir; do not introduce absolute bundle refs. |
| `result_store/__workflow_outputs/<target_port>.json` | runtime workflow output bridge | Workflow output result store manifest | `put_result_store_value()` from `write_workflow_outputs()` | `/api/runs/{run_id}/projection/outputs/{target_field}` | Evolving | run projection tests | `target_port` must be safe component. |

### 3.5 Runtime Control Ledger Files

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs/<run_id>/run_plan.json` | `FixedRunControlLedgerWriter`, `acc.store.control_ledger` | RunPlan truth | `write_run_plan()` through writer | control projection APIs | Stable | `tests/unit/test_control_ledger_store.py`, `tests/server/test_control_ledger_api.py` | Only writer should mutate plan status. |
| `runs/<run_id>/plan_steps.jsonl` | same | PlanStep transition log | `append_plan_step_transition()` through writer | projection loaders | Stable | control ledger tests | Sequence must be monotonically increasing; first transition previous status null. |
| `runs/<run_id>/dispatches.jsonl` | same | DispatchEnvelope transition log | `append_dispatch_transition()` through writer | projection loaders | Stable | control ledger tests | Transition previous status must match latest snapshot. |
| `runs/<run_id>/decisions.jsonl` | same | DecisionRecord audit log | `append_decision_record()` through writer | decisions API, control projection | Stable | control ledger and decisions tests | Must preserve input evidence refs and replay binding. |
| `runs/<run_id>/events.jsonl` | runtime events + control events | Aggregate run event log | `append_event()`, `append_control_event()` | run events API, SSE, cloud sync | Stable | event, run projection, cloud sync tests | `append_jsonl_locked()` assigns sequence for runtime events; control ledger append currently relies on caller payload. |
| `runs/<run_id>/failures/<failure_id>.json` | runtime failure evidence | Failure detail | runtime executor/failure writer | control ledger result refs/debugging | Stable | runtime failure tests | Must stay run-scoped. |

### 3.6 Runtime Workflow Spec Staging

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs/_workflow_function_specs/run-<hash>/root.accflow.json` | Workflows runtime preparation | Runtime snapshot of submitted graph | `prepare_runtime_graph()` | `WorkflowAppService.run_*()` | Stable | `tests/server/test_workbench_core_v2_api.py`, storage GC tests | Hash is based on run dir relative path; do not treat as user-authored template. |
| `runs/_workflow_function_specs/run-<hash>/child-0001.accflow.json` | same | Runtime snapshot of nested child workflows | `runtime_named_workflow_bundle()` | runtime loader | Stable | nested workflow tests | Child names are deterministic per sorted child list. |
| `runs/_workflow_function_specs/run-<hash>/runtime_specs.json` | same | Manifest linking run dir to runtime spec snapshot | `write_runtime_spec_manifest()` | storage GC/index/debugging | Stable | storage GC tests | Contains relative run dir and child map. |
| `runs/_workflow_function_specs/_preflight/root.accflow.json` | preflight virtual path | Not persisted by preflight | none | validation catalog overlay | Internal | workflow API tests | Used only for source path identity during validation. |

### 3.7 Workbench And Session Files

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.acc/tasks/<task_id>/task.json` | `WorkbenchTaskService` | Workbench task state | workbench task API | Workbench task rail, storage index | Evolving | workbench task tests | UI/product state only; not workflow template truth. |
| `.acc/tasks/<task_id>/retention.json` | storage GC / task service | Task retention metadata | GC/task service | storage index/GC | Evolving | storage GC tests | Pinning protects task object. |
| `.acc/sessions/<session_id>/session.json` | `AgentTurnService` | Workbench assistant/session state | agent session service | agent session API, storage index | Evolving | agent session tests | May contain local workspace refs. |
| `.acc/sessions/<session_id>/turns/<turn_id>/events.jsonl` | agent turn service | Agent turn event log | agent task manager/provider | agent stream APIs, run projection | Evolving | agent session tests | SSE projects events; local token may be required for streams. |
| `runs/_agent_sessions/*` | agent session compatibility/run-bound store | Run-bound or legacy agent session state | agent session service | projection, storage index/GC | Compatibility | agent session and GC tests | GC treats as compatibility/internal store. |
| `runs/_workbench_canvas_snapshots/*` | `WorkbenchCanvasSnapshotService` | Canvas snapshot overlay | Workbench snapshot API | `prepare_runtime_graph()` | Evolving | canvas snapshot tests | Snapshot can override execution modes at run submission but is not canonical workflow. |

### 3.8 GraphOps Files

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs/_graphops_proposals/<proposal_id>/proposal.json` | `GraphOpsService` | Proposal state | GraphOps proposal/create/validate/approve/apply/reject | GraphOps APIs, decisions inbox, GC/index | Stable | GraphOps API/v3/governance tests | Proposal is not durable mutation until approved and applied. |
| `runs/_graphops_proposals/<proposal_id>/dry_run_staging/` | GraphOps dry-run | Dry-run materialization only | GraphOps dry-run | review UI, GC | Internal | GraphOps tests, storage GC tests | Must not be treated as applied source of truth. |
| `runs/_graphops_proposals/<proposal_id>/apply_staging/` | GraphOps apply | Apply staging during mutation | GraphOps apply | GraphOps service, GC | Internal | GraphOps tests | Protected while status is `applying`; residual staging is doctor/GC issue. |
| `examples/graphops/*.patch.json` | Legacy demo GraphOps | Example patch input | examples only | legacy validate/dry-run endpoints | Compatibility | GraphOps API tests | Legacy apply is explicitly not implemented. |

### 3.9 Runner Local Product Files

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.acc/runner/runner.json` | `LocalRunnerService` | Local runner identity | `ensure_runner_record()` | runner health/capabilities/cloud registration | Evolving | `tests/server/test_runner_api.py`, cloud sync tests | Contains `project_root`; not cloud-safe unless filtered. |
| `.acc/runner/capabilities.json` | `LocalRunnerService` | Cached runner capabilities projection | `capabilities(write=True)` | cloud registration/product shell | Evolving | runner API tests | Should not include local paths or credentials. |
| `.acc/runner/workspaces.json` | `LocalRunnerService` | Workspace alias bindings | `_ensure_workspaces_file()`, `add_workspace()` | runner job validation, capabilities | Evolving | runner API tests | Contains local absolute paths; normal projection hides them unless `local_debug=true`. |
| `.acc/runner/pairing.json` | `LocalRunnerService` | Pairing/local token state | `_ensure_pairing_file()` | security middleware, health/pairing | Evolving | runner API security tests | Stores `local_token_hash`; raw token only from env or bootstrap, never returned. |
| `.acc/runner/jobs/<job_id>.json` | `LocalRunnerService` | Local runner job receipt | `write_job_receipt()`, `update_job_status()` | runner job APIs | Evolving | runner API tests | `job_id` validated; rejected jobs may not have run evidence. |
| `.acc/runner/bundles/<sha256_digest>.json` | `LocalCloudSyncService` | Cached workflow bundle by digest | external/cache population | cloud intent validation | Evolving | cloud sync tests | Required for `bundle_digest` job intents; missing bundle rejects intent. |
| `.acc/runner/job_receipts/<job_id>.json` | `LocalCloudSyncService` | Local receipt for cloud job intent | `receive_intent()`, `claim_run_for_receipt()`, sync/cancel methods | cloud sync loop | Evolving | `tests/unit/test_cloud_sync.py` | Enforces idempotency key + intent digest; rejected receipts cannot claim run. |
| `.acc/runner/sync_cursors/<run_id>.json` | `LocalCloudSyncService` | Local projection cursor | `save_cursor()` | cloud delta builder | Evolving | cloud sync tests | Cursor detects truncation/rotation gaps; not authoritative run truth. |

### 3.10 Cloud Sync Fake-Control-Plane Files

These files are owned by `FakeCloudControlPlaneService` for protocol tests. They model cloud-side state but are not ACC local runtime evidence.

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<cloud>/runner_registry/<runner_id>.json` | Fake cloud | Cloud paired runner registry | `pair_runner()` | fake cloud tests | Internal/Evolving | `tests/unit/test_cloud_sync.py` | Receives filtered registration payload. |
| `<cloud>/job_intents/<job_id>.json` | Fake cloud | Cloud job intent queue | `create_job_intent()`, lease expiry | `lease_next_job()` | Internal/Evolving | cloud sync tests | Rejects local absolute paths in intent. |
| `<cloud>/job_leases/<job_id>.json` | Fake cloud | Active lease/fencing state | `reissue_lease()`, `heartbeat()` | projection/cancel ingest | Internal/Evolving | cloud sync tests | `fencing_token` enforced with constant-time compare. |
| `<cloud>/run_projections/<runner_id>__<run_id>.json` | Fake cloud | Cloud run summary projection | `ingest_projection_delta()` | fake cloud clients | Internal/Evolving | cloud sync tests | Cloud projection is not local execution truth. |
| `<cloud>/run_event_projections/<runner_id>__<run_id>.json` | Fake cloud | Upserted event projection map | `_upsert_projected_events()` | fake cloud clients | Internal/Evolving | cloud sync tests | Event key combines source id and event key for idempotency. |
| `<cloud>/artifact_manifests/<runner_id>__<run_id>.json` | Fake cloud | Artifact metadata only | `_store_artifact_manifests()` | fake cloud clients | Internal/Evolving | cloud sync tests | Stores manifests, not artifact contents. |
| `<cloud>/cancel_intents/<job_id>.json` | Fake cloud | Cancel request/ack state | `request_cancel()`, `acknowledge_cancel()` | fake cloud sync loop | Internal/Evolving | cloud sync tests | Lease fence required for ack. |

### 3.11 Storage Index, GC, Trash, And Retention

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.acc/index.sqlite` | `acc.storage_index` | Rebuildable inventory index | `rebuild_storage_index()` | storage doctor/GC/product inventory | Evolving | `tests/unit/test_storage_gc.py` | Cache/index only; rows are rebuildable from files. |
| `.acc/gc/plans/<gc_plan_id>/gc_plan.json` | `StorageGCService` | GC dry-run/apply plan | `create_plan(write=True)` | `apply_plan()` | Evolving | storage GC tests | Digest guards apply; actions limited to ACC-owned roots. |
| `.acc/gc/plans/<gc_plan_id>/gc_manifest.json` | `StorageGCService` | GC apply manifest | `apply_plan()` | user/audit | Evolving | storage GC tests | Idempotent if already exists. |
| `.acc/gc/purge_manifests/<purge_id>.json` | `StorageGCService` | Trash purge audit | `purge_expired_trash()` | user/audit | Evolving | storage GC tests | Purge only under `.acc/trash`. |
| `.acc/trash/<trash_id>/trash_entry.json` | `StorageGCService` | Trash entry metadata | `apply_plan()` | purge/index | Evolving | storage GC tests | Move targets must be under `runs/` or `.acc/`, never storage roots themselves. |
| `.acc/tombstones/<object_ref>.json` | `StorageGCService` | Non-run tombstone metadata | `apply_plan()` | audit/index | Evolving | storage GC tests | Filename is sanitized from object ref. |

## 4. Event And Manifest Semantics

### 4.1 JSONL Event Contract

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime event payload | `acc.runtime.io` | EventRecord JSON object | `append_event()` | run event projection, cloud sync | Stable | `tests/unit/test_events.py`, run projection tests | `append_jsonl_locked()` sets monotonic `sequence` if missing. |
| Control event payload | `acc.store.control_ledger` | ControlEventRecord JSON object | `append_control_event()` | control projection, events API | Stable | control ledger tests | Validated by `parse_control_event_record()` before append. |
| Agent turn event payload | `acc.app.agent_sessions` | provider/agent event JSONL | agent turn manager | agent stream, run projection | Evolving | agent session tests | Projection normalizes to live events; malformed lines are tolerated in some readers. |
| Cloud projection event payload | `acc.cloud_sync` | Redacted event delta | `read_jsonl_projection_delta()` | fake cloud ingestion | Evolving | cloud sync tests | Local paths are redacted; truncation/rotation sets sync gap. |

### 4.2 Schema Version Constants

| Contract | Owner | Source of truth | Writer | Reader | Stability | Tests | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `storage.v1` | `acc.storage.STORAGE_VERSION` | `.acc-run-marker.json` | `write_run_marker()` | storage assertions/index | Stable | storage tests | Version marks ACC-owned run storage. |
| `acc.runner.v1` | `acc.runner.RUNNER_SCHEMA_VERSION` | `.acc/runner/runner.json` | runner service | runner/cloud | Evolving | runner tests | Includes local `project_root`. |
| `acc.runner.capabilities.v1` | runner service | capabilities projection | runner service | product/cloud | Evolving | runner tests | Must filter local-only sensitive data. |
| `acc.runner.workspaces.v1` | runner service | workspace alias file/projection | runner service | runner validation | Evolving | runner tests | Local paths hidden unless debug. |
| `acc.runner.pairing.v1` | runner service | pairing/token hash file | runner service | security middleware | Evolving | runner tests | Do not expose token hash in public projection unless explicitly needed. |
| `acc.runner.job.v1` | runner service | local job receipt | runner service | job APIs | Evolving | runner tests | Job may be rejected without run evidence. |
| `acc.runner.run_projection.v1` | runner service | run projection response | none | product/cloud | Evolving | runner tests | Default projection hides absolute debug paths. |
| `acc.cloud.job_intent.v1` | cloud sync | cloud job intent | fake cloud/external cloud | local cloud sync | Evolving | cloud sync tests | Reject local absolute paths and dangerous permissions. |
| `acc.cloud.job_receipt.v1` | local cloud sync | local cloud receipt | local cloud sync | sync loop | Evolving | cloud sync tests | Idempotency digest required. |
| `acc.cloud.job_lease.v1` | fake cloud | lease/fencing record | fake cloud | heartbeat/ingest/cancel | Evolving | cloud sync tests | Fencing token blocks stale writers. |
| `acc.cloud.event_cursor.v1` | cloud sync | event sync cursor | local cloud sync | delta builder | Evolving | cloud sync tests | Detects truncation/rotation. |
| `acc.cloud.run_projection_delta.v1` | cloud sync | projected run delta | local cloud sync | fake cloud | Evolving | cloud sync tests | Redacted projection, not durable run truth. |
| `acc.cloud.artifact_manifest.v1` | cloud sync | artifact metadata | local/fake cloud | cloud UI | Evolving | cloud sync tests | Does not upload content by default. |
| `acc.cloud.runner_registration.v1` | cloud sync | runner registration payload | local cloud sync | fake cloud | Evolving | cloud sync tests | Must omit local-only fields. |

## 5. Cross-Cutting Safety Contracts

### 5.1 Path And ID Validation

| Contract | Enforced by | Affects | Rule |
| --- | --- | --- | --- |
| `run_id` | `acc.storage.validate_run_id()` | runs API, runner jobs, cloud sync, refs | Must match `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`, not `_`-prefixed, no drive/root/path separators. |
| legacy `run_dir` | `parse_legacy_run_dir()` | workflow run API | Only exact `runs/<run_id>` accepted. |
| artifact refs | `acc.storage_refs.parse_artifact_ref()` | artifact read/preview/list | Must be registered versioned or legacy run artifact ref; raw project paths denied. |
| object refs | `make_object_ref()`, `parse_object_ref()` | storage index/GC | `kind:v1:object_id` preferred; legacy `kind:object_id` readable. |
| workflow save path | `workflow_storage_path()` | create/update workflow | Must end with `.accflow.json` and remain inside workflows dir. |
| binding path | `resolve_binding_path()`, runner `resolve_binding_ref()` | workflow run/runner job | Must remain inside `bindings/`. |
| local workspace alias | `validate_alias()` | runner workspaces/jobs | Alnum plus `_`, `-`, `.` normalized check; unknown aliases reject job. |
| job id | `validate_job_id()` | runner/cloud jobs | Must start with `job_` and contain safe alnum/underscore/hyphen suffix. |

### 5.2 Local Auth And Origin Gate

| Contract | Owner | Applies to | Rule |
| --- | --- | --- | --- |
| `x-acc-local-token` / `Authorization: Bearer` | `acc.server.security`, `acc.runner` | mutating endpoints, artifact read/preview, SSE streams, directory picker/open-folder | Required when `ACC_LOCAL_RUNNER_REQUIRE_TOKEN=1`, `ACC_SECURITY_MODE` is `product_local_exe` / `paired_cloud_runner`, or `ACC_LOCAL_RUNNER_TOKEN` is set. |
| Allowed origins | `allowed_origins()` | all requests when token mode enabled | Defaults: localhost/127.0.0.1 Vite/3000, `tauri://localhost`, `app://acc`; env can add more. |
| Debug local paths | runner route guard | `local_debug=true` projections | Requires valid local token. |

### 5.3 Artifact Exposure Policy

| Contract | Owner | Rule |
| --- | --- | --- |
| Registered refs only | `resolve_registered_artifact_reference()` | Artifact content/preview must resolve through claimed run evidence and `RunSummary.artifact_dir` / `NodeRunSummary.artifact_dir`. |
| Claimed run required | `assert_acc_run_dir()` | Artifact resolution rejects folders without `.acc-run-marker.json`. |
| Secret-like names denied | `reject_secret_like_path()` | Exact names like `.env`, `credentials.json`, `stdout.log`, `stderr.log`, and substrings like `token`, `secret`, `password` are denied or filtered. |
| Text read limit | `MAX_ARTIFACT_READ_BYTES` | `/api/artifacts/read` rejects files larger than 1 MB. |
| UTF-8 only | `read_artifact_payload()` | Non-UTF-8 artifact content gets 415. |
| Cloud manifest content policy | `build_artifact_manifests()` | Cloud sync emits path/hash/size/mime/availability; it skips secret-like paths and does not upload content by default. |

## 6. Verification Index

Use these tests as the first line of defense when a contract in this appendix changes:

| Area | Primary tests |
| --- | --- |
| Storage run id, marker, JSONL, artifact refs | `tests/unit/test_storage.py` |
| Run index and summary fallback | `tests/unit/test_run_index.py` |
| Storage GC/index/trash | `tests/unit/test_storage_gc.py` |
| Workflow API and `.accflow.json` save/run behavior | `tests/server/test_workbench_core_v2_api.py`, `tests/server/test_workflows_storage_contract.py` |
| Run projection/events/logs | `tests/server/test_runs_projection_api.py`, `tests/server/test_run_projection_api.py`, `tests/unit/test_run_projection.py` |
| Control ledger files and APIs | `tests/unit/test_control_ledger_store.py`, `tests/unit/test_control_ledger_domain.py`, `tests/server/test_control_ledger_api.py` |
| Artifact read policy | `tests/server/test_artifacts_api.py`, `tests/unit/test_mcp_server.py` |
| Runner product APIs/security | `tests/server/test_runner_api.py` |
| Cloud sync protocol | `tests/unit/test_cloud_sync.py` |
| GraphOps proposals/governance | `tests/server/test_graphops_api.py`, `tests/unit/test_graphops_v3.py`, `tests/unit/test_graphops_governance.py`, `tests/unit/test_graphops_operation_handlers.py` |
| Workbench tasks/canvas snapshots | `tests/server/test_workbench_canvas_snapshots_api.py` |
| Agent sessions and turn streams | `tests/server/test_agent_sessions_api.py` |
| Decisions inbox | `tests/server/test_decisions_api.py` |
| Runtime policy/hermetic mode | `tests/unit/test_runtime_policy.py` |

Recommended default verification after contract edits:

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
```

Recommended server/API focused verification:

```bash
python -m pytest -q tests/server
```

Recommended productization/storage focused subset:

```bash
python -m pytest -q tests/unit/test_storage.py tests/unit/test_storage_gc.py tests/unit/test_cloud_sync.py tests/server/test_runner_api.py tests/server/test_artifacts_api.py
```

## 7. Change Rules

1. If an endpoint starts writing durable files, update both the endpoint table and the file contract table.
2. If a file moves from projection/cache to source of truth, update its stability label and add tests that prove rebuild/fallback behavior.
3. If a new path accepts user input, define the validator first. Do not rely on string concatenation.
4. If cloud sync starts uploading artifact content, this appendix must be updated with the content policy, redaction policy, and opt-in gate.
5. If Workbench stores new state, specify whether it is UI/product state or runtime/template truth.
6. If GraphOps gains a new operation type, add its target file contracts and approval/dry-run evidence paths here.
