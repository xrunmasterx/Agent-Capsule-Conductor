# Workbench Projection Contract

生成日期: 2026-06-21

## SPEC

Workbench renders workflows, runs, node inspectors, logs, events, artifacts, and assistant authoring state from stable projection objects, not raw runtime storage schemas.

Runtime evidence remains available for debug and audit, but standard UI behavior must not depend on raw manifest layout.

## Projection Objects

### WorkflowCanvasProjection

Stable fields:

- workflow id/version/name;
- nodes with display labels, callable refs, ports;
- control/data edges;
- validation warnings;
- selected run pointer, if any。

### RunTimelineProjection

Stable fields:

- run id;
- status;
- started/ended timestamps;
- ordered events;
- waiting/decision states;
- terminal summary。

### NodeInspectorProjection

Stable fields:

- node id / display label;
- callable summary;
- execution status;
- declared inputs and binding sources;
- outputs/result refs;
- artifacts;
- transcript/log handles;
- warnings;
- debug evidence links。

### BindingSummaryProjection

Stable fields:

- payload key;
- source type: workflow_input / data_edge / result_ref / artifact_ref / snapshot_input / static_default;
- source id/ref;
- materialization mode;
- required/optional;
- warning if compatibility path used。

### ArtifactPreviewProjection

Stable fields:

- artifact id/ref;
- kind;
- size;
- preview availability;
- download/debug handle。

### LiveEventProjection

Stable fields:

- event id;
- monotonic sequence;
- run id;
- node id if applicable;
- event type;
- user-facing text/status;
- refetch hints;
- timestamp。

### AuthoringIntentProjection

Stable fields:

- user intent;
- selection semantics;
- target graph operation proposal;
- validation context refs;
- optional debug canvas snapshot ref。

## DESIGN

### Inspector Information Architecture

1. Human-readable summary.
2. Declared inputs and outputs.
3. Binding/source explanation.
4. Artifacts and previews.
5. Logs/transcripts.
6. Technical debug/evidence disclosure.

### Live Updates

Client receives projection events and refetch hints. Server handles gap/replay/offset details. Process-local queue overflow or file-tail mechanics are not UI business logic.

### Authoring Assistants

Workbench sends normalized intent and graph operation proposals. Raw canvas snapshots are permitted only as debug/evidence refs, not default prompt truth.

## IMPLEMENTATION_ORDER

1. Define TypeScript types for projection objects.
2. Build backend projection adapters from current evidence.
3. Migrate node inspector to `NodeInspectorProjection`.
4. Migrate live event hook to `LiveEventProjection`.
5. Move raw evidence display behind debug disclosure.
6. Normalize assistant context input.
7. Remove standard component dependency on runtime side-channel fields.

## ACCEPTANCE / TEST_PLAN

- UI snapshot tests use projection fixtures only.
- TypeScript component props do not include raw `runtime.json` / `binding_manifest.json` only fields in standard paths.
- Debug evidence disclosure has separate fixtures.
- Live hook tests use projected event vocabulary and refetch hints.
- Assistant authoring tests submit normalized intent/proposals rather than raw canvas snapshots as durable truth.
