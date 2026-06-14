# ACC SDD 06: Verification And Delivery

## 1. Purpose

本文件定义 ACC 的验证策略和交付标准。

它不是测试清单的简单罗列，而是把前面 SDD 板块中的架构承诺转成可执行、可追踪、可复验的检查：

- `Template != runtime state` 是否仍然成立。
- Core v2 callable-only runtime 是否仍然是唯一生产执行路径。
- run evidence 是否仍然是事实源。
- Workbench 是否仍然只是交互投影。
- GraphOps 是否仍然是受控 mutation path。
- 默认测试是否仍然 hermetic。
- CLI/API/Workbench/runner/cloud sync 的输出是否可被机器和人稳定消费。

第一性原理判断：ACC 的核心产品不是“能跑一次 agent”，而是“把一次 agent/tool/workflow 调用变成可组合、可审计、可恢复、可交付的本地证据”。因此验证重点必须放在边界、证据、状态迁移和失败路径上，而不是只看 happy path。

## 2. Verification Model

ACC 验证分为六层。

| 层级 | 目标 | 主要证据 |
| --- | --- | --- |
| Domain / schema | 类型、序列化、validation 不允许旧模型或运行态字段混进模板 | `tests/unit/test_callable_domain.py`, `tests/unit/test_core_v2_*.py` |
| Pure architecture | 纯层不做 IO、不依赖 runtime/server/UI，不复活旧 runtime | `tests/architecture/`, `tests/test_no_domain_import.py`, `tests/test_runtime_imports.py` |
| Runtime evidence | 一次 run 能生成完整 evidence，失败也有可解释证据 | `tests/integration/test_core_v2_workflow_*.py`, `tests/unit/test_persistence_*.py` |
| Governance | GraphOps、human gate、decision、handoff、supervisor 都不能绕过审批和审计 | `tests/unit/test_graphops*.py`, `tests/server/test_graphops_api.py`, `tests/unit/test_human_gate.py` |
| Interface contract | CLI/API/MCP/Workbench/runner 只暴露投影，不伪造事实源，不泄漏本地敏感路径 | `tests/server/`, `tests/integration/test_cli_*.py`, `tests/unit/test_mcp_server.py`, `web/src/*.test.*` |
| Delivery | 默认检查可在无外部 agent、无网络、无付费服务条件下复现 | `pyproject.toml`, `web/package.json`, `tests/conftest.py` |

默认验证必须优先覆盖 hermetic 层。真实 Codex、Claude、Cursor、Gemini、Hermes、网络和付费服务只能作为显式 opt-in smoke，不能成为默认交付门禁。

## 3. Default Hermetic Checks

后端默认检查：

```bash
python -m pytest -q --ignore=tests/integration --ignore=tests/server
uv run pytest -q
uv run ruff check .
```

说明：

- `python -m pytest -q --ignore=tests/integration --ignore=tests/server` 是最低成本的本地快速检查，适合只验证 unit/architecture/smoke。
- `uv run pytest -q` 是完整 Python 默认检查。仓库的 `pyproject.toml` 将 `testpaths` 固定为 `tests`，并声明了 `unit`、`integration`、`migration`、`e2e` 等 markers。
- `uv run ruff check .` 是 Python lint 门禁。`pyproject.toml` 当前选择 `E`, `F`, `I`, `UP`, `B`, `SIM`，行宽 100，目标 Python 3.11。

前端默认检查：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

说明：

- `web/package.json` 中 `npm run build` 实际执行 `tsc -b && vite build`。
- `npm run test -- --run` 走 Vitest。当前测试覆盖 `App.test.tsx`、`WorkflowViewer.drag.test.tsx`、`runTranscript.test.ts` 等 Workbench 行为。
- `npm run test:e2e` 当前通过 `node scripts/browser-e2e.mjs` 执行，属于浏览器级验证。除非交付目标明确要求 UI e2e，否则不作为最小后端交付门禁。

默认 hermetic 约束：

- 不要求真实外部 agent。
- 不要求网络。
- 不要求云服务。
- 不要求本机已登录 Codex/Claude/Cursor/Gemini/Hermes。
- 不依赖不可复现的本地全局状态。
- 若测试需要模拟外部 provider，必须用 fake process、stub adapter、temporary project root 或 monkeypatch。

`tests/conftest.py` 已将默认 `ACC_RUN_MODE` 设置为 `hermetic`，并说明测试使用 in-process fake Core v2 callable refs，不 spawn 真实 subprocess、不需要外部 agent。

## 4. Backend Test Matrix

| 验证对象 | 必须证明 | 现有测试依据 |
| --- | --- | --- |
| Core v2 domain model | `AgentClassTemplate` / `ToolClassTemplate` / `WorkflowFunctionTemplate` 是 reusable stateless definition；`FunctionInvocation` / `ScopeFrame` / `SessionInstance` 才保存 runtime state | `tests/unit/test_callable_domain.py` |
| Core v2 loader / parser | `.accflow.json` 解析到 `WorkflowFunctionTemplate`；legacy node fields 和 path-like callable id 被拒绝 | `tests/unit/test_core_v2_loader.py`, `tests/unit/test_legacy_graph_rejected.py` |
| Core v2 validation | 缺失 callable ref、legacy callable kind、非法 binding、artifact path escape、非法 permission profile、非法 workflow output binding 被拒绝 | `tests/unit/test_core_v2_validation.py` |
| Serialization | Core v2 dataclass 可 round-trip，字段语义不漂移 | `tests/unit/test_core_v2_serialization.py` |
| Ports / output schema | port contract、output schema、workflow call boundary bindings 被验证 | `tests/unit/test_core_v2_output_schema_and_ports.py` |
| Execution plan | control dependency、topological levels、cycle/duplicate/missing node 等 planning 规则稳定 | `tests/unit/test_core_v2_execution_plan.py`, `tests/unit/test_scheduler_ready_set.py` |
| Callable registry | callable discovery 只暴露已发现模板和 hermetic callable set；保存 agent callable 时验证 id 和 overwrite 规则 | `tests/unit/test_callable_registry_core_v2.py` |
| Runtime imports | `acc.app.core_v2_runtime` 只是兼容 thin shim；runtime 拆分模块 public symbols 可导入 | `tests/test_runtime_imports.py` |
| Runtime run path | Core v2 workflow 能运行，生成 run summary、node evidence、nested workflow evidence、bindings、workflow outputs | `tests/integration/test_core_v2_workflow_run.py`, `tests/integration/test_core_v2_workflow_bindings.py`, `tests/integration/test_core_v2_workflow_artifacts.py` |
| Runtime failure | node failed、schema failure、artifact failure、external gate failure 都写入 stderr/failure evidence，并产生 terminal status | `tests/integration/test_core_v2_workflow_failure.py`, `tests/integration/test_core_v2_workflow_run.py` |
| Control ledger runtime | `FixedRunControlLedgerWriter` 写 plan/step/dispatch/decision evidence；nested workflow 和 dynamic dispatch 仍走 Core v2 path | `tests/integration/test_core_v2_control_ledger_runtime.py` |
| Supervisor / handoff | supervisor plan 必须 approved 后才能执行；handoff target 必须在 outgoing edge 或 approved roster target 内 | `tests/unit/test_supervisor_validation.py`, `tests/integration/test_supervisor_planstep_p0.py`, `tests/unit/test_handoff_validation.py`, `tests/integration/test_handoff_p0.py` |
| Human gate / interactions | approval answer 只能选声明选项；answer 后 run summary 和 resume path 可恢复 | `tests/unit/test_human_gate.py`, `tests/server/test_run_interactions_lifecycle.py`, `tests/unit/test_wakeup_queue.py` |
| Persistence events | JSONL event append、sequence、sanitization、event layering 可复验 | `tests/unit/test_persistence_events.py`, `tests/unit/test_event_log_layering.py`, `tests/unit/test_events.py` |
| Result store / artifacts | result store、artifact manifest、artifact store、node summary 能稳定投影 | `tests/unit/test_result_store_filesystem.py`, `tests/unit/test_artifact_store.py`, `tests/unit/test_artifact_manifest_v2.py`, `tests/unit/test_node_run_summary.py` |
| Storage safety | run dir claim、ACC marker、atomic writes、locked JSONL append、artifact ref parser、GC retention 和 protected GraphOps staging | `tests/unit/test_storage.py`, `tests/unit/test_storage_gc.py`, `tests/server/test_workflows_storage_contract.py` |
| Runtime policy | hermetic/production mode、external agent gate、permission profile、timeout env parsing 稳定 | `tests/unit/test_runtime_policy.py`, `tests/unit/test_callable_runner_timeout.py` |
| External adapters under test | `generic_cli`、`codex_cli`、`codex_app_server` 用 fake process 验证 stdout/stderr/cancel/timeout/output salvage，不要求真实 provider | `tests/unit/test_generic_cli_adapter.py`, `tests/unit/test_codex_cli_adapter.py`, `tests/unit/test_codex_app_server_adapter.py` |

## 5. Server/API Test Matrix

| API 面 | 必须证明 | 现有测试依据 |
| --- | --- | --- |
| App wiring | `create_app()` 注册 health、agent sessions、authoring、callables、runs、interactions、runner、artifacts、workbench、workflows、debugger、graphops、decisions 等路由 | `tests/server/test_health.py`, `acc/server/app.py` |
| Workbench workflow save/run | Workbench draft 保存为 Core v2 canonical payload；`/api/workflows/run-graph/submit` 拒绝 legacy graph；同步 `/run-graph` 保持兼容 | `tests/server/test_workbench_core_v2_api.py` |
| Async run manager | submit/cancel/status summary 以 `run_id + task_id` 区分，队列/运行/等待/失败状态写入 summary | `tests/unit/test_workbench_run_manager.py`, `tests/server/test_runs_projection_api.py` |
| Run projection | `/api/runs/{run_id}`、node projection、events、logs、artifacts URL 都从 evidence 投影，不制造新事实 | `tests/server/test_run_projection_api.py`, `tests/server/test_run_log_projection_api.py`, `tests/server/test_runs_projection_api.py`, `tests/unit/test_run_projection.py`, `tests/unit/test_server_run_projection.py` |
| Control ledger API | plan/steps/dispatches/decisions/control-ledger endpoint 能读取 ledger evidence，并投影 `events_ref` | `tests/server/test_control_ledger_api.py` |
| Artifact API | 只接受 artifact ref authority；拒绝 raw project path、path traversal、secret-like file；missing 返回 404 | `tests/server/test_artifacts_api.py`, `tests/unit/test_mcp_server.py` |
| GraphOps API | proposal create、validate、dry-run、approve、apply、reject 状态流稳定；legacy patch apply 不可用或必须 human approved | `tests/server/test_graphops_api.py` |
| Authoring API | authoring session 能产生 proposal/evidence；validate/dry-run 不写 resource；temporary resource 需要 persistence approval | `tests/server/test_authoring_api.py` |
| Agent sessions API | async turn、SSE、messages、publish output、failure projection、assistant draft validation 有稳定行为 | `tests/server/test_agent_sessions_api.py` |
| Workbench task/canvas snapshots | task 和 canvas snapshot CRUD 不混入 runtime truth；task pointer 只是 convenience state | `tests/server/test_workbench_canvas_snapshots_api.py` |
| Decisions API | decisions 聚合可包含/排除 graphops/events，保持投影属性 | `tests/server/test_decisions_api.py` |
| Runner API | mutating API 默认需要 local runner token；capabilities/workspaces 不泄漏绝对路径；unsupported provider 在写 run evidence 前拒绝 | `tests/server/test_runner_api.py` |

## 6. Frontend / Workbench Test Matrix

| Workbench 能力 | 必须证明 | 现有测试依据 |
| --- | --- | --- |
| Run list / inspector | UI 能从 ACC server API 渲染 run、node、artifact、events，不直接制造 runtime facts | `web/src/App.test.tsx` |
| Artifact viewer | markdown/json artifact 通过 artifact API 展示 | `web/src/App.test.tsx` |
| Graph-first builder | workflow builder 以 canvas 为主编辑面；保存/validate/run 走 API | `web/src/App.test.tsx`, `web/src/components/WorkflowViewer.drag.test.tsx` |
| Task persistence | task list 跨导航保留；completed task 切回后恢复 previous run state | `web/src/App.test.tsx` |
| Multi-run projection | live events、nested workflow node status、node scoped run evidence 按 run/node identity 匹配 | `web/src/App.test.tsx`, `web/src/components/WorkflowViewer.drag.test.tsx` |
| Authoring proposal | CanvasAuthoringProposal 支持节点/容器/边修改；拒绝 stale canvas hash、重复 id、非法端点、cycle | `web/src/components/WorkflowViewer.drag.test.tsx` |
| Temporary resource safety | temporary agent stays canvas-local，并阻塞 save/validate/run，直到 GraphOps persistence approval | `web/src/App.test.tsx`, `web/src/components/WorkflowViewer.drag.test.tsx` |
| GraphOps UI flow | Workbench 能展示 GraphOps dry-run/approval/apply 的安全流 | `web/src/App.test.tsx` |
| Prompt/input separation | invocation user prompt 与 static input 分离，不把 output.json 当 invocation 配置 | `web/src/App.test.tsx`, `web/src/components/WorkflowViewer.drag.test.tsx` |
| Transcript projection | provider raw stdout 不进入默认语义输出；tool events、assistant text、failure summary 分层展示 | `web/src/lib/runTranscript.test.ts`, `web/src/App.test.tsx` |
| Canvas interaction | control/data edge 手势、drag/reparent、layout、scope selection 不破坏 workflow semantics | `web/src/components/WorkflowViewer.drag.test.tsx` |

注意：当前 `web/src/components/WorkflowViewer.tsx` 仍包含大量逻辑。测试矩阵必须持续覆盖 scoped graph editing、nested workflow projection、AI proposal、runtime evidence projection，防止后续拆分或重构时把 UI convenience state 错写成 durable truth。

## 7. CLI / MCP / Machine-Readable Contract

CLI 交付标准：

- `acc run ... --emit-conductor-json` / `--emit-json` 的 stdout 必须只包含一个 JSON object。
- logs、error summary、human-readable diagnostics 必须进入 stderr。
- 失败时如果 promise 是机器可读输出，则不能把 traceback 或普通日志混入 stdout。
- CLI 不应直接导入具体 runtime runner 实现形成层级倒挂。

现有依据：

- `AGENTS.md` 明确要求 CLI machine-readable output。
- `docs/CURRENT_ARCHITECTURE.md` 要求 machine-readable CLI checks 证明 stdout 单 JSON object。
- `tests/integration/test_core_v2_workflow_cli.py` 验证 `--emit-json` stdout 可 `json.loads`，stderr 为空，并检查 stdout 首尾为 `{}`。
- `tests/integration/test_core_v2_capsule_cli_rejection.py` 验证 legacy runtime asset 被拒绝时 stdout 为空、stderr 有错误信息。
- `tests/integration/test_cli_runs.py` 验证 `runs list --json` 和 `runs show --json` 可被 `json.loads`。
- `tests/integration/test_cli_list_show_validate.py` 验证旧 top-level commands 被移除，Core v2 callable command surface 使用新入口。
- `tests/architecture/test_import_boundaries.py` 覆盖 CLI 不导入 concrete runtime runners 的边界。

MCP 交付标准：

- MCP 可以读 artifact、validate canvas proposal、创建/validate/dry-run GraphOps proposal。
- MCP 不能直接暴露 human approval 或 apply approved GraphOps proposal 这类绕过用户治理的危险工具。
- MCP artifact read 必须复用 artifact policy，拒绝 secret-like path。

现有依据：

- `tests/unit/test_mcp_server.py` 覆盖 artifact secret rejection、canvas proposal validation、GraphOps create/validate/dry-run、temporary resource promotion dry-run。
- `tests/unit/test_mcp_server.py` 明确断言 MCP tools 中没有 `acc_request_human_approval` 和 `acc_apply_approved_graphops_proposal`。

## 8. Evidence And File Contract Acceptance

一次 Core v2 workflow run 被认为可交付，至少应满足：

```text
runs/<run_id>/
  .acc-run-marker.json
  run_record.json
  run_summary.json
  function_invocation.json
  scope_frame.json
  events.jsonl
  result_store/
  workflow_outputs/<port>/output.json
  nodes/<node_id>/
    input.json
    output.json
    runtime_payload.json
    binding_manifest.json
    events.jsonl
    stdout.log / stderr.log 或兼容 stdout.txt / stderr.txt
    session_instance_manifest.json
    artifact_bundle.json
```

文件集可以 additive growth，但不能违反以下规则：

- `.acc-run-marker.json` 是 ACC ownership marker。没有 marker 的非空目录不得被运行路径覆盖。
- `run_record.json`、`run_summary.json`、`events.jsonl` 是运行事实或事实投影，不由 Workbench 随意改写。
- node runtime payload 可以保存内部 hash/provenance，但 server/Workbench projection 必须过滤 runtime-only 或 secret-like 字段。
- downstream 输入只能来自 explicit binding、inbox/outbox materialization、result store 或 artifact ref，不能让 upstream 直接写 downstream workspace。
- artifact 读取必须通过 artifact ref authority，不接受任意 raw project path。
- path traversal、secret-like artifact、absolute cloud workspace path 必须拒绝。
- nested workflow 的 child evidence 必须能从 parent node evidence 追踪。

验收测试依据：

- run dir marker 和 duplicate run id：`tests/unit/test_storage.py`, `tests/server/test_workflows_storage_contract.py`。
- JSONL append 和 event sequence：`tests/unit/test_storage.py`, `tests/unit/test_persistence_events.py`。
- projection 过滤 runtime-only keys：`tests/unit/test_run_projection.py`, `tests/unit/test_server_run_projection.py`。
- artifact API policy：`tests/server/test_artifacts_api.py`。
- nested workflow evidence：`tests/integration/test_core_v2_workflow_run.py`, `tests/integration/test_core_v2_workflow_bindings.py`。
- storage GC：`tests/unit/test_storage_gc.py`。

## 9. Architecture Invariant Acceptance

以下不变量必须在每次架构级变更后复验。

| 不变量 | 失败信号 | 验证方式 |
| --- | --- | --- |
| `acc.models`, `acc.engine`, `acc.state_machine` 保持纯逻辑 | 出现 filesystem IO、subprocess、FastAPI、Typer、React/UI 依赖 | `tests/architecture/test_import_boundaries.py`, `tests/test_no_domain_import.py` |
| Core v2 callable-only | runtime path 接受 legacy `*.graph.json` 或旧 raw node semantics | `tests/unit/test_legacy_graph_rejected.py`, `tests/integration/test_core_v2_capsule_cli_rejection.py` |
| Template 不存 runtime state | template 字段出现 `run_id`、`session_id`、workspace binding、conversation memory | `tests/unit/test_callable_domain.py`, `tests/unit/test_core_v2_loader.py` |
| Workbench 不是事实源 | UI stores 写 terminal status、node output、runtime evidence 到 template semantics | `web/src/App.test.tsx`, `web/src/components/WorkflowViewer.drag.test.tsx`, server projection tests |
| GraphOps 是受控 mutation path | runtime/orchestrator 调用 `apply`，MCP 暴露直接 apply/human approval，proposal 未 dry-run 直接 apply | `tests/unit/test_graphops_governance.py`, `tests/unit/test_mcp_server.py`, `tests/server/test_graphops_api.py` |
| Explicit data movement | downstream workspace 被 upstream 直接写入，binding manifest 缺失 | `tests/integration/test_core_v2_workflow_bindings.py`, `tests/integration/test_core_v2_workflow_run.py` |
| Status vocabulary canonical | 新增非规范 terminal status，server/UI 投影不一致 | `tests/unit/test_run_lifecycle.py`, `tests/server/test_runs_projection_api.py`, Workbench tests |
| Centralized helpers | 新增 ad hoc JSON writer/path copy/schema validation，绕过 `acc.utils`/`acc.store`/storage helpers | code review + architecture tests；必要时新增 static test |

## 10. Runner And Cloud Sync Acceptance

Runner/cloud sync 是产品化接入层，不应改变 Core v2 内核事实源。

Runner 必须证明：

- `GET /api/runner/capabilities` 和 workspace listing 不泄漏本地绝对路径。
- mutating API 默认要求 local runner token 和允许的 origin。
- pairing file 不保存 plaintext local token。
- unsupported provider 在创建 run evidence 前拒绝。
- job receipt 可以返回 `job_id`、`run_id`、status，但不能把 queue handle 当 durable run fact。
- artifact preview 只接受 registered artifact ref 或 versioned artifact ref，拒绝 raw project path。

现有依据：`tests/server/test_runner_api.py`。

Cloud sync 必须证明：

- duplicate job delivery idempotent。
- 同一 idempotency key 搭配不同 digest 会 conflict。
- validation failure 只创建 receipt，不创建 run directory。
- cloud job 拒绝 local absolute workspace path。
- lease fencing 拒绝 stale heartbeat/upload/cancel ack。
- projection replay 支持 cursor resume，gap 会报告 `sync_gap_detected`。
- artifact manifest 不上传内容，也不上传 secret-like names。
- cloud lease timeout 是 unconfirmed，不应伪造成 local failed。

现有依据：`tests/unit/test_cloud_sync.py`。

交付判断：runner/cloud sync 可以作为 productization spec 的一部分交付，但不能成为 Core v2 默认 runtime 的前置依赖。默认测试可以覆盖它们的纯本地逻辑和 server policy；真实云端同步必须 opt-in。

## 11. External Smoke Tests

以下检查只允许作为显式 opt-in，不能进入默认 CI 或默认交付门禁：

- 真实 `codex_cli` 调用。
- 真实 Codex app-server JSON-RPC 会话。
- 真实 Claude/Cursor/Gemini/Hermes provider。
- 需要公网访问的 workflow。
- 需要真实用户账号、浏览器 profile、API key 或付费额度的测试。
- 真实 cloud sync server 对接。
- 长时间 browser e2e / visual QA，除非当前交付目标是 Workbench UI release。

如果需要执行 external smoke，必须满足：

```text
1. 明确环境变量开关，例如 ACC_RUN_MODE=production 和 ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1。
2. 明确 provider、账号、网络、权限、费用风险。
3. 输出独立 smoke report，不覆盖 hermetic test report。
4. 不把真实 provider 输出作为 deterministic assertion。
5. 不要求开发者默认拥有同样外部环境。
```

建议 smoke report 记录：

```json
{
  "schema_version": "acc.delivery.smoke_report.v1",
  "smoke_id": "codex_cli_real_provider_YYYYMMDD",
  "run_at": "ISO-8601 timestamp",
  "operator": "human or CI identity",
  "environment": {
    "acc_run_mode": "production",
    "external_agent_execution_enabled": true,
    "provider": "codex_cli"
  },
  "scope": ["workflow run", "artifact read", "run projection"],
  "result": "passed | failed | inconclusive",
  "evidence_refs": ["runs/<run_id>/run_summary.json"],
  "notes": ""
}
```

## 12. Delivery Gate

一次 ACC 交付至少要包含：

1. 变更说明：目标、修改范围、影响模块、是否触碰 runtime evidence / GraphOps / Workbench。
2. 风险说明：破坏哪些不变量的风险、失败路径、是否有 migration/compatibility 影响。
3. 验证说明：实际运行的命令、结果、未运行的检查和原因。
4. Evidence 样本：如果变更影响 runtime，必须提供 run dir 或测试生成 evidence 的路径/断言。
5. API/CLI 合约确认：如果变更影响 interface，必须确认 machine-readable output 和错误格式。
6. SDD 回写：如果代码事实改变了 SDD 的约束或接口，必须回写对应 `docs/sdd/*.md`。

最小交付记录格式：

```markdown
## Delivery Record

- Change ID:
- Date:
- Owner:
- Scope:
- SDD sections affected:
- Code areas touched:
- Commands run:
- Results:
- Evidence refs:
- External smoke:
- Known gaps:
- Follow-up tasks:
```

示例：

```markdown
## Delivery Record

- Change ID: acc-runtime-binding-manifest-2026-06-14
- Date: 2026-06-14
- Owner: local
- Scope: Runtime evidence
- SDD sections affected: 03-runtime-and-evidence, 06-verification-and-delivery
- Code areas touched: acc/app/runtime/executor.py, tests/integration/test_core_v2_workflow_bindings.py
- Commands run: uv run pytest -q tests/integration/test_core_v2_workflow_bindings.py
- Results: passed
- Evidence refs: tmp test run asserts nodes/<node_id>/binding_manifest.json
- External smoke: not run; not required
- Known gaps: no real external provider smoke
- Follow-up tasks: none
```

## 13. Coverage Gaps And Review Triggers

当前测试覆盖已经覆盖大部分架构承诺，但以下情况必须触发补测或 SDD 回写：

- 新增可持久化文件格式。
- 新增 run status、event type、GraphOps proposal status。
- 修改 `.accflow.json` canonical schema。
- 修改 `run_record.json`、`run_summary.json`、`events.jsonl`、`artifact_bundle.json` 语义。
- 修改 Workbench task state 与 run projection 的关系。
- 修改 runner/cloud sync 安全策略。
- 新增 MCP tool，尤其是会 mutation 或 approval 的工具。
- 新增外部 agent adapter。
- 修改 CLI `--emit-json` 或 `--emit-conductor-json` 输出。
- 删除或重命名 tests 中已有的 contract test。
- 引入数据库、云后端、长期后台服务或非本地 first 依赖。

审查原则：如果一个变更不能说明“输入是什么、状态怎么变、输出落在哪里、失败证据在哪里、如何复验”，则不能视为可交付。
