# wf-02 Explicit Dataflow Handoff

## Files inspected

- `docs/superpowers/plans/2026-06-21-explicit-dataflow-and-evidence.md`
- `acc/runtime/node_payload.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/workflow_io.py`
- `acc/engine/workflow_validation.py`
- `acc/engine/control_flow.py`
- `acc/engine/supervisor.py`
- `acc/engine/handoff.py`
- `acc/app/supervisor.py`
- `acc/app/handoff.py`
- `acc/models.py`
- `acc/control_ledger_codec.py`
- `acc/serialization.py`
- `acc/result_store/filesystem.py`
- `acc/storage_refs.py`
- `tests/integration/test_core_v2_workflow_bindings.py`
- `tests/integration/test_core_v2_workflow_run.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_supervisor_planstep_p0.py`
- `tests/integration/test_handoff_p0.py`
- `tests/unit/test_core_v2_output_schema_and_ports.py`
- `tests/unit/test_supervisor_validation.py`
- `tests/unit/test_handoff_validation.py`
- `tests/server/test_runs_projection_api.py`
- `tests/server/test_agent_sessions_api.py`
- `tests/test_runtime_imports.py`

## Code paths changed

- `acc/runtime/node_payload.py`
  - Added manifest-backed payload binding records with `source_kind`, `source_ref`, `target_key`, `materialization_mode`, `required`, `materialized_sha256`, `value_sha256`, and source evidence refs.
  - Made `overrides.static_input` explicit in binding manifest as `source_kind="static_input"`.
  - Added `source_kind="snapshot_input"` manifest records for dynamic supervisor/handoff nodes when dispatch attaches `metadata.snapshot_input_ref` to runtime-created `NodeInvocationSpec`.
  - Added strict explicit-dataflow opt-in via template policies: `{"dataflow": "strict"}`, `{"dataflow": {"mode": "strict"}}`, `{"explicit_dataflow": true|"strict"}`, or `{"strict_explicit_dataflow": true}`.
  - In strict mode, control edges no longer synthesize `payload["main"]`.
  - Legacy control-main compatibility remains enabled by default but now records `source_kind="control_edge_compat"` and `compatibility_warning`.
  - Fixed fan-in aggregate evidence semantics: per-source `control_main_default` records are `source_only` and no longer claim `target_key="main"`; only `control_main_aggregate` records the materialized aggregate target hash.
- `acc/app/runtime/executor.py`
  - Preserves `binding_manifest.json` top-level `inputs`/`bindings` shape and adds `schema_version="acc.binding_manifest.v2"`.
- `acc/engine/workflow_validation.py`
  - Added matching strict explicit-dataflow predicate.
  - In strict mode, required input validation no longer treats control-main sources as incoming data.
  - In strict mode, available sources no longer advertises `control_main_default`.
  - In strict mode, suppresses the legacy `control_main_suppressed_by_data_edge` compatibility warning.
- `acc/engine/supervisor.py`
  - Adds typed snapshot provenance in supervisor dynamic PlanStep metadata.
  - Adds per-intent snapshot refs to supervisor `DecisionRecord.input_evidence_refs`.
  - Validates `plan_id` and `correlation_id` as safe path segments before generating snapshot paths.
- `acc/engine/handoff.py`
  - Adds typed snapshot provenance for handoff new-session dynamic PlanSteps.
- `acc/app/runtime/dispatch_gate.py`
  - Dynamic supervisor/handoff dispatch validates typed snapshot refs, requires typed ref path to be present in `PlanStep.input_snapshot_refs`, enforces `payload_key == "input_payload"`, preserves run-dir containment checks, and passes the provenance into node metadata so binding manifests report `source_kind="snapshot_input"`.

## Compatibility paths left in place

- Legacy control-edge dataflow remains the default compatibility path.
  - `control_main_default` and `control_main_aggregate` still materialize data unless strict mode is enabled.
  - Legacy records now emit compatibility warnings and richer evidence fields.
- `binding_manifest.json` remains backward-compatible at the top level: consumers can still read `inputs` and `bindings`.
- `runtime.json` / `runtime_payload.json` still expose `binding_materializations`.
- `PlanStep.input_snapshot_refs` remains the canonical serialized ledger field for dynamic payload snapshot paths.
- Typed snapshot provenance is currently stored in PlanStep metadata but dispatch only trusts it when its path matches `input_snapshot_refs`; this avoids metadata-only routing.
- Handoff `route_only` remains decision/evidence only and does not alter fixed target inputs.
- Nested workflow pass-through semantics were not removed in this slice.

## Deletion targets now safe / still blocked

Now safer:

- Strict-mode tests prove control edges can be treated as execution-only while scheduler/ledger behavior stays intact.
- Binding manifests are now rich enough to explain static input, workflow input, explicit input bindings, data edges, legacy control-main compatibility, aggregate fan-in, and dynamic snapshot inputs.
- Dynamic supervisor/handoff dispatch no longer leaves snapshot payloads indistinguishable from authored static input in the node binding manifest.

Still blocked:

- Deleting legacy `control_main_default` / `control_main_aggregate` compatibility is blocked until fixtures/workflows are migrated and strict mode is made default intentionally.
- Deleting `input_snapshot_refs` is blocked; it remains the canonical ledger path field.
- A first-class typed input ref field on `PlanStep` is still a future schema migration. Current metadata is provenance only and cannot route unless consistent with `input_snapshot_refs`.
- Nested workflow boundary provenance remains a follow-up: this slice did not add explicit `workflow_call_input` manifest records at the parent/child boundary.
- Existing stock workflow fixtures were not mass-migrated.

## Tests added or updated

- `tests/integration/test_core_v2_workflow_bindings.py`
  - Asserts v2 binding manifest schema version.
  - Asserts legacy control-main compatibility records include `source_kind="control_edge_compat"` and `compatibility_warning`.
  - Asserts workflow input records expose `source_kind="workflow_input"`.
- `tests/integration/test_core_v2_workflow_run.py`
  - Adds strict mode runtime test proving control edges do not forward `main`.
  - Strengthens legacy control-main manifest assertions.
  - Adds fan-in aggregate manifest regression assertions: per-source records are `source_only`; aggregate record owns the materialized `target_key="main"` hash.
- `tests/unit/test_core_v2_output_schema_and_ports.py`
  - Adds strict validation test proving required `main` is unbound when only a control edge exists.
  - Adds strict validation test suppressing legacy control/data compatibility warning when same-pair data edge exists.
- `tests/integration/test_supervisor_planstep_p0.py`
  - Asserts supervisor typed input refs and per-intent evidence refs.
  - Asserts dynamic worker binding manifest reports `source_kind="snapshot_input"`.
- `tests/unit/test_supervisor_validation.py`
  - Asserts supervisor typed input ref shape.
  - Asserts per-intent evidence ref on supervisor decisions.
  - Adds unsafe path segment rejection cases for `plan_id` and `correlation_id`.
- `tests/integration/test_handoff_p0.py`
  - Asserts handoff dynamic worker binding manifest reports `source_kind="snapshot_input"`.
- `tests/unit/test_handoff_validation.py`
  - Asserts handoff typed input ref shape and evidence refs.

## Commands run and results

- `uv run --project .. pytest -q ../tests/integration/test_core_v2_workflow_bindings.py ../tests/unit/test_core_v2_output_schema_and_ports.py`
  - Result: passed, `33 passed`.
- `uv run --project .. pytest -q ../tests/integration/test_core_v2_workflow_bindings.py ../tests/integration/test_core_v2_workflow_run.py ../tests/unit/test_core_v2_output_schema_and_ports.py ../tests/integration/test_supervisor_planstep_p0.py ../tests/unit/test_supervisor_validation.py ../tests/integration/test_handoff_p0.py ../tests/unit/test_handoff_validation.py`
  - Result: passed, `87 passed`.
- `uv run --project .. pytest -q ../tests/integration/test_core_v2_workflow_bindings.py ../tests/integration/test_core_v2_control_ledger_runtime.py ../tests/integration/test_handoff_p0.py ../tests/integration/test_supervisor_planstep_p0.py ../tests/unit/test_supervisor_validation.py ../tests/unit/test_handoff_validation.py ../tests/unit/test_core_v2_output_schema_and_ports.py ../tests/server/test_runs_projection_api.py ../tests/server/test_agent_sessions_api.py ../tests/test_runtime_imports.py`
  - Result: test suite code had repo-root-relative path assumption in `tests/test_runtime_imports.py`; from `docs/` this produced one path-related failure after `168 passed`.
- `Push-Location ..; uv run pytest -q tests/test_runtime_imports.py; Pop-Location`
  - Result: passed, `66 passed`.
- `Push-Location ..; uv run pytest -q tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_handoff_p0.py; Pop-Location`
  - Result: passed, `21 passed`.
- `Push-Location ..; uv run pytest -q tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_supervisor_planstep_p0.py tests/integration/test_handoff_p0.py tests/unit/test_core_v2_output_schema_and_ports.py tests/unit/test_supervisor_validation.py tests/unit/test_handoff_validation.py tests/server/test_runs_projection_api.py tests/server/test_agent_sessions_api.py tests/test_runtime_imports.py; Pop-Location`
  - Result before review fixes: passed, `199 passed`.
- After multi-agent review and blocker fixes:
  - `Push-Location ..; uv run pytest -q tests/integration/test_core_v2_workflow_bindings.py tests/integration/test_core_v2_workflow_run.py tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_supervisor_planstep_p0.py tests/integration/test_handoff_p0.py tests/unit/test_core_v2_output_schema_and_ports.py tests/unit/test_supervisor_validation.py tests/unit/test_handoff_validation.py tests/server/test_runs_projection_api.py tests/server/test_agent_sessions_api.py tests/test_runtime_imports.py; Pop-Location`
  - Result: passed, `199 passed`.

## Review findings fixed

A multi-agent implementation review found these blockers, all addressed:

- Metadata-driven dynamic dispatch could route from `metadata.typed_input_refs` without matching `input_snapshot_refs`.
  - Fixed by requiring typed ref path to be present in `PlanStep.input_snapshot_refs` and `payload_key == "input_payload"`.
- Unsafe supervisor path segment construction from `plan_id` / `correlation_id`.
  - Fixed by validating safe path segments before snapshot ref creation.
- Aggregate fan-in binding manifests misrepresented source records as materialized `target_key="main"` records.
  - Fixed by making per-source records `source_only` and leaving the aggregate record as the sole materialized target.
- Strict-mode validation still emitted legacy control/data suppression warning.
  - Fixed by gating the warning behind compatibility mode.

## Unresolved product decisions

- When to flip strict explicit-dataflow from opt-in to default.
- Whether typed input refs should become a first-class `PlanStep` schema field instead of provenance metadata.
- Whether to preserve or migrate `control_main_default` / `control_main_aggregate` for existing workflows after fixture migration.
- Whether nested workflow pass-through should remain compatibility behavior or require explicit `workflow_call_input_bindings` under strict mode.
- How much of the stock workflow fixture set should be migrated now versus in a dedicated fixture-migration batch.

## Recommended next workflow

Proceed to `wf-03-runtime-kernel` after reviewing wf-02, with one optional pre-step: migrate nested workflow boundary provenance (`workflow_call_input` records) if strict manifest completeness is required before runtime-kernel work.
