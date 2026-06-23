# ACC API and UI Boundaries

## Status

This document defines the server/API/Workbench boundary required by `docs/architecture/00-constitution.md`: runtime evidence is truth; server and Workbench are projections or transports.

## SPEC

Server endpoints are classified into four tiers:

| Tier | Purpose | Rule |
| --- | --- | --- |
| orchestration/write | submit runs, answer human gates, apply governed mutations | route delegates to app service |
| projection/read | run timeline, node inspector, workflow canvas, artifact summaries | route delegates to projection service |
| evidence/debug | raw manifests, raw logs, raw artifact files | explicit technical/debug API |
| transport/live | SSE/WebSocket/live events | projected event vocabulary + recovery contract |

Workbench standard views consume stable projection schemas. Raw runtime files are not normal UI contracts.

## DESIGN

### Projection Objects

- `WorkflowCanvasProjection`
- `RunTimelineProjection`
- `NodeInspectorProjection`
- `BindingSummaryProjection`
- `ArtifactPreviewProjection`
- `LiveEventProjection`
- `AuthoringIntentProjection`

### NodeInspectorProjection

Node inspector should present:

1. user-facing status and summary;
2. declared inputs and binding sources;
3. output/result refs;
4. artifacts and previews;
5. transcript/log handles;
6. warnings;
7. debug links to raw evidence.

It should not force UI components to parse `runtime.json`, `binding_manifest.json`, absolute paths, or session manifests for standard rendering.

### Live Event Contract

Live events expose domain/projection events with monotonic ids. Queue overflow, replay details, process-local bus mechanics, and file-tail implementation are server responsibilities, not Workbench state logic.

### Endpoint Tiering Rules

Route handlers may:

- parse request;
- call an app/projection/evidence service;
- translate errors to HTTP responses.

Route handlers must not:

- compile runtime graphs inline;
- construct callable registries as business logic;
- claim runs and submit jobs independently in multiple routes;
- merge JSONL/event streams manually when a projection service should own that policy.

## Known Deviations

- Some routes still perform runtime graph preparation and submission setup.
- Workbench and route code may consume raw runtime side-channel fields.
- Live stream paths include polling/file-tail mechanics.

## IMPLEMENTATION_ORDER

1. Define projection schemas and TypeScript types.
2. Extend projection endpoints to cover inspector/timeline/artifact needs.
3. Migrate Workbench standard views from raw evidence to projections.
4. Move raw runtime manifests behind debug/evidence disclosure.
5. Split live transport mechanics from projected event vocabulary.
6. Add route boundary/static checks for orchestration logic in HTTP handlers.

## ACCEPTANCE / TEST_PLAN

- UI snapshot tests use projection fixtures.
- Standard Workbench components do not require raw runtime manifest fields.
- Route tests prove run submission uses a shared application service.
- Live event tests assert monotonic ids and recovery semantics at API level.
- Debug/evidence APIs remain available for technical troubleshooting.
