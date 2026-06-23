# ACC Data Plane and Evidence

## Status

This document expands the control/data separation and runtime-evidence truth model required by `docs/architecture/00-constitution.md`.

## SPEC

Control authorization and data movement are separate.

- Control edges, control policies, and control decisions authorize or order execution.
- Data moves only through workflow inputs, node input bindings, data edges, ResultStore refs, artifact refs, inbox/outbox materialization, or explicit snapshot input objects.
- Durable runtime truth lives in run-scoped evidence: run records, invocation/scope/session manifests, node inputs/outputs, binding manifests, ResultStore values, artifacts, events, failures, and decisions.
- Derived views include run summaries, indexes, server projections, frontend stores, polling state, and SSE/live stream state.

Forbidden by target architecture:

- implicit predecessor-output forwarding over control edges;
- hidden `static_input` backfill for supervisor/handoff payloads;
- direct upstream writes into downstream workspace/inbox;
- shared blackboards or hidden ambient context buses;
- raw browser canvas snapshots as durable runtime truth.

## DESIGN

### Binder Split

```text
PureBinder
  -> validates declared data requirements
  -> resolves logical input refs from workflow inputs, data edges, result refs, artifact refs

RuntimeBindingMaterializer
  -> writes payload files and binding manifests
  -> adds evidence refs, hashes, and debug handles
```

The binding manifest must explain every payload key.

### Evidence Ownership

| Evidence | Owner | Notes |
| --- | --- | --- |
| `function_invocation.json` | RunRepository | run-scoped invocation identity |
| `scope_frame.json` | RunRepository | runtime scope, workspace/inbox/outbox/artifact roots |
| node input/output files | NodeExecutionRecorder | evidence of adapter-facing payload and result |
| `binding_manifest.json` | Binder / Recorder | source explanation for every input key |
| ResultStore entries | ResultStorePort | durable value refs for downstream consumption |
| artifact bundles | NodeExecutionRecorder | stable produced files and provenance |
| events / decisions | EventSink / ControlLedgerPort | append-only timeline and authorization evidence |
| run summary / indexes | Projection services | derived and rebuildable |

### Snapshot Inputs

Supervisor/handoff may pass context only through explicit snapshot input objects. A snapshot input must declare:

- source control decision;
- source result/artifact/context ref;
- materialization mode;
- intended target node/input;
- provenance and hash if materialized.

## Known Deviations

- `acc/runtime/node_payload.py` still supports `control_main_default` / `control_main_aggregate` behavior.
- Supervisor/handoff dispatch may reconstruct nodes with snapshot/static inputs in `acc/app/runtime/dispatch_gate.py`.
- Some projections and UI views still depend on raw runtime side-channel files.

## IMPLEMENTATION_ORDER

1. Add warnings and proof-obligation tests for implicit control-main forwarding.
2. Introduce explicit snapshot input object for supervisor/handoff.
3. Require binding manifest coverage for every payload key.
4. Split pure binder from runtime materialization.
5. Convert canonical workflows/examples to explicit bindings/result refs.
6. Remove `control_main_default` / `control_main_aggregate` compatibility.
7. Keep run summaries/indexes derived and incrementally refreshed.

## ACCEPTANCE / TEST_PLAN

- A control-only predecessor never supplies downstream payload without explicit binding.
- Binding manifests identify the source of every node payload key.
- Supervisor/handoff snapshot data is represented as explicit input evidence.
- Run summaries and indexes can be rebuilt from durable run evidence.
- UI and server projections do not become source of truth.
