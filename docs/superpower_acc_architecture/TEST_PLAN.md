# ACC Superpower Architecture TEST_PLAN

生成日期: 2026-06-21

## Philosophy

测试必须服务于架构不变量，而不是只证明现有实现还能跑。默认 hermetic，不依赖真实 Claude/Codex/Cursor/Gemini、网络、浏览器凭证、云服务或付费服务。

## 1. Documentation / Authority Tests

Checks:

- `AGENTS.md`、`README.md`、`docs/README.md`、`docs/CURRENT_ARCHITECTURE.md` 引用的 active architecture docs 全部存在。
- `docs/historical/*` 不作为 active requirement 被引用。
- Superpower package 中的 implementation order 与 active architecture docs 不冲突。

Suggested command:

```bash
uv run pytest -q tests/test_runtime_imports.py
```

## 2. Stateless Definition Tests

Cases:

- template metadata contains `run_id` -> fail；
- template metadata contains `run_dir` -> fail；
- template metadata contains `provider_session_id` -> fail；
- node metadata contains `previous_outputs` -> fail；
- callable override contains `conversation_memory` -> fail；
- valid descriptive metadata -> pass；
- runtime policy typed fields -> pass。

Suggested files:

- `tests/unit/test_callable_domain.py`
- `tests/unit/test_callable_schema.py`

## 3. Explicit Dataflow Tests

Cases:

- control edge without data edge does not forward predecessor output；
- `main` input requires explicit binding or workflow input；
- multi-predecessor aggregate is rejected unless declared as aggregate binding；
- supervisor snapshot becomes explicit snapshot input object；
- handoff payload is represented as explicit context/result ref；
- binding manifest accounts for every payload key。

Suggested files:

- `tests/unit/test_callable_engine_validation.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_handoff_p0.py`

## 4. Runtime Kernel Tests

Cases:

- run creates `FunctionInvocation` and `ScopeFrame` through repository/recorder；
- node execution returns `NodeExecutionResult`；
- scheduler aggregates output refs after task completion；
- cancellation does not corrupt output aggregation；
- human gate waiting leaves run non-terminal；
- resume uses same scheduler driver, not separate mini-orchestrator。

Suggested files:

- `tests/integration/test_function_invocation_manifests.py`
- `tests/integration/test_session_instance_manifests.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`

## 5. Control Mode Tests

### Fixed Workflow

- static DAG runs through common scheduler；
- bounded concurrency obeys `max_concurrency`；
- nested workflow uses child invocation/scope and explicit return binding。

### Supervisor

- supervisor plan compiles to PlanSteps/DecisionRecords only；
- supervisor cannot directly invoke agent/tool；
- supervisor dynamic input uses explicit binding/snapshot ref；
- replay uses recorded decisions。

### Handoff

- illegal target/mode rejected；
- `new_session` and `route_only` use typed policy；
- resume/human approval modes are either implemented or explicitly rejected with evidence；
- receiving node does not see prior provider topology.

### Human Gate

- approval writes decision record；
- rejection writes terminal/blocked state consistently；
- UI state is projection only。

## 6. Adapter Boundary Tests

Cases:

- adapter request default does not include raw `run_dir`、`workspace_dir`、`ACC_RUN_DIR`、`ACC_NODE_ID`、`ACC_RUN_ID` unless debug capability explicitly enabled；
- capability envelope includes only declared mounts/handles/env；
- provider session reuse is default-off for workflow-bound node；
- declared carry-forward input is required to use prior conversation content。

Suggested files:

- `tests/unit/test_codex_app_server_adapter.py`
- new `tests/unit/test_adapter_capability_envelope.py`

## 7. Status Taxonomy Tests

Cases:

- single canonical run terminal set；
- `timeout` semantics consistent across runtime/server/cloud/gc；
- adapter/provider/agent-turn statuses translate explicitly into run/node statuses；
- invalid transition raises or produces typed failure。

Suggested files:

- `tests/test_state_machine.py`
- `tests/unit/test_control_ledger_domain.py`

Static check:

- grep/lint blocks new local `TERMINAL_RUN_STATUSES` outside canonical module。

## 8. Server Boundary Tests

Cases:

- workflow routes call `WorkflowSubmissionService`；
- runner routes call same submission service or thin wrapper；
- routes do not compile graph or create registry directly；
- route-level file transaction logic lives in app/store services。

Suggested files:

- `tests/server/test_runner_api.py`
- `tests/server/test_runs_projection_api.py`
- `tests/server/test_workbench_canvas_snapshots_api.py`

## 9. Workbench Projection Tests

Cases:

- `NodeInspectorProjection` fixture renders node details；
- standard components do not require raw `runtime.json`；
- binding summary uses projection schema；
- debug/raw evidence disclosure has separate fixture；
- live event hook consumes projected events and refetch hints。

Commands:

```bash
cd web
npm run test -- --run
npm run build
```

## 10. Performance Regression Tests

Target measurements should be lightweight and deterministic.

Cases:

1. **Storage index**: one run summary update triggers one object upsert, not full rebuild.
2. **Run stream**: idle stream tick does not rescan all nodes/nested workflows.
3. **Nested event tail**: tail query cost proportional to returned tail/checkpoint delta, not full file length.
4. **Result projection**: node listing reads manifests once per request and does not materialize payload blobs by default.
5. **Scheduler**: high-concurrency independent nodes do not mutate shared output dict.

## 11. Full Quality Gate

When a milestone changes runtime behavior:

```bash
uv run pytest -q
uv run ruff check .
```

When Workbench changes:

```bash
cd web
npm run test -- --run
npm run build
```

Final acceptance:

```bash
uv run python scripts/quality_gate.py
```
