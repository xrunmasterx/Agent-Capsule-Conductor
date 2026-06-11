# FINDINGS

Status: Baseline audit for Phase 10 ideal layering refactor.

Baseline commands run on 2026-05-26:

- `uv run pytest -q`: 205 passed.
- `uv run ruff check .`: passed.
- `uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_layering_echo --emit-conductor-json`: passed and emitted one JSON object.
- `uv run acc workflow validate examples/workflows/ideal_layering_serial.accflow.json --json`: failed with `node a requires string field kind`.
- `uv run acc workflow validate examples/workflows/ideal_layering_parallel.accflow.json --json`: failed with `node start requires string field kind`.

## Critical Findings

None found in the currently passing baseline. The old public test suite is green, so the refactor should preserve behavior first and add boundary enforcement incrementally.

## High Findings

### H1: `acc.clean_workflow` owns too many layers

Evidence:

- `acc/clean_workflow.py` imports `asyncio`, `hashlib`, `json`, `shutil`, `Path`, domain objects, `utc_now_iso`, and `load_json`.
- The same module parses WorkflowTemplate payloads, validates graph semantics, computes topological levels, creates EnvironmentFrames, schedules nodes, executes fake tool/agent nodes, materializes inboxes, writes outboxes, writes manifests, emits events, hashes files, and cleans retry attempts.

Root cause:

- Clean Core proved the model quickly, but it collapsed engine, store, runtime, and app responsibilities into one integration module.

First-principles violation:

- Engine logic is not pure.
- Store responsibilities are embedded in scheduling and execution.
- Runtime execution is not behind a hard permission/env/workspace contract.

Smallest safe fix:

- Extract pure parsing/validation/scheduling into `acc.engine`.
- Extract filesystem run layout, events, inbox/outbox, artifacts, and path safety into `acc.store`.
- Extract node execution and permission/env policy checks into `acc.runtime`.
- Make `acc.app` coordinate those layers.
- Reduce `acc.clean_workflow` to a compatibility facade.

### H2: Current domain model is incomplete for real runner safety

Evidence:

- `acc/domain.py` has basic `WorkflowTemplate`, `NodeSpec`, `ControlEdge`, `DataEdge`, `EnvironmentBinding`, `EnvironmentFrame`, and `ArtifactBundle`.
- It lacks first-class `PermissionProfile`, `EnvPolicy`, `WorkspaceAccess`, `RuntimeResult`, `WorkflowEvent`, `NodeEvent`, timeout policy, retry policy, and workflow state.

Root cause:

- Previous phase focused on fake-runner workflow semantics before hard real-agent integration contracts.

First-principles violation:

- Real runners can read env, shell out, access network, and write workspace, but those capabilities are still partly raw dict fields.

Smallest safe fix:

- Add explicit domain value objects and validators.
- Require executable nodes to resolve to a `PermissionProfile` before runtime execution.
- Add negative tests for dangerous permissions, full env inheritance, workspace write without lock, network in hermetic mode, and path traversal.

### H3: New ideal-layering examples do not match current accflow parser

Evidence:

- `examples/workflows/ideal_layering_serial.accflow.json` uses node fields `type` and `runner`.
- `acc.clean_workflow.parse_node_spec` currently requires `kind` and either `tool`, `runtime`, or `workflow_ref`.
- Acceptance validation currently fails with `node a requires string field kind`.

Root cause:

- The Phase 10 examples were added using the new wording before the parser accepted those aliases.

First-principles violation:

- The authoring IR and runtime parser disagree on the stable domain language.

Smallest safe fix:

- Normalize `type` -> `kind` and `runner: fake` -> `tool: fake_producer` or `runtime: generic_fake_agent` according to node kind.
- Keep old `kind/tool/runtime` accepted for backward compatibility.

### H4: Dependency direction is not enforced

Evidence:

- No `tests/architecture/test_import_boundaries.py` exists in the baseline.
- `tests/server/test_core_decoupling.py` only checks server dependency shape and is not enough for Phase 10.

Root cause:

- Earlier phases relied on convention instead of an executable import contract.

First-principles violation:

- Clean architecture boundaries are not verifiable.

Smallest safe fix:

- Add AST-based import boundary tests covering `acc.domain`, `acc.engine`, `acc.store`, `acc.runtime`, `acc.app`, and `acc.cli`.

## Medium Findings

### M1: `acc.workflow_runner` duplicates clean-core responsibilities for graph workflows

Evidence:

- `acc/workflow_runner.py` loads graphs, validates semantics, creates environments, materializes inboxes, invokes `CapsuleRunner`, applies failure mode, writes workflow outputs, and updates indexes.

Risk:

- Two workflow execution paths can drift: `.graph.json` and `.accflow.json`.

Smallest safe fix:

- Do not rewrite the old graph runner first. Make the ideal-layering app service cover `.accflow.json` acceptance, then decide whether legacy graph runner should become a facade in a later milestone.

### M2: Store path safety exists but is scattered

Evidence:

- `safe_child_path`, `copy_path`, `prepare_run_dir`, `prepare_node_attempt_dir`, and path traversal rejection are implemented locally inside workflow modules.

Risk:

- Future real runners can bypass safety unless all filesystem writes go through one store contract.

Smallest safe fix:

- Centralize run-scoped path resolution and materialization in `acc.store`.

## Low Findings

### L1: Phase 10 report files exist but are placeholders

Evidence:

- `FINDINGS.md`, `DECISIONS.md`, `MIGRATION_NOTES.md`, `RISK_REGISTER.md`, and `QUALITY_REPORT.md` contain only headings.

Smallest safe fix:

- Update them as milestones complete. Final `QUALITY_REPORT.md` must include command evidence.

## Supplemental Audit Findings

### S1: Runtime still depended on store/app after initial split

Severity: High

Evidence:

- `acc/runtime/__init__.py` imported `acc.store.prepare_node_attempt_dir` and `acc.store.write_json`.
- The workflow-node branch dynamically imported `acc.app.run_clean_workflow_template`.

Root cause:

- The first refactor separated files but left two convenience dependencies in runtime.

First-principles violation:

- Runtime should execute nodes inside a provided context; it should not know the persistence implementation or call the app orchestration layer.

Fix applied:

- Runtime now owns only local output writing helpers and receives attempt cleanup as an injected callback.
- Workflow node orchestration moved to `acc.app.execute_app_clean_node`.
- Import-boundary tests now explicitly reject `acc.runtime -> acc.store` and `acc.runtime -> acc.app`.

### S2: Pure-layer tests checked imports but not IO calls

Severity: Medium

Evidence:

- `tests/architecture/test_import_boundaries.py` originally only scanned imports.

Root cause:

- A pure layer can accidentally perform filesystem IO without importing forbidden packages if it calls methods such as `write_text`.

Fix applied:

- Added AST call scanning for forbidden filesystem/process calls in `acc.domain` and `acc.engine`.

### S3: Engine validation repeated topological analysis

Severity: Low

Evidence:

- `validate_clean_workflow_template` called `validate_data_edges_follow_control_dependencies`, which computed topological levels through `control_ancestors`, then computed topological levels again.

Root cause:

- Validation helpers were correct but did not share the already computed graph analysis.

Fix applied:

- `validate_clean_workflow_template` computes levels once and passes them to data-edge ancestry validation.
