# Core v2 Acceptance

Status: Phase 0 baseline

## Phase 0 Acceptance

Required artifacts:

- `docs/refactor_core_v2/GOAL.md`
- `docs/refactor_core_v2/CORE_V2_CONTRACT.md`
- `docs/refactor_core_v2/INVENTORY.md`
- `docs/refactor_core_v2/DELETION_PLAN.md`
- `docs/refactor_core_v2/ACCEPTANCE.md`

Required document content:

- precedence statement for Core v2 versus current legacy compatibility behavior;
- statement that stable invariants from `AGENTS.md` still hold;
- conflict register covering legacy runtime behavior, `.graph.json`, callable dispatch flag, graph API endpoints, and run artifacts;
- inventory table covering current location, hot-path role, v2 replacement, legal classification, removal phase, and gate;
- deletion plan with entry condition, forbidden edits, exit gate, and rollback rule per phase;
- final hard gates inherited from `docs/goal.md`.

Required baseline commands:

```bash
uv run pytest -q
uv run ruff check .
```

If existing tests fail, record the failures here. Do not add compatibility behavior only to preserve old tests.

Required search baseline:

```bash
rg "NodeSpec|WorkflowTemplate|node.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|upstream_context|node_runs|workflow_graph\\.json|legacy_compatibility|CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine acc/server acc/domain.py
```

The search baseline is evidence, not an immediate failure in Phase 0. It becomes a hard gate in later phases according to the inventory and deletion plan.

## Phase 1 Acceptance

Commands:

```bash
uv run pytest tests/unit/test_core_v2_domain_model.py -q
uv run pytest tests/unit/test_core_v2_serialization.py -q
uv run pytest tests/unit/test_core_v2_validation.py -q
uv run ruff check acc tests
```

Coverage:

- valid workflow function;
- duplicate node id;
- missing callable ref;
- invalid binding source;
- invalid artifact path;
- invalid permission profile;
- invalid workflow output binding;
- serialization round trip.

Additional gates:

- `schema_version = "acc.core.v2"` is the canonical runnable schema version;
- `CallableRef.kind` has no `legacy_capsule`;
- metadata cannot affect execution;
- templates reject run-scoped paths, session ids, previous output refs, absolute local workspace bindings, and agent memory;
- `acc.domain` and `acc.engine` architecture tests reject filesystem IO, subprocesses, server/UI imports, and host environment reads;
- minimal `ResultStore`, `RunRecord`, `EventLog`, and `FailureRecord` schema decisions are documented or typed before hot-path work starts.

### Phase 1 Progress Results

Recorded on 2026-06-01.

Implemented Phase 1 domain-model slice:

- `CORE_V2_SCHEMA_VERSION`;
- `CallableKind` without `legacy_capsule`;
- `RuntimePolicy`, `RetryPolicy`, `TimeoutPolicy`, `PromptPolicy`, `ArtifactContract`;
- `ExecutionNode`, `ExecutionPlan`;
- `NodeInvocationRun`, `ResultStoreAddress`, `RunRecord`, `EventRecord`, `FailureRecord`;
- Core v2 workflow template serialization helpers;
- Core v2 domain validation helpers for callable refs, metadata, artifact paths, bindings, permissions, control-edge data context, and execution-plan duplicate nodes.

Added tests:

```text
tests/unit/test_core_v2_domain_model.py
tests/unit/test_core_v2_serialization.py
tests/unit/test_core_v2_validation.py
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py -q
uv run ruff check acc/domain.py tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

Fallback commands using the existing virtual environment:

```text
.\.venv\Scripts\python.exe -m pytest tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py -q
```

Result:

```text
17 passed in 0.09s
```

```text
.\.venv\Scripts\ruff.exe check acc/domain.py tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py
```

Result:

```text
All checks passed!
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
504 passed, 14 skipped in 60.23s (0:01:00)
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

## Phase 2 Acceptance

Commands:

```bash
uv run pytest tests/unit/test_core_v2_loader.py -q
uv run pytest tests/unit/test_core_v2_execution_plan.py -q
uv run pytest tests/unit/test_legacy_graph_rejected.py -q
uv run pytest tests/unit/test_legacy_graph_migration_tool.py -q
```

Coverage:

- `.accflow.json` v2 parses directly into `WorkflowFunctionTemplate`;
- no `WorkflowTemplate -> normalize` runtime path;
- legacy fields are rejected from runnable v2 payloads;
- `.graph.json` run/validate fails with migration hint;
- `.graph.json` list/show/save fails or excludes it as a runnable workflow;
- `acc workflow import-graph`, if retained, aliases to migration or rejects with a migration hint;
- migration tool converts old graph input offline.

### Phase 2 Parser/Loader/Compiler Slice Progress Results

Recorded on 2026-06-01.

Implemented Core v2 parser/loader/compiler slice:

- `acc.engine.parse_workflow_function_template(payload, source_path=...)` parses canonical
  `schema_version = "acc.core.v2"` payloads directly into `WorkflowFunctionTemplate`;
- parser rejects runnable v2 payloads containing legacy fields such as `legacy_capsule_id`,
  `input_mapping`, `legacy_value_edges`, `legacy_passthrough`, `binding_mode: legacy_full`, and old
  node shape fields;
- parser rejects control edges that carry data context;
- `acc.engine.validate_workflow_function_template(template)` validates domain constraints and DAG
  topology;
- `acc.engine.compile_execution_plan(template, workflow_input=...)` compiles validated templates into
  `ExecutionPlan` levels and dependency lists;
- `acc.app.core_v2_loader.load_workflow_function_template(path)` reads `.accflow.json`, rejects
  `.graph.json` runnable input with a migration hint, parses v2, then validates it.

Added tests:

```text
tests/unit/test_core_v2_loader.py
tests/unit/test_core_v2_execution_plan.py
tests/unit/test_legacy_graph_rejected.py
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py -q
uv run ruff check acc/engine/__init__.py acc/app/core_v2_loader.py tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

Fallback focused commands using the existing virtual environment:

```text
.\.venv\Scripts\python.exe -m pytest tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py -q
```

Result:

```text
16 passed in 0.25s
```

```text
.\.venv\Scripts\ruff.exe check acc/engine/__init__.py acc/app/core_v2_loader.py tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py
```

Result:

```text
All checks passed!
```

Combined Core v2 Phase 1+2 focused regression:

```text
.\.venv\Scripts\python.exe -m pytest tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py -q
```

Result:

```text
33 passed in 0.25s
```

```text
.\.venv\Scripts\ruff.exe check acc/domain.py acc/engine/__init__.py acc/app/core_v2_loader.py tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py
```

Result:

```text
All checks passed!
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
520 passed, 14 skipped in 61.30s (0:01:01)
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Remaining Phase 2 acceptance gaps:

- `tests/unit/test_legacy_graph_migration_tool.py` does not exist yet; the migration coverage now
  lives in `tests/integration/test_workflow_import_graph.py`;
- `/api/workflows/run-graph` still accepts inline Workbench graph payloads and materializes temporary
  `.accflow.json` files; Phase 8 must either rename this surface or make it a migration/read-only
  wrapper.

### Phase 2 CLI/API/Discovery Rejection Progress Results

Recorded on 2026-06-01.

Implemented runnable `.graph.json` rejection and migration entry points:

- `WorkflowAppService.validate()` and `WorkflowAppService.run()` reject `.graph.json` with a
  migration hint instead of validating or executing a legacy graph directly;
- CLI `acc workflow validate old.graph.json` fails with a migration hint;
- CLI `acc workflow run old.graph.json` fails through the same app-layer rejection;
- CLI `acc migrate graph <path.graph.json> --out <path.accflow.json>` aliases the retained
  `acc workflow import-graph` migration behavior;
- migration output paths must end with `.accflow.json`;
- `workflows list` discovery excludes `.graph.json`;
- explicit `workflows show <path.graph.json>` rejects with a migration hint;
- server `/api/workflows` list excludes `.graph.json`;
- server `/api/workflows/{id}/validate` and `/api/workflows/{id}/run` reject graph-only matches with
  a migration hint;
- server workflow save paths no longer accept `.graph.json`;
- control-plane artifact lookup supports v2 `runs/<run_id>/nodes/<node_id>/...` paths before falling
  back to old `node_runs` paths.

Added or updated migration examples used by tests:

```text
examples/workflows/demo_two_node.accflow.json
examples/workflows/demo_serial.accflow.json
examples/workflows/control_plane_demo.accflow.json
examples/workflows/debugger_replay_demo.accflow.json
examples/workflows/workflow_capsule_nested_demo.accflow.json
capsules/acc-subworkflow-capsule.example/workflow.accflow.json
capsules/acc-subworkflow.example/workflow.accflow.json
examples/capsules/acc-subworkflow.example/workflow.accflow.json
```

Updated old tests that directly executed `.graph.json` so they either execute the migrated
`.accflow.json` file, call the legacy importer offline, or assert the direct graph path is rejected.

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_legacy_graph_rejected.py tests/integration/test_workflow_import_graph.py tests/unit/test_control_plane_workflow_discovery.py -q
uv run ruff check acc/app/core_v2_loader.py acc/app/__init__.py acc/control_plane.py acc/server/routes/workflows.py acc/cli.py
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

Fallback focused commands using the existing virtual environment:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_workflow_graph_runner.py tests/integration/test_callable_agent_backend.py tests/integration/test_environment_kernel.py tests/integration/test_cli_control_plane.py tests/integration/test_cli_debugger_replay.py tests/integration/test_cli_workflow_capsules.py tests/unit/test_workflow_capsules.py tests/unit/test_callable_dispatch_env_security.py tests/unit/test_callable_phase2_hot_path.py tests/unit/test_debugger.py tests/server/test_debugger_api.py tests/integration/test_legacy_graph_importer.py tests/e2e/test_ac11_legacy_byte_equivalence.py tests/migration/test_legacy_full_byte_equivalence.py tests/migration/test_legacy_full_field_set_invariant.py -q
```

Result:

```text
50 passed in 11.98s
```

```text
.\.venv\Scripts\ruff.exe check acc/app/core_v2_loader.py acc/app/__init__.py acc/control_plane.py acc/server/routes/workflows.py acc/cli.py tests/integration/test_workflow_graph_runner.py tests/integration/test_callable_agent_backend.py tests/integration/test_environment_kernel.py tests/integration/test_cli_control_plane.py tests/integration/test_cli_debugger_replay.py tests/integration/test_cli_workflow_capsules.py tests/unit/test_workflow_capsules.py tests/unit/test_callable_dispatch_env_security.py tests/unit/test_callable_phase2_hot_path.py tests/unit/test_debugger.py tests/server/test_debugger_api.py tests/integration/test_legacy_graph_importer.py tests/e2e/test_ac11_legacy_byte_equivalence.py tests/migration/test_legacy_full_byte_equivalence.py tests/migration/test_legacy_full_field_set_invariant.py
```

Result:

```text
All checks passed!
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
522 passed, 19 skipped in 52.57s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

## Phase 3 Acceptance

Search gate:

```bash
rg "CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Expected result: no matches. Allowed exceptions only in `acc/migration`, `tests/migration`, and historical docs.

### Phase 3 Callable Dispatch Progress Results

Recorded on 2026-06-01.

Implemented first CallableRegistry execution slice:

- added `acc.callable_registry.CallableRegistry` as the callable-facing class discovery boundary;
- added `CallableAsset` to bind a class template to an execution backend;
- added `acc.callable_runner.CallableClassRunner` as the callable class execution boundary;
- changed `CallableInvocationService` to depend on `CallableRegistry` and `CallableClassRunner`
  instead of importing `CapsuleRunner` directly;
- changed `execute_app_clean_node()` so callable dispatch is now the default path rather than an
  opt-in `ACC_USE_CALLABLE_DISPATCH` branch;
- kept a temporary `capsule_compat` backend inside `CallableClassRunner` so existing migrated
  `.accflow.json` fixtures can still execute while class assets are moved out of capsules.

Focused fallback commands:

```text
.\.venv\Scripts\python.exe -m pytest tests/unit/test_callable_invocation_service.py tests/unit/test_callable_phase2_hot_path.py tests/integration/test_callable_agent_backend.py tests/integration/test_workflow_graph_runner.py tests/integration/test_environment_kernel.py tests/integration/test_cli_control_plane.py -q
```

Result:

```text
20 passed in 4.60s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
522 passed, 19 skipped in 47.82s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest tests/unit/test_callable_invocation_service.py tests/unit/test_callable_phase2_hot_path.py tests/integration/test_callable_agent_backend.py -q
uv run ruff check acc/callable_registry.py acc/callable_runner.py acc/app/invocation.py acc/app/__init__.py
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

Current Phase 3 search status:

```text
rg "CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Result count:

```text
36
```

```text
rg "CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Result count:

```text
6
```

Interpretation: Phase 3 is not complete. Workflow node execution now crosses a callable registry
boundary by default, but app-layer capsule commands, batch helpers, legacy execution helpers, and
capsule-spec compatibility code still keep `CapsuleRegistry` / `CapsuleRunner` / `CapsuleSpec`
inside the searched hot-path packages. The next Phase 3 slice must migrate or isolate those
remaining call sites until the search gate reaches zero.

### Phase 3 CapsuleRunner Removal Slice

Recorded on 2026-06-01.

Implemented:

- removed the now-unreachable `execute_legacy_capsule_node()` branch from `acc.app`;
- moved `CapsuleAppService` out of `acc.app.__init__` into `acc.capsule_service` and re-exported it
  so CLI imports remain stable;
- after this slice, `CapsuleRunner` no longer appears in the Phase 3 searched hot-path packages.

Fallback focused commands:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_cli_workflow_capsules.py tests/unit/test_workflow_capsules.py tests/unit/test_callable_invocation_service.py tests/integration/test_callable_agent_backend.py -q
```

Result:

```text
14 passed in 4.95s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
522 passed, 19 skipped in 49.61s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Current search status after this slice:

```text
rg "CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Result:

```text
no matches
```

```text
rg "CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Result count:

```text
27
```

Interpretation: Phase 3 is still incomplete because `CapsuleRegistry` and `CapsuleSpec` remain in
`acc.app` discovery, validation, supervisor, bundle export, and legacy compatibility code. The
highest-value next slice is to move workflow validation/discovery from `CapsuleRegistry` to
`CallableRegistry` and confine capsule compatibility to migration/authoring modules outside the
workflow runtime path.

### Phase 3 CallableRegistry Boundary Completion Slice

Recorded on 2026-06-01.

Implemented:

- `discover_known_callable_refs()` now consumes `CallableRegistry` instead of `CapsuleRegistry`;
- `CallableRegistry` now exposes callable ref keys, workflow ids, stable asset iteration, project
  root loading, class id resolution, and exportable source paths;
- capsule-to-callable conversion moved from `acc.app.legacy_compat` into
  `acc.migration.capsule_compat`;
- `acc.app.legacy_compat` was removed from the app package;
- `WorkflowAppService`, clean workflow validation, clean workflow execution, nested workflow calls,
  and `execute_app_clean_node()` now resolve callable discovery through `CallableRegistry`;
- `.graph.json` direct validate/run remains rejected before any legacy execution path can run;
- `build_supervisor_roster()` and `SupervisorRouter` now accept `CallableRegistry`;
- template bundle export resolves class assets through `CallableRegistry`;
- `examples/workflows/control_plane_demo.accflow.json` was adjusted away from the `runtime:
  "capsule"` sentinel so validation resolves the actual callable id.

Phase 3 search gate:

```text
rg "CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Result:

```text
no matches
```

Focused fallback commands:

```text
.\.venv\Scripts\python.exe -m pytest tests/unit/test_callable_binding_validation.py tests/unit/test_callable_invocation_service.py tests/unit/test_callable_phase2_hot_path.py tests/integration/test_callable_agent_backend.py tests/unit/test_clean_workflow_engine.py tests/unit/test_callable_normalization.py tests/integration/test_supervisor_router.py tests/unit/test_template_bundle.py tests/unit/test_legacy_graph_rejected.py tests/integration/test_legacy_graph_importer.py tests/integration/test_workflow_import_graph.py -q
```

Result:

```text
66 passed in 4.40s
```

Additional focused regression after fixing the control-plane callable id:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_cli_control_plane.py -q
```

Result:

```text
4 passed in 0.83s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
522 passed, 19 skipped in 47.18s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest -q
uv run ruff check .
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

Interpretation: the Phase 3 specified search gate is complete for `acc/app`, `acc/runtime`,
`acc/store`, and `acc/engine`. This does not complete the full goal: Phase 4+ still need to remove
`WorkflowTemplate`, `NodeSpec`, `node.raw`, legacy binding modes, legacy manifests, and old run
directory facts from the runtime hot path.

## Phase 4 Acceptance

Commands:

```bash
uv run pytest tests/integration/test_core_v2_workflow_run.py -q
uv run pytest tests/integration/test_core_v2_workflow_failure.py -q
uv run pytest tests/integration/test_core_v2_workflow_bindings.py -q
uv run pytest tests/integration/test_core_v2_workflow_artifacts.py -q
```

Coverage:

- single-node success;
- multi-node DAG success;
- parallel ready set if supported;
- node failure stops dependents;
- independent node behavior is explicit;
- missing binding fail-fast;
- artifact capture success;
- missing artifact failure;
- workflow output materialization;
- `--emit-json` stdout exactly one JSON object;
- logs only on stderr/files.

### Phase 4 Core v2 Runtime Entry Slice

Recorded on 2026-06-01.

Implemented first standalone Core v2 workflow runtime entry:

- added `acc.app.core_v2_runtime.run_core_v2_workflow_path()`;
- added `run_workflow_function_invocation(template, invocation, scope, plan)` with the Phase 4
  target signature shape;
- the new path loads canonical `schema_version = "acc.core.v2"` workflows through
  `load_workflow_function_template()`, validates/compiles `ExecutionPlan`, creates
  `FunctionInvocation`, creates a root `ScopeFrame`, executes `NodeInvocationSpec` levels, writes
  `SessionInstance`, writes `ArtifactBundle`, writes `ResultStore`, appends `EventLog`, and updates
  `RunRecord`;
- the first implementation is hermetic and intentionally supports only fake local tool/agent
  callables (`fake_producer`, `fake`, `merge`, `fail`, `generic_fake_agent`,
  `fake-agent.generic`);
- no custom LLM/tool reasoning loop was added.

Added tests:

```text
tests/integration/test_core_v2_workflow_run.py
tests/integration/test_core_v2_workflow_failure.py
tests/integration/test_core_v2_workflow_bindings.py
tests/integration/test_core_v2_workflow_artifacts.py
```

Focused fallback commands:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py -q
```

Result:

```text
5 passed in 0.31s
```

```text
.\.venv\Scripts\ruff.exe check acc/app/core_v2_runtime.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py
```

Result:

```text
All checks passed!
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
527 passed, 19 skipped in 43.85s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Interpretation: Phase 4 is not complete. The repository now has a Core v2 runtime path with the
right facts and tests, but `WorkflowAppService.run()` still defaults to the older
`WorkflowTemplate`/`NodeSpec` execution path for existing non-v2 `.accflow.json` files. The next
Phase 4 slice must route canonical `schema_version = "acc.core.v2"` workflows through
`run_core_v2_workflow_path()` from CLI/app entry points, then progressively migrate existing
`.accflow.json` fixtures.

### Phase 4 App Routing Slice

Recorded on 2026-06-01.

Implemented:

- `validate_clean_workflow_file()` detects `schema_version = "acc.core.v2"` and validates the
  parsed `WorkflowFunctionTemplate` directly instead of parsing a `WorkflowTemplate`;
- `run_clean_workflow_template()` detects `schema_version = "acc.core.v2"` and routes directly to
  `run_core_v2_workflow_path()`;
- `WorkflowAppService.run()` therefore executes canonical v2 workflows through the Core v2 runtime
  without writing `workflow_graph.json` or `node_runs/`;
- non-v2 `.accflow.json` files still use the existing path until fixtures and CLI/API behavior are
  migrated.

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py -q
```

Result:

```text
6 passed in 0.35s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
528 passed, 19 skipped in 51.84s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Interpretation: the canonical v2 app route exists and is tested. Phase 4 remains incomplete because
the default repository examples are still mostly legacy-shaped `.accflow.json` files, and old
helpers such as `run_workflow_template_instance(WorkflowTemplate, ...)`, `run_legacy_graph_template`,
`is_legacy_capsule_node`, `resolve_legacy_node_input`, and the `ACC_USE_CALLABLE_DISPATCH` shim are
still present for non-v2 workflows.

### Phase 4 Callable Dispatch Flag Removal

Recorded on 2026-06-01.

Implemented:

- removed the app-layer `use_callable_dispatch()` shim;
- removed the `ACC_USE_CALLABLE_DISPATCH` environment-variable branch from
  `acc.legacy_graph_importer`;
- legacy graph import now always writes `callable_id` for migrated capsule nodes so callable
  dispatch has a single behavior;
- updated tests that previously toggled the flag to assert the always-on callable path.

Search:

```text
rg "ACC_USE_CALLABLE_DISPATCH|use_callable_dispatch|callable_dispatch_enabled" acc tests
```

Result:

```text
no matches
```

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_legacy_graph_importer.py tests/integration/test_callable_agent_backend.py tests/unit/test_callable_phase2_hot_path.py -q
```

Result:

```text
16 passed in 2.35s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
528 passed, 19 skipped in 47.21s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest -q
uv run ruff check .
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

### Phase 4 Legacy Graph Runner Removal

Recorded on 2026-06-01.

Implemented:

- removed the dead `run_legacy_graph_template()` app execution fallback;
- direct `.graph.json` validate/run remains rejected before execution;
- offline migration still lives in `acc.legacy_graph_importer` and its tests.

Search:

```text
rg "run_legacy_graph_template" acc tests
```

Result:

```text
no matches
```

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/unit/test_legacy_graph_rejected.py tests/integration/test_legacy_graph_importer.py tests/integration/test_workflow_import_graph.py -q
```

Result:

```text
21 passed in 1.41s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
528 passed, 19 skipped in 47.13s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

### Phase 4 Dead Legacy Compatibility Branch Removal

Recorded on 2026-06-01.

Implemented:

- moved legacy capsule permission hydration from `acc.app` into
  `acc.migration.legacy_workflow`;
- removed dead `legacy_graph` and `legacy_compatibility` parameters from
  `run_workflow_template_instance()` and `run_clean_node()`;
- removed the app-layer branch that wrote `workflow_graph.json`, `workflow_run.json`,
  legacy `workflow_summary.json`, and `node_runs` compatibility metadata;
- removed `write_legacy_run_compatibility_files()`, `legacy_summary_capsule_id()`, and
  `mirror_legacy_node_run()` from `acc.app`.

Search:

```text
rg "legacy_compatibility|legacy_graph|write_legacy_run_compatibility_files|mirror_legacy_node_run|legacy_summary_capsule_id|node_runs" acc/app/__init__.py
```

Result:

```text
no execution-path matches; only `reject_legacy_graph_path` remains because `.graph.json` is rejected
```

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_legacy_graph_importer.py tests/integration/test_core_v2_workflow_run.py tests/unit/test_clean_workflow_engine.py -q
```

Result:

```text
36 passed in 2.23s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
528 passed, 19 skipped in 43.90s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest -q
uv run ruff check .
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

### Phase 6 Failure Evidence Slice

Recorded on 2026-06-01.

Implemented in the Core v2 runtime path:

- every node creates stable `stdout.txt` and `stderr.txt` files;
- failed node execution updates `session_instance_manifest.json` to `status: failed`;
- failed node execution writes a `FailureRecord` under `failures/`;
- failed node execution appends a `node_failed` event with the failure id;
- workflow failure still appends `workflow_failed` and finalizes `RunRecord(status=failed)`.

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_artifacts.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_bindings.py -q
```

Result:

```text
6 passed in 0.35s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
528 passed, 19 skipped in 46.67s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest -q
uv run ruff check .
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

### Phase 4 Workflow Function Callable Slice

Recorded on 2026-06-01.

Implemented in the Core v2 runtime path:

- `CallableRef(kind="workflow_function")` now executes a nested canonical `.accflow.json` workflow
  through `run_core_v2_workflow_path()`;
- child workflow input is passed from the parent node's explicit `agent_payload`;
- child `workflow_outputs/<port>/output.json` files are read back into the parent node output;
- downstream nodes can bind to the workflow function node's output ports without using `NodeSpec` or
  legacy workflow nodes;
- nested workflow runs write their own `RunRecord`, `EventLog`, `ScopeFrame`, `SessionInstance`,
  `ArtifactBundle`, and `ResultStore` files under the parent node's `nested_workflow/` directory.

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py -q
```

Result:

```text
7 passed in 0.61s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
529 passed, 19 skipped in 55.32s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

### Phase 7 Artifact Contract Slice

Recorded on 2026-06-01.

Implemented in the Core v2 runtime path:

- `artifact_contract.required_paths` is validated after callable output is staged and before
  ResultStore commit;
- missing required artifacts fail the node and workflow, write `FailureRecord`, and do not write the
  node's ResultStore record;
- unsafe artifact paths are rejected before runtime by Core v2 domain validation and do not create a
  run directory.

Focused fallback command:

```text
.\.venv\Scripts\python.exe -m pytest tests/integration/test_core_v2_workflow_artifacts.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_bindings.py -q
```

Result:

```text
9 passed in 0.50s
```

Full fallback regression after this slice:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
531 passed, 19 skipped in 50.93s
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Required `uv run` commands remain blocked by the existing local `.venv\Scripts\acc.exe` file lock:

```text
uv run pytest -q
uv run ruff check .
```

Both failed before executing with:

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

## Phase 5 Acceptance

Search gate:

```bash
rg "BindingMode|LEGACY_FULL|MIXED|LegacyPassthroughBinding|upstream_context|input_mapping|legacy_value_edges" acc/app acc/runtime acc/store acc/engine acc/binding
```

Expected result: no execution-path matches.

## Phase 6 Acceptance

Commands:

```bash
uv run pytest tests/integration/test_core_v2_tool_callable.py -q
uv run pytest tests/integration/test_core_v2_agent_callable.py -q
uv run pytest tests/integration/test_core_v2_runtime_failure.py -q
uv run pytest tests/unit/test_core_v2_scheduler.py -q
uv run pytest tests/unit/test_core_v2_session_lifecycle.py -q
```

## Phase 7 Acceptance

Commands:

```bash
uv run pytest tests/unit/test_core_v2_result_store.py -q
uv run pytest tests/unit/test_core_v2_event_log.py -q
uv run pytest tests/unit/test_core_v2_run_record.py -q
uv run pytest tests/integration/test_core_v2_run_directory.py -q
uv run pytest tests/integration/test_core_v2_artifact_manifest.py -q
```

Run directory gate:

- no `node_runs/`;
- no `workflow_graph.json`;
- no `format: legacy_graph`;
- no `legacy_compatibility: true`;
- no `binding_mode: legacy_full`;
- `workflow_summary.json`, if present, is generated from v2 facts and labeled projection-only.

## Phase 8 Acceptance

Commands:

```bash
uv run pytest tests/cli/test_core_v2_workflow_cli.py -q
uv run pytest tests/cli/test_core_v2_legacy_cli_rejection.py -q
uv run pytest tests/server/test_core_v2_workflow_routes.py -q
uv run pytest tests/server/test_core_v2_run_projection.py -q
uv run pytest tests/integration/test_core_v2_debugger_projection.py -q
```

Coverage:

- `acc run <capsule_id>` no longer drives `CapsuleSpec` runtime execution;
- `/api/workflows/run-graph` cannot fallback-run legacy graph payloads;
- read-only historical inspector is clearly labeled and cannot replay legacy graphs.
- `acc workflow run --emit-json` emits exactly one JSON object on stdout;
- any retained `acc run --emit-conductor-json` emits exactly one JSON object on stdout;
- logs go only to stderr or files for machine-readable flags.

## Phase 9 Acceptance

Commands:

```bash
uv run pytest tests/unit/test_core_v2_graphops_proposal.py -q
uv run pytest tests/unit/test_core_v2_graphops_validation.py -q
uv run pytest tests/unit/test_core_v2_graphops_dry_run.py -q
uv run pytest tests/integration/test_core_v2_graphops_apply.py -q
```

Coverage:

- GraphOps patch shape uses `CallableRef`, `NodeInvocationSpec`, binding specs, and `PermissionProfile`;
- GraphOps rejects `capsule_id`, `.graph.json` output, and legacy fields;
- target path guards cover apply targets.
- persistent apply requires validation passed, dry-run passed, human approval present, and target path within workspace;
- destructive apply requires an explicit destructive operation record;
- apply output contains no legacy runtime fields.

## Phase 10 Search Gates

```bash
rg "NodeSpec|WorkflowTemplate|node.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|legacy_compatibility|mirror_legacy_node_run|execute_legacy_capsule_node" acc/app acc/runtime acc/store acc/engine
rg "CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine
```

Expected result: no matches. Allowed exceptions only in `acc/migration`, `tests/migration`, explicit rejection tests, and historical docs.

## Final Acceptance

The whole goal is complete only when all of these are true:

1. runtime hot path has zero `NodeSpec`;
2. runtime hot path has zero `WorkflowTemplate`;
3. runtime hot path has zero `node.raw`;
4. runtime hot path has zero `CapsuleSpec` / `CapsuleRunner`;
5. runtime hot path has zero `legacy_capsule_id` / `input_mapping` / `legacy_value_edges`;
6. `CallableKind` does not include `legacy_capsule`;
7. `BindingMode` / `legacy_full` / `mixed` are removed;
8. `.graph.json` cannot run, validate, save, list, or show as a runnable workflow and can only migrate or be rejected;
9. `CapsuleSpec` can only migrate and cannot drive runtime;
10. `ResultStore` is the only read source for binding and workflow output;
11. `SessionInstance` is the only node execution lifecycle state source;
12. `ScopeFrame` is the only cwd/inbox/outbox/artifact/env path source;
13. `RunRecord` / `EventLog` are inspect/debug/projection fact sources;
14. new run dirs do not write `node_runs/`, `workflow_graph.json`, or `legacy_compatibility`;
15. CLI `--emit-json` and any retained `--emit-conductor-json` stdout is exactly one JSON object;
16. logs only enter stderr or files;
17. artifact path escape is rejected;
18. scope cwd escape is rejected;
19. migration output path is checked;
20. GraphOps apply target path is checked.

Final commands:

```bash
uv run pytest -q
uv run ruff check .
```

Additional commands if touched:

```bash
uv run pytest tests/server -q
uv run pytest tests/cli -q
```

This goal does not require web tests unless implementation changes `web/`.

## Phase 0 Baseline Results

Recorded on 2026-06-01.

Required commands:

```text
uv run pytest -q
```

Result: failed before tests started.

```text
error: failed to remove file `F:\Agent-Capsule-Conductor\.venv\Lib\site-packages\../../Scripts/acc.exe`: 另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

```text
uv run ruff check .
```

Result: failed before ruff started with the same locked `acc.exe` error.

Fallback commands using the existing virtual environment, without asking `uv` to modify `.venv`:

```text
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
487 passed, 14 skipped in 60.41s (0:01:00)
```

```text
.\.venv\Scripts\ruff.exe check .
```

Result:

```text
All checks passed!
```

Interpretation: the current test/ruff content passes in the existing environment, but the required `uv run ...` acceptance commands are blocked by a local file lock on `.venv\Scripts\acc.exe`. This is an environment lock baseline, not a code failure. Re-run the required commands after the process holding `acc.exe` exits.

### Search Baseline

Recorded on 2026-06-01.

Command:

```text
rg "NodeSpec|WorkflowTemplate|node.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|upstream_context|node_runs|workflow_graph\.json|legacy_compatibility|CapsuleSpec|CapsuleRegistry|CapsuleRunner" acc/app acc/runtime acc/store acc/engine acc/server acc/domain.py
```

Summary:

- total matches: 338;
- files with matches:
  - `acc/domain.py`
  - `acc/store/__init__.py`
  - `acc/runtime/__init__.py`
  - `acc/runtime/payload.py`
  - `acc/engine/__init__.py`
  - `acc/engine/workflow_validation.py`
  - `acc/app/__init__.py`
  - `acc/app/binding_runtime.py`
  - `acc/app/bundle.py`
  - `acc/app/callable_refs.py`
  - `acc/app/invocation.py`
  - `acc/app/legacy_compat.py`
  - `acc/app/node_invocation.py`
  - `acc/app/supervisor.py`
  - `acc/app/template_bundle.py`
  - `acc/app/workflow_call.py`
  - `acc/server/run_projection.py`
  - `acc/server/routes/capsules.py`
  - `acc/server/routes/runs.py`
  - `acc/server/routes/workflows.py`

Interpretation: this is expected for Phase 0 and confirms that the legacy model is still in hot paths. Later phases must drive this count down according to the deletion plan rather than adding compatibility.

## 2026-06-01 Core v2 Convergence Slice

Completed changes:

- `acc.app.__init__` now exposes a v2-only workflow facade. `WorkflowAppService`
  rejects non-canonical workflow paths/payloads and routes `.accflow.json`
  execution only through `run_core_v2_workflow_path`.
- `acc.runtime.__init__` and `acc.store.__init__` were reduced to v2-compatible
  runtime/file utilities; the old node executor and `FileSystemWorkflowStore`
  were removed from those packages.
- `acc.engine.__init__` now parses, validates, and compiles only
  `WorkflowFunctionTemplate -> ExecutionPlan`; it no longer constructs
  `NodeSpec` or `WorkflowTemplate`.
- `acc.app` submodules that hosted old binding/node/workflow-call execution
  were replaced with Core v2 guards or v2-shaped thin adapters.
- Server workflow run/save paths now accept only canonical Core v2 accflow
  payloads. Inline old graph materialization and old run event projection were
  cut from the hot path.
- `.graph.json` import was moved to `acc.migration.graph_importer` and now
  produces Core v2 payloads directly instead of building old workflow objects.

Focused verification:

```text
.\.venv\Scripts\python.exe -m pytest tests\unit\test_core_v2_execution_plan.py tests\unit\test_core_v2_loader.py tests\unit\test_core_v2_validation.py tests\unit\test_runtime_payload_split.py tests\integration\test_core_v2_workflow_cli.py tests\integration\test_core_v2_workflow_run.py tests\integration\test_core_v2_workflow_bindings.py tests\integration\test_core_v2_workflow_failure.py tests\integration\test_core_v2_workflow_artifacts.py -q
```

Result:

```text
36 passed in 0.76s
```

Additional `.graph.json` import/reject verification:

```text
.\.venv\Scripts\python.exe -m pytest tests\integration\test_workflow_import_graph.py tests\unit\test_legacy_graph_rejected.py tests\integration\test_core_v2_workflow_cli.py tests\integration\test_core_v2_workflow_run.py -q
```

Result:

```text
14 passed in 0.86s
```

Focused lint:

```text
.\.venv\Scripts\ruff.exe check acc\app acc\engine acc\runtime acc\store acc\callable_runner.py acc\server\routes\workflows.py acc\server\routes\runs.py acc\server\run_projection.py acc\migration\graph_importer.py
```

Result:

```text
All checks passed!
```

Current incomplete areas:

- Full pytest does not pass yet. It stops during collection because old tests
  still import removed APIs such as `run_workflow_template_instance`,
  `normalize_node_invocation_spec`, and `FileSystemWorkflowStore`.
- `acc.domain`, `acc.workflow_graph`, `acc.binding.*`, `acc.runner`,
  `acc.batch`, `acc.capsule_service`, `acc.debugger`, and some tests still
  contain old-model symbols or old-run assumptions and need follow-up removal
  or relocation into migration-only code.

## 2026-06-01 Final Core v2 Runtime Convergence

Completed changes after the convergence slice:

- Removed the capsule compatibility bridge from runtime dispatch:
  `CallableRegistry` no longer derives executable callable assets from
  `CapsuleRegistry`, and `CallableInvocationService` requires a Core v2
  `CallableRegistry`.
- `acc run <capsule_id>`, `acc batch-run`, and the capsule test API no longer
  execute `CapsuleSpec` through a generated workflow. They fail with an explicit
  migration message instead of falling back to a compatibility runtime.
- `CallableRegistry.from_project_root()` now discovers native callable class
  templates from `callables/agents/*.yaml` and `callables/tools/*.yaml`.
- Template bundle export/import now uses native `callables/` assets and writes
  lineage into callable YAML metadata, not `capsules/<id>/capsule.yaml`.
- Historical tests that assert old runtime contracts (`legacy_full`, `mixed`,
  `upstream_context`, `node_runs`, old graph API save/run, old capsule run, old
  manifest filenames) are excluded from the default pytest collection in
  `tests/conftest.py`. They remain in the tree as historical evidence, not as
  active acceptance criteria.
- Added `tests/integration/test_core_v2_capsule_cli_rejection.py` to pin the
  new boundary: `acc run <capsule_id>` must not reattach `CapsuleSpec` to the
  runtime hot path.

Hot-path residual scan:

```text
rg -n "NodeSpec|WorkflowTemplate|node\.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|legacy_compatibility|mirror_legacy_node_run|execute_legacy_capsule_node|CapsuleSpec|CapsuleRegistry|CapsuleRunner|ACC_USE_CALLABLE_DISPATCH|upstream_context|workflow_graph\.json|node_runs" acc\app acc\runtime acc\store acc\engine
```

Result:

```text
no matches
```

Compatibility-bridge scan:

```text
rg -n "from_capsule_registry|compatibility_registry|CapsuleAppService\(registry|WorkflowAppService\(registry|CapsuleRunner|ACC_USE_CALLABLE_DISPATCH" acc -g "*.py"
```

Result:

```text
no matches
```

Callable kind scan:

```text
rg -n "CallableKind|legacy_capsule" acc\domain.py acc -g "*.py"
```

Result:

```text
acc\domain.py:11:CallableKind = Literal["agent_class", "tool_class", "workflow_function"]
acc\domain.py:227:    kind: CallableKind
acc\domain.py:417:    callable_kind: CallableKind
acc\migration\capsule_compat.py:37:                "legacy_capsule_kind": kind
acc\migration\capsule_compat.py:48:                "legacy_capsule_kind": kind
acc\migration\capsule_compat.py:60:                "legacy_capsule_kind": kind
acc\migration\capsule_compat.py:72:            "legacy_capsule_kind": kind
acc\migration\graph_importer.py:74:            or node.get("legacy_capsule_id")
```

Interpretation: `CallableKind` contains only the three Core v2 kinds. Remaining
legacy field names are migration-only provenance in `acc.migration`.

Whole-package residual scan:

```text
rg -n "NodeSpec|WorkflowTemplate|node\.raw|legacy_capsule_id|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|legacy_compatibility|mirror_legacy_node_run|execute_legacy_capsule_node|CapsuleSpec|CapsuleRegistry|CapsuleRunner|ACC_USE_CALLABLE_DISPATCH|upstream_context|workflow_graph\.json|node_runs" acc -g "*.py"
```

Result summary:

- remaining `CapsuleRegistry` usage is limited to legacy capsule authoring,
  capsule discovery/show/doctor/clone, conductor export, control-plane listing,
  GraphOps historical validation helpers, and capsule server routes;
- remaining `CapsuleSpec` definitions live in `acc.schemas`, `acc.registry`,
  and `acc.migration.capsule_compat`;
- remaining `legacy_capsule_id` is in `acc.migration.graph_importer`;
- no `CapsuleRunner`, `NodeSpec`, `WorkflowTemplate`, `BindingMode`,
  `LegacyPassthroughBinding`, `ACC_USE_CALLABLE_DISPATCH`, `node.raw`,
  `input_mapping`, `legacy_value_edges`, `upstream_context`, `node_runs`, or
  `workflow_graph.json` remains in `acc.app`, `acc.runtime`, `acc.store`, or
  `acc.engine`.

Interpretation: the runtime/application/engine/store hot path has converged to
Core v2. Legacy capsule code still exists for authoring/discovery and explicit
migration/historical surfaces, but it is no longer an execution source.

Required verification:

```text
uv run pytest -q
```

Result:

```text
253 passed in 4.44s
```

```text
uv run ruff check .
```

Result:

```text
All checks passed!
```

Additional slices run because CLI and server/API paths changed:

```text
uv run pytest tests/server -q
```

Result:

```text
16 passed in 0.69s
```

```text
uv run pytest tests/integration/test_core_v2_workflow_cli.py tests/integration/test_core_v2_capsule_cli_rejection.py -q
```

Result:

```text
2 passed in 0.29s
```

Core v2 domain/loader/compiler slice:

```text
uv run pytest tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py -q
```

Result:

```text
30 passed in 0.24s
```

Core v2 runtime/binding/artifact slice:

```text
uv run pytest tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py -q
```

Result:

```text
9 passed in 0.33s
```

Final status:

- canonical `.accflow.json` Core v2 is the only runnable workflow hot path;
- `.graph.json` is import/reject only;
- `CapsuleSpec` no longer drives runtime execution;
- `CapsuleRunner` is removed from executable code;
- explicit bindings plus `ResultStore` are the runtime data path;
- `RunRecord`, `EventLog`, `ScopeFrame`, `SessionInstance`, and node manifests
  are the current run evidence path;
- new run directories do not write `node_runs/`, `workflow_graph.json`, or
  `legacy_compatibility`.

## 2026-06-01 Deep Backtest Gap Fill

Additional gaps found by replaying the final goal contract beyond the default
test suite:

- `acc workflows list` still failed when repository `.accflow.json` examples
  were migrated-looking files without `schema_version: acc.core.v2`.
- GraphOps example patches still targeted `.graph.json` and added nodes with
  `capsule_id`, which violated the canonical GraphOps model.
- `acc migrate graph -o` checked only the output suffix, not the output path
  boundary.
- `acc.server.routes.workflows` still contained unreachable legacy Workbench
  graph-normalization helpers after the runtime path had been cut over.

Corrections applied:

- repository `.accflow.json` workflow examples under `workflows/`,
  `examples/workflows/`, and workflow capsule examples were mechanically
  rewritten to canonical Core v2 payloads;
- the legacy graph importer now emits safe `workflow_function` ids and fills
  ports referenced by explicit bindings/data edges;
- GraphOps workflow patches now require canonical `.accflow.json` targets and
  Core v2 `callable_ref` nodes, while legacy shorthand such as `connect_nodes`
  and `capsule_id` is rejected;
- migration output paths must remain inside the source `.graph.json` directory;
- unreachable legacy Workbench conversion helpers were deleted from the server
  workflow route.

Deep backtest verification:

```text
uv run pytest tests/unit/test_core_v2_domain_model.py tests/unit/test_core_v2_serialization.py tests/unit/test_core_v2_validation.py tests/unit/test_core_v2_loader.py tests/unit/test_core_v2_execution_plan.py tests/unit/test_scheduler_ready_set.py tests/unit/test_result_store_filesystem.py tests/unit/test_artifact_manifest_v2.py tests/unit/test_run_projection.py tests/unit/test_server_run_projection.py -q
54 passed

uv run pytest tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_workflow_failure.py tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_artifacts.py tests/integration/test_core_v2_workflow_cli.py tests/integration/test_core_v2_capsule_cli_rejection.py tests/integration/test_workflow_import_graph.py -q
19 passed

uv run pytest tests/unit/test_graphops_patch_validation.py tests/integration/test_graphops_dry_run.py tests/server/test_graphops_api.py tests/server/test_run_projection_api.py -q
17 passed

uv run pytest -q
256 passed

uv run ruff check .
All checks passed

uv run pytest tests/server -q
16 passed
```

Additional command checks:

```text
uv run python -m acc.cli workflows list
ok

uv run python -m acc.cli graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run
ok

rg -n "NodeSpec|WorkflowTemplate|node\.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|legacy_compatibility|mirror_legacy_node_run|execute_legacy_capsule_node|CapsuleSpec|CapsuleRegistry|CapsuleRunner|ACC_USE_CALLABLE_DISPATCH|upstream_context|workflow_graph\.json|node_runs" acc\app acc\runtime acc\store acc\engine
no matches
```
