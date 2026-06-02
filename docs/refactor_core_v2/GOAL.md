# ACC Core v2 Replacement Goal

Status: Phase 0 baseline
Source goal: `docs/goal.md`
Created: 2026-06-01

## Objective

Replace ACC's current mixed core with a single canonical runtime model:

```text
canonical .accflow.json
  -> WorkflowFunctionTemplate
  -> pure domain validation
  -> ExecutionPlan
  -> FunctionInvocation
  -> root ScopeFrame
  -> NodeInvocationSpec scheduling
  -> explicit binding resolution from ResultStore / workflow input
  -> agent_payload / runtime_payload / binding_manifest materialization
  -> CallableRef execution as SessionInstance
  -> ArtifactBundle capture
  -> ResultStore write
  -> EventLog append
  -> RunRecord update
  -> CLI / API / debug projection
```

The end state is intentionally not "old and new side by side". Legacy concepts may survive only as migration inputs, explicit rejection tests, historical fixtures, historical documentation, or read-only historical run inspection.

## Precedence

Within the Core v2 refactor, this document and `CORE_V2_CONTRACT.md` supersede compatibility-oriented clauses that require legacy runtime behavior to remain executable. They do not supersede stable invariants from `AGENTS.md`:

- default tests stay hermetic;
- machine-readable stdout emits exactly one JSON object;
- ACC does not implement a custom LLM reasoning/tool loop;
- ACC stays lightweight and local-first;
- template state remains separate from runtime state;
- data movement stays explicit;
- GraphOps stays human-governed;
- layer boundaries remain clear.

The practical rule is: legacy behavior may be preserved as migration, rejection, historical fixture, or read-only inspection evidence, but not as a second runtime execution path.

## Problem Being Solved

The current codebase has a callable-first architecture on paper, but the executable hot path still consumes legacy workflow and capsule concepts. The concrete risk is not only naming debt. The runtime still reads semantic fields from `NodeSpec.raw`, dispatches through `CapsuleRunner`, writes legacy mirrors such as `node_runs/`, and allows binding modes that preserve legacy payload injection.

That makes ACC hard to reason about because a run can be driven by more than one source of truth:

- `WorkflowTemplate` and `NodeSpec` still define execution shape.
- `NodeSpec.raw` still carries runtime semantics such as permissions, retry, timeout, legacy capsule ids, input mappings, value edges, and workflow-call bindings.
- `CapsuleSpec` / `CapsuleRunner` still participate in app-level execution.
- `binding_mode` changes payload semantics instead of the canonical model being explicit.
- `workflow_summary.json`, `node_runs/`, `workflow_graph.json`, and legacy manifests can be treated as runtime facts.

Core v2 removes these parallel paths. There should be exactly one model for what runs, one model for how data moves, and one evidence model for explaining what happened.

## Non-Negotiable Principles

1. New model only in the runtime hot path.
   `acc.app`, `acc.runtime`, `acc.store`, and `acc.engine` must execute only `WorkflowFunctionTemplate`, `ExecutionPlan`, `NodeInvocationSpec`, `CallableRef`, `FunctionInvocation`, `ScopeFrame`, `SessionInstance`, `ArtifactBundle`, `ResultStore`, `RunRecord`, `EventLog`, and `FailureRecord`.

2. Compatibility does not enter the core.
   Legacy formats are handled only by `migrate -> canonical v2`, explicit rejection with migration hints, or read-only historical inspection.

3. No raw semantic tunnel.
   Runtime/app/store/engine must not read `node.raw[...]` for execution semantics. Fields currently hidden in raw must become typed canonical fields.

4. ACC does not own a custom LLM reasoning loop.
   External agents own their internal reasoning and tool loop. ACC owns execution boundaries, cwd/scope, permissions, payload materialization, adapter invocation, artifact capture, events, manifests, and failure classification.

5. Evidence first.
   Every run must answer: workflow function, function invocation, scope frame, node invocation, session instance, input source, output destination, artifact bundle, failure layer, stdout path, and stderr path.

## Out Of Scope

- Workbench UI redesign or visual canvas behavior.
- A database, cloud backend, marketplace, distributed worker system, or team permission system.
- Custom LLM planning/tool-calling inside ACC.
- Preserving legacy byte-equivalent runtime behavior after the new model becomes the hot path.

## Phase Order

0. Freeze scope and deletion inventory.
1. Establish canonical domain model.
2. Establish canonical loader, validator, and compiler.
3. Replace `CapsuleRegistry` with `CallableRegistry`.
4. Replace app workflow hot path.
5. Replace binding and payload contract.
6. Replace runtime, scheduler, and session lifecycle.
7. Replace store, manifest, result store, and artifact layout.
8. Replace CLI, API, and debugger projection.
9. Move GraphOps onto the canonical model.
10. Delete old models and old runtime paths after runtime and tests no longer use them.

Do not start by deleting files. The correct order is to replace runtime usage, replace test usage, then remove dead code.

## Phase 0 Exit Criteria

Phase 1 must not start until all of the following are true:

- the five Phase 0 documents exist;
- current contract conflicts are explicitly listed;
- every required legacy inventory item has a legal final classification;
- each inventory row names the current layer, current hot-path role, v2 replacement, removal phase, and gate;
- baseline test results for `uv run pytest -q` and `uv run ruff check .` are recorded;
- search baselines for the legacy terms are recorded;
- no Phase 0 change adds new runtime compatibility behavior.

## Completion Definition

The whole goal is complete only when all final gates from `docs/goal.md` pass, including:

- runtime hot path has zero `NodeSpec`, `WorkflowTemplate`, `node.raw`, `CapsuleSpec`, `CapsuleRunner`, `legacy_capsule_id`, `input_mapping`, and `legacy_value_edges`;
- `CallableKind` does not contain `legacy_capsule`;
- `BindingMode`, `legacy_full`, and `mixed` are removed from executable paths;
- `.graph.json` cannot run, validate, save, list, or show as a runnable workflow;
- `CapsuleSpec` can only feed migration, not runtime;
- `ResultStore`, `SessionInstance`, `ScopeFrame`, `RunRecord`, and `EventLog` are the relevant facts of record;
- new run directories do not write `node_runs/`, `workflow_graph.json`, or `legacy_compatibility`;
- `--emit-json` stdout is exactly one JSON object and logs go only to stderr/files;
- artifact, scope cwd, migration output, and GraphOps apply paths are protected.
