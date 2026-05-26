# QUALITY_REPORT

Status: Complete for this refactor pass.

## Baseline Evidence

- `uv run pytest -q`: 227 passed.
- `uv run ruff check .`: passed.
- `uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_layering_echo --emit-conductor-json`: passed and stdout was a single JSON object.

## What Changed

- Added `acc.ports` protocol boundaries.
- Added `acc.engine` for pure `.accflow.json` parsing, validation, topological scheduling, data/control edge checks, permission profile validation, and failure policy mapping.
- Added `acc.store` for filesystem run layout, environment manifests, workflow/node events, node outputs, artifact bundles, inbox/outbox materialization, retry cleanup, and path traversal checks.
- Added `acc.runtime` for fake/tool/workflow execution, timeout handling, env whitelist construction, workspace write checks, and node execution policy.
- Added `acc.app` as the orchestration layer that coordinates engine, store, and runtime.
- Removed `acc.clean_workflow` after updating CLI and tests to call the new layers directly.
- Added `tests/architecture/test_import_boundaries.py`.
- Added `tests/unit/test_ideal_layering_security.py`.
- Extended `acc.domain` with `PermissionProfile`, `RuntimeResult`, `WorkflowEvent`, and `NodeEvent`.
- Moved `AccError` identity into `acc.domain` and re-exported it through `acc.utils` for compatibility.

## Supplemental Hardening

After a first-principles follow-up audit, three additional hardening changes were applied:

- Removed `acc.runtime -> acc.store` and `acc.runtime -> acc.app` dependencies. Runtime now receives retry-attempt cleanup as an injected callback, and nested workflow orchestration lives in `acc.app`.
- Strengthened architecture tests to reject runtime imports of store/app and to scan `acc.domain` / `acc.engine` for filesystem/process call sites such as `write_text`, `read_text`, `mkdir`, `open`, and subprocess creation.
- Removed duplicate topological-level computation during engine validation by sharing the computed levels with data-edge ancestry validation.
- Unified legacy `.graph.json` execution behind `WorkflowAppService` by adding
  `LegacyGraphImporter`.
- Removed `acc.workflow_runner` after production code and tests no longer used it.
- Routed workflow CLI and server run/validate paths through `WorkflowAppService`; routed debugger
  rerun/fork lineage execution through the same service.
- Preserved legacy UI-authored `.graph.json` files that contain `policy` plus old `edges` by
  importing those `edges` as canonical control edges before scheduling.
- Narrowed `acc.workflow_graph` to legacy authoring/inspection helpers: runtime-facing app,
  store, runtime, CLI, server, and `LegacyGraphImporter` no longer import it.
- Reused `acc.engine.topological_levels` for legacy graph topological order/levels to avoid a
  second DAG scheduler implementation.

## Responsibility Map

- Old `acc.clean_workflow`: removed. Its previous responsibilities are owned directly by `acc.app`, `acc.engine`, `acc.store`, and `acc.runtime`.
- New `acc.domain`: stable value objects and user-facing `AccError`; no store/runtime/engine/CLI dependency.
- New `acc.ports`: protocol contracts for store, event sink, node runner, clock, id generator, and path resolver.
- New `acc.engine`: pure graph/domain semantics. It does not import store/runtime/CLI or perform filesystem writes, subprocess execution, or env reads.
- New `acc.store`: filesystem persistence and path safety. It does not import engine/runtime/CLI.
- New `acc.runtime`: node execution and execution-safety policy. It does not import CLI/server.
- New `acc.app`: the only new layer that coordinates engine + store + runtime.
- Removed `acc.workflow_runner`: legacy `.graph.json` execution is imported into canonical
  `WorkflowTemplate` and delegated to `acc.app`.

## Deleted, Kept, Renamed

- Deleted: `acc.clean_workflow.py`, `acc.workflow_runner.py`.
- Kept: CLI behavior for `.accflow.json` validate/run/bind, now routed directly to `acc.app` and `acc.store`.
- Kept: legacy `.graph.json` public behavior, now routed through `WorkflowAppService` and
  compatibility output mirrors (`nodes/`, `node_runs/`, `workflow_graph.json`, run summaries).
- Renamed: no public command was renamed.
- Replaced: `.accflow.json` clean-core implementation was replaced by app/engine/store/runtime collaboration.
- Replaced: `.graph.json` direct runner scheduling was replaced by import-to-WorkflowTemplate plus
  app-service execution.

## Import Boundary Evidence

Command:

```text
uv run pytest -q tests/architecture/test_import_boundaries.py
```

Result:

```text
9 passed
```

Boundary checks cover:

- `acc.domain` imports no IO/process/UI or upper-layer modules.
- `acc.engine` imports no store/runtime/CLI/server/process modules.
- `acc.store` imports no engine/runtime/CLI/server/process modules.
- `acc.runtime` imports no store/app/CLI/server/UI modules.
- `acc.app` imports no CLI.
- `acc.domain` and `acc.engine` do not call filesystem/process APIs.
- `acc.cli` does not import concrete runtime runners.
- runtime-facing layers do not import legacy `acc.workflow_graph` authoring helpers.
- `acc.workflow_runner` no longer exists; tests use `WorkflowAppService` directly.
- `acc.debugger` does not import old workflow runner internals.

## Security Contract Evidence

Command:

```text
uv run pytest -q tests/unit/test_ideal_layering_security.py
```

Result:

```text
8 passed
```

Covered negative tests:

- dangerous permission rejected by default,
- network rejected in hermetic mode,
- full host env inheritance rejected,
- runtime only passes explicitly whitelisted env,
- `writes_workspace` requires workspace write lock,
- path traversal rejected.

## Store Contract Evidence

Acceptance run:

```text
uv run acc workflow run examples/workflows/ideal_layering_serial.accflow.json --run-dir runs/acceptance_ideal_layering_serial --emit-json
```

Verified files/directories:

- `workflow_run_manifest.json`
- `workflow_events.jsonl`
- `environments/root_env/environment_manifest.json`
- `nodes/a/events.jsonl`
- `nodes/a/output.json`
- `nodes/a/artifact_bundle.json`
- `nodes/a/inbox/`
- `nodes/a/outbox/`
- `nodes/b/events.jsonl`
- `nodes/b/output.json`
- `nodes/b/artifact_bundle.json`
- `nodes/b/inbox/`
- `nodes/b/outbox/`

## Performance Sanity Evidence

- `tests/unit/test_ideal_layering_security.py::test_topological_levels_1000_node_sanity` validates 1000-node level computation through `acc.engine.topological_levels`.
- Existing `tests/unit/test_clean_workflow_engine.py::test_clean_topological_levels_large_dag_is_linear_time_shape` remains passing through direct `acc.app` / `acc.engine` imports.

## Final Acceptance Results

Commands run:

```text
uv run pytest -q tests/architecture/test_import_boundaries.py
uv run pytest -q
uv run ruff check .
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_layering_echo --emit-conductor-json
python -m json.tool runs/acceptance_tmp/acc_layering_stdout.json
uv run acc workflow validate examples/workflows/ideal_layering_serial.accflow.json --json
uv run acc workflow run examples/workflows/ideal_layering_serial.accflow.json --run-dir runs/acceptance_ideal_layering_serial --emit-json
uv run acc workflow validate examples/workflows/ideal_layering_parallel.accflow.json --json
uv run acc workflow run examples/workflows/ideal_layering_parallel.accflow.json --run-dir runs/acceptance_ideal_layering_parallel --emit-json
uv run acc workflow run examples/workflows/nested_environment_demo.accflow.json --run-dir runs/acceptance_nested_recheck --emit-json
```

Results:

- `uv run pytest -q`: 227 passed.
- `uv run ruff check .`: passed.
- Dependency-boundary tests: 9 passed.
- CLI JSON smoke: passed; stdout parsed as one JSON object.
- Serial ideal-layering workflow validate/run: passed.
- Parallel ideal-layering workflow validate/run: passed.
- Legacy `.graph.json` import/run equivalence tests: passed.
- Server workflow run app-service routing smoke: passed.
- Browser E2E: passed; latest report `runs/browser_e2e/2026-05-26T16-15-06-698Z/browser_e2e_report.json`, with Chinese UI, capsule creation, two-node workflow, parallel workflow, debugger replay, and GraphOps safety journeys all passing.
- Nested workflow recheck: passed.
- Store evidence check: passed.
- `rg "from acc\\.clean_workflow|import acc\\.clean_workflow|acc\\.clean_workflow" acc tests`: no code/test imports remain.

Note:

- On Windows/PowerShell, plain `>` writes UTF-16 by default. For the JSON smoke file, the equivalent local check wrote stdout as UTF-8 before running `python -m json.tool`.

## No Forbidden Scope Creep

This refactor did not add:

- database backend requirement,
- cloud service dependency,
- default real external agent dependency,
- custom LLM agent loop,
- full Conductor DSL clone.

## Remaining Risks

- `.graph.json` remains a legacy compatibility format. It is not the canonical runtime format;
  `.accflow.json` / `WorkflowTemplate` is canonical.
- `acc.environment` and `acc.port_io` remain because legacy capsule execution context and port
  inspection compatibility still need their data shapes.
- `acc.cli.py` is still a large Typer entry module. It preserves behavior, but it is not yet as thin as the ideal target for all command families.
- `acc.domain` still uses `Path` value objects for environment/runtime path fields. It performs no IO, but a stricter future domain model could replace these with string/path value wrappers if portability pressure increases.
- Real external agent runners still need additional integration hardening before enabling non-hermetic execution by default.

## Next Step Recommendation

Continue thinning non-workflow CLI command handlers so CLI parsing and output presentation are the
only remaining CLI responsibilities. Longer term, retire `.graph.json` authoring in favor of saved
`.accflow.json` templates after users have a migration path.
