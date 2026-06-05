# ACC Control Architecture Goal Progress

生成日期: 2026-06-03

此文件由总控 goal 在执行过程中更新。初始状态全部为 `pending`。

| Goal | Status | Verification | Notes |
| --- | --- | --- | --- |
| 01 Runtime Control Ledger ABI | completed | `uv run pytest -q tests/unit/test_control_ledger_domain.py tests/unit/test_control_ledger_store.py`; `uv run ruff check .` | Added control ledger ABI, pure validators, store reader/writer/projection helpers, and focused tests. |
| 02 Fixed RunPlan Dispatch | completed | `uv run pytest -q tests/unit/test_control_ledger_domain.py tests/unit/test_control_ledger_store.py tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_cli.py tests/integration/test_core_v2_workflow_run.py::test_core_v2_nested_workflow_function_call`; `uv run ruff check .` | Added fixed ExecutionPlan to RunPlan/PlanStep conversion and fixed runtime ledger wrapper while preserving Core v2 execution behavior. |
| 03 Fixed-Only Projection | completed | `uv run pytest -q tests/server/test_control_ledger_api.py tests/server/test_decisions_api.py tests/unit/test_control_ledger_domain.py tests/unit/test_control_ledger_store.py tests/integration/test_core_v2_control_ledger_runtime.py`; `uv run ruff check .` | Added read-only fixed control ledger app projection and run-scoped server endpoints without changing Workbench or `/api/decisions` truth boundary. |
| 04 Run Wait/Resume Lifecycle | completed | `uv run pytest -q tests/unit/test_run_lifecycle.py tests/unit/test_workbench_run_manager.py tests/unit/test_wakeup_queue.py tests/server/test_run_interactions_lifecycle.py tests/server/test_control_ledger_api.py tests/unit/test_control_ledger_domain.py tests/unit/test_control_ledger_store.py`; `uv run ruff check .` | Added run waiting/resuming status classification, non-destructive human resume P0, wakeup consumer helper, terminal answer/wakeup rejection, and WorkbenchRunManager non-terminal projection/restart reconcile tests. |
| 05 Human Gate Barrier | completed | `uv run pytest -q tests/unit tests/server tests/integration`; `uv run ruff check .` | Added typed `NodeInvocationSpec.control.require_human_approval`, runtime pending approval barrier, approval answer service with `DecisionRecord(kind="approval")`/canonical event/wakeup, non-destructive approve dispatch, reject-to-skipped evidence, thin interaction route, and focused unit/server/integration coverage. |
| 06 Supervisor PlanStep P0 | completed | `uv run pytest -q tests/unit/test_supervisor_validation.py tests/unit tests/integration`; `uv run ruff check .` | Added pure approved `SupervisorPlan` -> validated supervisor `PlanStep[]` + `DecisionRecord(kind="supervisor_plan")` compilation, app-level materialization into control ledger with intent snapshots, roster/policy/repeat/depth validation, and P0 tests asserting no worker execution. |
| 07 Supervisor Dispatch Integration | completed | `uv run pytest -q tests/integration tests/unit`; `uv run ruff check .` | Added dynamic supervisor `PlanStep(source="supervisor")` dispatch through the existing `DispatchEnvelope -> execute_core_v2_node()` wrapper, dependency readiness handling, worker success/failure ledger updates, hermetic fake worker E2E coverage, and result/artifact evidence checks. |
| 08 Supervisor Replay | completed | `uv run pytest -q tests/unit tests/integration`; `uv run ruff check .` | Added supervisor replay helper that reuses recorded `DecisionRecord(kind="supervisor_plan")` and existing dynamic `PlanStep` records, validates run/template snapshot compatibility, writes replay evidence, and tests that supervisor parser/LLM paths are not called. |
| 09 Handoff P0 | completed | `uv run pytest -q tests/unit tests/integration`; `uv run ruff check .` | Added typed `HandoffControlPolicy`/`HandoffRequest`, pure handoff validation and `DecisionRecord(kind="handoff")` compilation, app-level payload/artifact ref materialization, `new_session` dynamic `PlanStep(source="handoff")` dispatch through the existing Core v2 ledger wrapper, `route_only` existing outgoing-step selection without creating a session, and explicit P0 rejection for `resume_session`. |
| 10 GraphOps Governance Option A | completed | `uv run pytest -q tests/unit tests/server`; `uv run ruff check .`; `cd web && npm run test -- --run`; `cd web && npm run build` | Added explicit Option A governance fields (`dry_run_only`, `apply_status=not_implemented`, `governance_mode=proposal_dry_run_only`) across GraphOps CLI/API/dry-run/DecisionInbox, added an explicit failing `/api/graphops/apply` endpoint, kept Workbench actions validate/dry-run only, and added tests that real apply remains unavailable and runtime supervisor/handoff dispatch does not call GraphOps apply. |

状态说明:

- `pending`: 尚未开始。
- `in_progress`: 正在执行。
- `completed`: 已实现并通过该 goal 要求的 verification。
- `blocked`: 已收集证据但无法继续, 需要用户输入或上游状态变化。
- `failed`: 实现或验证失败, 必须先修复再继续下一个 goal。
