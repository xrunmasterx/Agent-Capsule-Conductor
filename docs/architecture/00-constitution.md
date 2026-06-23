# ACC Architecture Constitution

## Status

This document is the highest active architecture authority for ACC. If it conflicts with `AGENTS.md`, `README.md`, `docs/README.md`, `docs/CURRENT_ARCHITECTURE.md`, implementation roadmaps, audits, or archived documents, this document wins.

## Mission

ACC is a local-first orchestration runtime for wrapping mature external agents, local tools, and workflow functions as reusable callable assets. ACC coordinates execution boundaries, control decisions, explicit data movement, evidence, artifacts, projections, and governed durable mutation.

## Non-Goals

- ACC does not implement a custom LLM reasoning loop.
- ACC does not teach agents how to perform their internal work.
- ACC does not make UI state, server DTOs, polling state, or SSE state durable runtime truth.
- ACC does not require a database, cloud backend, Kubernetes, or SaaS surface for core execution.
- ACC does not allow archived documents to define current architecture.

## Constitutional Invariants

### 1. ACC orchestrates; callable workers execute

External agents, tools, and child workflows own their internal behavior. ACC prepares inputs, dispatches work, records evidence, and moves outputs.

Current anchors: `AGENTS.md:78-85`, `docs/sdd/07-control-modes.md:11-22`.

### 2. Definitions are stateless; invocations are run-scoped

Reusable templates must not store run directories, workspace bindings, session ids, provider memory, or conversation history. Runtime identity belongs to `FunctionInvocation`, `ScopeFrame`, `SessionInstance`, run records, events, result values, and artifacts.

Current anchors: `acc/models.py:266-385`, `acc/models.py:397-491`.

Known deviation: executable metadata still permits runtime-like keys in `acc/models.py:58-89`, and `NodeInvocationSpec.metadata` exists in `acc/models.py:353-370`.

### 3. Control authorization is separate from data movement

Control edges and control decisions authorize or order execution. Data rights move only through explicit inputs, ports, data edges, bindings, inbox/outbox materialization, result refs, and artifacts.

Known deviation: `control_main_default` and `control_main_aggregate` in `acc/runtime/node_payload.py:138-185` create implicit dataflow from control predecessors.

### 4. Control modes are strategies over one target substrate

Fixed workflow, supervisor, handoff, human gate/resume, and nested workflow are target control strategies over one execution substrate. They may differ in who authorizes the next step, but the post-decision dispatch and evidence obligations should converge.

Current anchors: `acc/models.py:496-825`, `acc/app/runtime/dispatch_gate.py:59-235`.

Known deviation: supervisor and handoff are not fully converged with the fixed runtime path (`acc/app/supervisor.py:390-490`, `acc/engine/handoff.py:40-43`).

### 5. Runtime evidence is durable truth

Run-scoped evidence, ResultStore values, artifacts, and event logs are durable truth. Summaries, indexes, server projections, frontend stores, polling state, and SSE streams are derived.

### 6. GraphOps governs durable asset mutation

Durable callable/workflow mutation follows proposal, validation, dry-run, human approval, and apply unless a later active architecture spec defines another governed path.

Current anchors: `acc/graphops.py:276-510`.

### 7. Compatibility is explicit and bounded

`.accflow.json` is canonical for workflow templates. `.graph.json` is import-only or explicit-rejection input. Callable YAML assets and workflow YAML compatibility require separate treatment.

### 8. Architecture claims require proof obligations

Every invariant in this constitution needs tests or documented proof obligations. New control modes, evidence schemas, or compatibility exceptions must add or update proofs.

## Current Fact, Target Invariant, Known Deviation

Architecture docs must label facts as one of:

- Current fact: verified behavior in current code.
- Target invariant: desired architecture rule.
- Known deviation: current behavior that does not match the target and must be tracked.
