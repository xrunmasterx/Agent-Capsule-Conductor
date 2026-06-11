# ACC Core v2 Contract

Status: Phase 0 baseline

This contract supersedes compatibility-oriented implementation notes for the Core v2 refactor. It does not delete the current repository contract in `AGENTS.md`; instead, it defines the target state for the new clean core requested by `docs/goal.md`.

## Runtime Object Contract

Only these objects are allowed to drive runtime execution:

| Object | Responsibility |
| --- | --- |
| `AgentClassTemplate` | Reusable agent behavior class: adapter/runtime, default prompt policy, permission profile, ports, artifact contract. |
| `ToolClassTemplate` | Reusable local/tool behavior class: runner/adapter, permissions, ports, artifact contract. |
| `WorkflowFunctionTemplate` | Reusable stateless workflow function body. It owns node invocations, control edges, data bindings, exposed inputs, and exposed outputs. |
| `CallableRef` | Typed reference to an agent class, tool class, or workflow function. It never resolves through `CapsuleSpec`. |
| `NodeInvocationSpec` | One call site inside a workflow function. It contains typed callable ref, typed bindings, typed policies, and typed contracts. |
| `ExecutionPlan` | Validated, schedulable plan compiled from a workflow function and invocation input. |
| `FunctionInvocation` | One runtime call of a workflow function. |
| `ScopeFrame` | Runtime scope for cwd, inbox, outbox, artifact root, environment root, and behavior snapshot evidence. |
| `SessionInstance` | One concrete agent/tool execution in a scope frame; sole lifecycle fact for node execution. |
| `ArtifactBundle` | Stable output evidence from a node/session/workflow invocation. |
| `ResultStore` | Sole read source for node outputs used by bindings and workflow outputs. |
| `RunRecord` | Durable workflow-level runtime fact. |
| `EventLog` | Ordered event fact stream. |
| `FailureRecord` | Layered failure fact with cause, location, and evidence paths. |

## Current Contract Conflicts Frozen For This Refactor

| Conflict | Current compatibility contract | Core v2 target |
| --- | --- | --- |
| Legacy runtime behavior | Current docs say `.accflow.json`, `.graph.json`, `CapsuleSpec`, and `NodeSpec` behavior must not be removed without migration notes and tests. | Migration notes and tests are required, but legacy runtime execution is removed from the hot path. |
| `.graph.json` discovery | Current docs allow import-only handling and some list/show discovery. | `.graph.json` cannot run, validate, save, list, or show as a runnable workflow. The file itself can only migrate or be rejected; read-only historical inspection reads old run evidence, not `.graph.json` as a replay/runtime source. |
| Callable dispatch flag | Current docs describe `ACC_USE_CALLABLE_DISPATCH` as opt-in. | Core v2 has no opt-in flag; callable execution is the only runtime path. |
| `/api/workflows/run-graph` | Current API keeps a synchronous compatibility endpoint. | New runtime endpoints must express canonical workflow/function invocation. Legacy graph endpoints can only reject, migrate, or inspect read-only evidence. |
| Run artifacts | Current docs preserve public artifacts additively. | New v2 run layout must not write `node_runs/`, `workflow_graph.json`, or `legacy_compatibility`; historical runs are not rewritten. |

## Forbidden Runtime Objects

The following must not appear in `acc.app`, `acc.runtime`, `acc.store`, or `acc.engine` hot paths after Core v2:

- `NodeSpec`
- `WorkflowTemplate`
- `CapsuleSpec`
- `CapsuleRegistry`
- `CapsuleRunner`
- `CallableKind.legacy_capsule`
- `BindingMode`
- `LegacyPassthroughBinding`
- `NodeSpec.raw` / `node.raw`
- `.graph.json` direct execution
- `legacy_capsule_id`
- `input_mapping`
- `legacy_value_edges`
- `upstream_context` implicit payload injection
- `node_runs/`
- `workflow_graph.json`
- `legacy_compatibility`

Allowed locations for legacy concepts are limited to:

- `acc.migration.*`;
- `tests/migration`;
- explicit rejection tests;
- read-only historical run inspectors;
- historical fixtures;
- historical docs.

## Layer Contract

| Layer | Allowed responsibility | Must not do |
| --- | --- | --- |
| `acc.domain` | Pure typed records, value objects, and serialization helpers. | Filesystem IO, subprocesses, server/UI imports, environment reads, legacy runtime fields. |
| `acc.engine` | Pure validation, plan compilation, dependency analysis, scheduler shape. | Filesystem IO, registry scans, adapter invocation, legacy graph normalization as runtime path. |
| `acc.store` | Filesystem manifests, result store, event log, artifact bundle, path protection. | Infer runtime truth from legacy manifests or write legacy mirrors in new runs. |
| `acc.runtime` | Payload materialization policy, adapter/subprocess invocation boundary, stdout/stderr capture. | Read `NodeSpec.raw`, run `CapsuleRunner`, inject legacy payload segments. |
| `acc.app` | Use-case orchestration across engine/store/runtime. | Branch between old and new runtime paths, normalize old models on the hot path. |
| `acc.server` | Thin API layer over app use cases and projections. | Graph normalization, legacy field filling, runtime-state inference. |

## Canonical `.accflow.json` v2 Contract

The runnable workflow file format must use:

- `schema_version = "acc.core.v2"`;
- `nodes[*].callable_ref`;
- explicit input bindings;
- explicit workflow output bindings;
- control edges for readiness only;
- data movement through binding selectors and `ResultStore`;
- metadata that is non-executable.

Canonical migration CLI:

```text
acc migrate graph old.graph.json --out new.accflow.json
acc migrate capsule capsules/<id>/capsule.yaml --out callables/...
```

Older import commands such as `acc workflow import-graph`, if retained, must alias to migration behavior or reject with a migration hint. They must not run legacy graphs.

The runnable format must reject:

- `legacy_capsule_id`;
- `capsule_id`;
- `input_mapping`;
- `legacy_value_edges`;
- `legacy_passthrough`;
- `binding_mode = legacy_full`;
- old `kind` / `runtime` / `tool` / `workflow_ref` node shapes;
- `raw`.

## Binding Contract

Bindings are the only data movement channel:

```text
workflow input / ResultStore selector
  -> BindingResolver
  -> agent_payload.json
  -> runtime_payload.json
  -> binding_manifest.json
```

Rules:

- `agent_payload.json` contains only fields explicitly declared for the callable.
- `runtime_payload.json` contains only ACC runtime metadata.
- `binding_manifest.json` records source, selector, producer, required/optional state, materialization, and provenance.
- Control edges do not move data.
- `upstream_context`, `node`, `workflow`, `input`, `inbox`, and the old five-segment payload are not implicitly injected.

## Metadata Contract

`metadata` is non-executable. It may carry labels, descriptions, display hints, debug notes, and historical provenance. It must not affect:

- scheduling;
- callable resolution;
- permissions;
- retry or timeout policy;
- prompt policy;
- binding resolution;
- artifact contracts;
- environment or cwd selection.

Any such behavior must be represented as a typed canonical field and validated.

## Evidence Contract

New run directories must be organized around the new facts:

```text
run_manifest.json
function_invocation.json
scope_frame.json
events.jsonl
result_store/
nodes/<node_id>/node_invocation_run.json
nodes/<node_id>/session_instance_manifest.json
nodes/<node_id>/agent_payload.json
nodes/<node_id>/runtime_payload.json
nodes/<node_id>/binding_manifest.json
nodes/<node_id>/artifact_bundle.json
nodes/<node_id>/stdout.txt
nodes/<node_id>/stderr.txt
```

If `workflow_summary.json` remains, it is projection only and not a source of truth.

## Historical Inspector Contract

A read-only historical inspector may read old evidence such as `node_runs/`, `workflow_graph.json`, `session_manifest.json`, and legacy run manifests. It must not:

- replay from `.graph.json`;
- infer new runtime truth from old manifests;
- write updated legacy evidence;
- expose old artifacts as canonical `RunRecord` without explicit projection labeling;
- allow server/API callers to resume legacy execution.

## Public Surface Contract

`acc run <capsule_id>` is not a Core v2 runtime command. If retained as a public command, it must not execute legacy runtime; it may only become one of:

- explicit rejection with migration hint;
- capsule migration entry point;
- read-only historical run inspection command.

It must not keep `CapsuleSpec` as a runtime source.

## Failure Contract

Failures must be recorded at the layer where they occur:

- parse/load failure;
- domain validation failure;
- plan compilation failure;
- binding resolution failure;
- payload materialization failure;
- callable resolution failure;
- adapter/subprocess failure;
- output validation failure;
- artifact validation failure;
- store/result/event commit failure;
- cancellation/timeout.

Every failure must have a `FailureRecord` with a layer, cause, related ids, and evidence paths when available.
