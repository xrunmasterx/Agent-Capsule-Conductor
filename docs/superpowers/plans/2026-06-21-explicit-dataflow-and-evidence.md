# Explicit Dataflow and Evidence Plan

> **For workflow agents:** This plan removes hidden dataflow only after canonical workflows and tests are migrated to explicit bindings/result refs/snapshot inputs.

## Current audit status (2026-06-22)

Status: **partially complete**. Strict explicit-dataflow mode, richer binding manifests, and typed supervisor/handoff snapshot evidence are implemented. The plan remains open because legacy control-main compatibility is still the default, canonical workflows/fixtures are not fully migrated to strict bindings, and deletion of compatibility branches remains blocked.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Make all data movement explicit and auditable. Control edges authorize execution only; they must not move payload data.

## Architecture

Target:

```text
PureBinder
  -> logical sources: workflow input / data edge / result ref / artifact ref / snapshot input
RuntimeBindingMaterializer
  -> payload file + binding_manifest.json + evidence refs/hashes/debug handles
```

Every payload key must be explainable by `binding_manifest.json`.

## Must Read

- `AGENTS.md`
- `docs/architecture/04-data-plane-and-evidence.md`
- `docs/superpower_acc_architecture/SPEC.md`
- `docs/superpower_acc_architecture/SECOND_PASS_CLEANUP_AUDIT.md`
- `acc/runtime/node_payload.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/dispatch_gate.py`
- `acc/engine/control_flow.py`
- `tests/integration/test_core_v2_control_ledger_runtime.py`
- `tests/integration/test_handoff_p0.py`

## Constraints

- Do not delete `control_main_default` / `control_main_aggregate` until workflows/fixtures/tests are migrated.
- Do not replace hidden static_input with another hidden side channel.
- Supervisor/handoff context must become typed snapshot input or explicit result/artifact ref.
- Runtime evidence remains truth; projections are derived.

## Tasks

### Task 1 — Inventory implicit dataflow

Find all payload paths that can receive data without an explicit binding:

- control-main forwarding;
- aggregate main from multiple predecessors;
- supervisor snapshot/static_input;
- handoff context/static_input;
- provider/session carry-forward if used as data.

### Task 2 — Define strict binding manifest contract

For every payload key, manifest must include:

- target payload key / input port;
- source kind;
- source ref;
- materialization mode;
- required/optional;
- hash or evidence ref if materialized;
- compatibility warning if applicable.

### Task 3 — Add negative proof tests

Tests must prove:

- control-only predecessor does not provide payload in strict mode;
- missing required binding fails;
- every payload key has binding manifest entry;
- multi-predecessor aggregate requires explicit aggregate binding;
- supervisor/handoff snapshot requires typed snapshot input.

### Task 4 — Split binder responsibilities

Refactor toward:

- pure binder: no filesystem, computes logical input refs;
- runtime materializer: writes payload and binding manifest.

Keep behavior equivalent while compatibility remains enabled.

### Task 5 — Migrate canonical workflows and fixtures

Convert checked-in workflows/tests from implicit `main` behavior to explicit:

- workflow input binding;
- data edge;
- result ref;
- artifact ref;
- typed snapshot input.

### Task 6 — Delete compatibility branches

After strict tests pass and fixtures are migrated, delete:

- `control_main_default`;
- `control_main_aggregate`;
- hidden static_input/snapshot reconstruction paths.

## Validation

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_handoff_p0.py
uv run pytest -q tests/unit/test_core_v2_output_schema_and_ports.py tests/unit/test_schema_driven_ports.py
```

Add proof tests for:

- control-only edge no payload;
- binding manifest complete;
- typed snapshot provenance;
- no hidden static_input path.

## Deletion Targets

- `acc/runtime/node_payload.py` control-main compatibility branches.
- `acc/app/runtime/dispatch_gate.py` static_input/snapshot backfill once replaced by typed snapshot input.
- Any tests that assert implicit control-main forwarding as desired behavior.

## Completion Criteria

- All runtime payload data is visible in binding manifest.
- No hidden data movement over control edges remains in canonical path.
- Compatibility code is deleted or isolated behind an explicit migration flag with removal date.
