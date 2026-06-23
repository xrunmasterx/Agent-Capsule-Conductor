# ACC Runtime Kernel

## Status

This document describes the current runtime substrate and the target convergence model. It does not claim that every control mode already uses one complete kernel.

## Current Fixed Workflow Path

Current fact:

```text
WorkflowFunctionTemplate
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> scheduler
  -> executor
  -> SessionInstance or child FunctionInvocation
  -> ResultStore values, events, artifacts, projections
```

Code anchors:

- `acc/engine/__init__.py:149-171` compiles workflow templates into `ExecutionPlan`.
- `acc/app/runtime/orchestrator.py:44-219` creates invocation/scope/run evidence and enters runtime execution.
- `acc/app/runtime/scheduler.py:29-96` performs bounded ready-queue execution.
- `acc/app/runtime/executor.py:96-175` resolves payloads, executes callables, and writes evidence.

## Target Runtime Responsibilities

A unified runtime substrate should own:

- Run admission.
- Plan-step registration.
- Ready-set selection.
- Bounded concurrency.
- Dispatch authorization.
- Node execution envelope construction.
- Evidence writes.
- Failure, waiting, cancellation, and finalization.
- Projection invalidation or rebuild triggers.

## Target Node Execution Envelope

`NodeExecutionEnvelope` is a target concept, not a current implemented type. It should provide a narrow adapter-facing execution contract:

- callable reference
- resolved input refs and payload path
- execution policy
- workspace capability
- result sinks
- evidence writer handle
- cancellation context

It must not expose full workflow internals, control-mode internals, or UI authoring state to external agents/tools.

## Known Deviations

- Dynamic dispatch still reconstructs or overlays template/node structures in `acc/app/runtime/dispatch_gate.py:98-111`.
- Supervisor retains procedural execution seams in `acc/app/supervisor.py:390-490`.
- Handoff has P0 capability gaps in `acc/engine/handoff.py:40-43`.

## Roadmap Link

Implementation sequencing is in `docs/implementation/2026-06-21-acc-runtime-refactor-roadmap.md`.
