# ACC Current Architecture

## Authority

This document is a summary. The detailed architecture authority is `docs/architecture/00-constitution.md` through `docs/architecture/08-architecture-proof-obligations.md`.

## One-Sentence Model

ACC turns reusable agent/tool/workflow definitions into isolated runtime invocations, moves data through explicit ports/results/artifacts, writes local evidence, and exposes CLI/server/Workbench projections without owning a custom LLM reasoning loop.

## Core Object Flow

```text
WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> ResultStore values, events, artifacts, and projections
```

## Runtime Truth and Projections

Durable runtime truth lives in run-scoped evidence: run records, event logs, node input/output files, ResultStore values, artifacts, and session evidence. Server projections, run summaries, indexes, Workbench stores, polling state, and SSE state are derived views or transports.

## Control Modes

Fixed workflow is the most mature current execution path. Supervisor, handoff, human gate/resume, and nested workflow share domain vocabulary and some dispatch/evidence infrastructure, but they are not yet fully converged into one complete runtime kernel. Current gaps are tracked in `docs/architecture/03-control-modes.md` and `docs/audits/2026-06-21-superpower-architecture-debt-audit.md`.

## Compatibility Boundary

Canonical workflow templates are `.accflow.json`. `.graph.json` is import-only or explicit-rejection input. Callable YAML assets and workflow YAML compatibility are separate concerns documented in `docs/architecture/07-compatibility-and-migration.md`.

## Workbench Boundary

The Workbench is an authoring and projection surface. It may cache task state and selected run pointers for usability, but run evidence remains backend filesystem truth.

## GraphOps Boundary

GraphOps governs durable callable/workflow mutation through proposal, validation, dry-run, human approval, and apply. GraphOps is separate from runtime execution.

## Verification Contract

Use the commands in `AGENTS.md` for backend, frontend, and documentation verification.
