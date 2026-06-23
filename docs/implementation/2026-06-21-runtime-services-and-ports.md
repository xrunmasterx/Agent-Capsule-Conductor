# ACC Runtime Services and Ports

## Status

This document supplements `docs/architecture/02-runtime-kernel.md` and `docs/architecture/05-api-ui-boundaries.md`. It is a service decomposition guide, not a higher authority than the numbered architecture specs.

## SPEC

ACC runtime is assembled from small collaborating objects with explicit inputs and outputs.

Target architecture rejects:

- ambient cwd service locator;
- broad compatibility façade as canonical API;
- monkeypatch seam in runtime hot path;
- route-level runtime assembly;
- direct filesystem protocol knowledge spread across orchestrator/executor/lifecycle scripts.

## DESIGN

### ExecutionContext / ProjectContext

Created by CLI/server entrypoint and passed top-down.

Contains:

- project root;
- storage roots;
- callable registry;
- workspace bindings;
- environment policy;
- request identity;
- projection invalidator;
- adapter defaults.

### Core Services / Ports

| Service / Port | Responsibility |
| --- | --- |
| `WorkflowSubmissionService` | one run submission path for CLI/server/runner/Workbench |
| `RuntimeGraphPreparationService` | load/normalize/validate canonical workflow input |
| `RunRepository` | run/invocation/scope manifests, lifecycle state, path safety |
| `NodeExecutionRecorder` | node session evidence, binding manifest, logs, failure records |
| `ControlLedgerPort` | materialize and mutate run plan, plan steps, dispatches, decisions |
| `Binder` | resolve explicit input/result/artifact refs |
| `CallableInvocationPort` | invoke agent/tool/workflow/hermetic callables via one boundary |
| `AdapterProcessHarness` | shared subprocess/streaming lifecycle plumbing |
| `ResultStorePort` | store/load result values and refs |
| `EventSink` | append projected/evidence events |
| `ProjectionInvalidator` | incremental projection update trigger |
| `StorageProjectionService` | storage index upsert/delete/repair |

### Broad Service Splits

- Split `LocalRunnerService` into runner identity, capability discovery, workspace resolution, security policy, job repository.
- Split route-level submission setup into `WorkflowSubmissionService`.
- Converge `CallableInvocationService` / `AgentTurnService` / `CallableClassRunner` behind `CallableInvocationPort`.
- Delete `core_v2_runtime` compatibility shim after import migration.

## IMPLEMENTATION_ORDER

1. Add `ExecutionContext` / `ProjectContext`.
2. Move run submission setup into `WorkflowSubmissionService`.
3. Introduce repository/recorder ports beside existing filesystem writes.
4. Introduce `CallableInvocationPort` and adapt existing paths.
5. Extract `AdapterProcessHarness`.
6. Replace ambient `Path.cwd()` fallbacks.
7. Delete broad compatibility façade and duplicate submission surfaces.

## ACCEPTANCE / TEST_PLAN

- Tests can host two project roots in one process without cwd dependence.
- All run submission endpoints call one service.
- Adding a new adapter requires protocol code only, not duplicated timeout/cancel/log/output plumbing.
- Runtime hot path imports canonical modules/ports, not `acc.app.core_v2_runtime`.
- Route modules do not compile graphs or construct registries except through app services.
