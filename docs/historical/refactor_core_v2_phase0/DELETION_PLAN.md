# Core v2 Deletion Plan

Status: Phase 0 baseline

This plan deletes legacy concepts only after the canonical replacement is executable and tested. It deliberately avoids starting with file deletion.

## Strategy

1. Replace runtime usage.
2. Replace test usage.
3. Delete dead code.

If the new model cannot express a current capability, stop the phase and extend the canonical model. Do not hide the capability in `raw`, `metadata.legacy_*`, or a compatibility branch.

Every phase uses the same rollback rule:

```text
pause phase
record missing canonical semantics
extend canonical model
add validation and tests
continue migration
```

Rollback must not mean restoring a legacy fallback execution path.

## Phase 1: Canonical Domain Model

Entry condition:

- Phase 0 documents exist and baseline search/test results are recorded.

Allowed edits:

- domain model definitions;
- serialization helpers;
- pure validation helpers;
- unit tests.

Forbidden edits:

- app/runtime/store fallback branches;
- new `raw` semantic reads;
- metadata fields that affect execution.

Target:

- Define or converge `ClassTemplate`, `AgentClassTemplate`, `ToolClassTemplate`, `WorkflowFunctionTemplate`, `CallableRef`, `NodeInvocationSpec`, `ExecutionPlan`, `ExecutionNode`, `RuntimePolicy`, `RetryPolicy`, `TimeoutPolicy`, `PermissionProfile`, `PromptPolicy`, `ArtifactContract`, `InputBinding`, `OutputBinding`, `WorkflowCallBinding`, `FunctionInvocation`, `ScopeFrame`, `NodeInvocationRun`, `SessionInstance`, `ArtifactBundle`, `ResultStoreAddress`, `RunRecord`, `EventRecord`, and `FailureRecord`.

Remove from domain hot path:

- `NodeSpec`
- `WorkflowTemplate`
- `CallableKind.legacy_capsule`
- `BindingMode`
- `LegacyPassthroughBinding`
- `ControlEdge.context = upstream_output`

Tests:

- `tests/unit/test_core_v2_domain_model.py`
- `tests/unit/test_core_v2_serialization.py`
- `tests/unit/test_core_v2_validation.py`

Exit gate:

- `CallableRef.kind` allows only `agent_class`, `tool_class`, and `workflow_function`;
- metadata validation proves metadata does not affect runtime behavior;
- JSON serialization round trip is stable.

## Phase 2: Canonical Loader / Validator / Compiler

Entry condition:

- Phase 1 domain tests pass.

Forbidden edits:

- parsing `.accflow.json` v2 into `WorkflowTemplate`;
- normalizing `NodeSpec` into `NodeInvocationSpec` on the runtime path;
- accepting legacy fields as runnable v2 input.

Replace:

- `parse_clean_workflow_template -> WorkflowTemplate`
- `normalize_workflow_function_template(WorkflowTemplate)`
- `normalize_node_invocation_spec(NodeSpec)`

With:

- `parse_workflow_function_template(payload)`
- `load_workflow_function_template(path)`
- `validate_workflow_function_template(template)`
- `compile_execution_plan(template, workflow_input)`

Rejection:

- direct `.graph.json` run;
- direct `.graph.json` validate;
- runnable v2 payloads containing legacy fields.

Migration only:

- `acc migrate graph old.graph.json --out new.accflow.json`

## Phase 3: Callable Registry

Entry condition:

- loader/compiler can produce executable plans with `CallableRef`.

Forbidden edits:

- resolving `CallableRef` through `CapsuleSpec`;
- keeping `CapsuleRegistry` as the app/runtime discovery service;
- treating capsule ids as runtime ids.

Replace `CapsuleRegistry` with `CallableRegistry`.

Allowed asset sources:

- `callables/agents/*.yaml`
- `callables/tools/*.yaml`
- `workflows/*.accflow.json`

Allowed migration inputs:

- old `capsule.yaml`;
- old capsule ids;
- old `.graph.json` files.

Delete from runtime:

- `CallableRef -> CapsuleSpec -> CapsuleRunner`;
- class templates containing capsule payloads;
- legacy capsule id driving runtime execution.

Exit gate:

- `CallableRegistry` is the only app/runtime discovery entry;
- `CapsuleSpec`, `CapsuleRegistry`, and `CapsuleRunner` searches have no hot-path matches outside migration/rejection scope.

## Phase 4: Workflow Hot Path

Entry condition:

- canonical loader, validator, compiler, and callable registry exist.

Replace the current app-level execution path with:

```python
run_workflow_function_invocation(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
) -> RunRecord
```

Delete or move to migration/rejection:

- `run_legacy_graph_template`
- `run_workflow_template_instance(WorkflowTemplate, ...)`
- `execute_legacy_capsule_node`
- `is_legacy_capsule_node`
- `resolve_legacy_node_input`
- `resolve_legacy_value_edge`
- `fill_legacy_upstream_context_fields`
- `mirror_legacy_node_run`
- `write_legacy_run_compatibility_files`
- `ACC_USE_CALLABLE_DISPATCH`

Exit gate:

- new workflow run path does not branch by old/new format;
- `ACC_USE_CALLABLE_DISPATCH` no longer controls execution;
- `.graph.json` cannot enter this path.

## Phase 5: Binding And Payload

Entry condition:

- workflow hot path uses `ExecutionPlan` and `NodeInvocationSpec`.

Forbidden edits:

- mixed payloads;
- legacy five-segment payload injection;
- `upstream_context` injection from control edges;
- `LegacyPassthroughBinding`;
- default `node`, `workflow`, `input`, or `inbox` fields.

Delete:

- `BindingMode.LEGACY_FULL`
- `BindingMode.MIXED`
- `LegacyPassthroughBinding`
- implicit `upstream_context`
- implicit `node`, `workflow`, `input`, `inbox`
- legacy five-segment payload

Replace with:

- `agent_payload.json`
- `runtime_payload.json`
- `binding_manifest.json`
- `BindingResolver + ResultStore` as the only read channel.

Exit gate:

- `agent_payload.json`, `runtime_payload.json`, and `binding_manifest.json` are written for node calls;
- Phase 5 search gate has no execution-path matches;
- tests prove control edges do not move data.

## Phase 6: Runtime / Scheduler / Session Lifecycle

Entry condition:

- explicit binding artifacts exist for node calls.

Forbidden edits:

- app-level loops that become source of truth;
- runtime reading `NodeSpec.raw`;
- runtime invoking `CapsuleRunner`;
- committing completed nodes before output/artifact validation and `ResultStore` write.

Runtime responsibilities:

1. Resolve `CallableRef` to class template or workflow function.
2. Materialize payload.
3. Create `SessionInstance(status=running)`.
4. Execute adapter/subprocess or workflow call.
5. Capture stdout/stderr/exit code.
6. Validate outputs and artifacts.
7. Write `ArtifactBundle`.
8. Write `ResultStore`.
9. Finalize `SessionInstance`.
10. Append `EventLog`.

Scheduler responsibilities:

- ready set;
- max concurrency;
- failure mode;
- cancellation;
- checkpoint after `ResultStore` commit.

Exit gate:

- `SessionInstance` lifecycle is the only node execution state source;
- scheduler tests cover ready set, max concurrency policy, failure mode, cancellation, and checkpoint-after-result commit;
- failure tests cover binding, payload materialization, adapter, output validation, artifact validation, store commit, event commit, cancellation, and timeout.

## Phase 7: Store / Manifest / Artifact

Entry condition:

- `SessionInstance`, `ResultStore`, `ArtifactBundle`, and `EventLog` are written by the runtime.

Forbidden edits:

- writing `node_runs/` for new runs;
- writing `workflow_graph.json` for new runs;
- writing `legacy_compatibility` for new runs;
- treating `workflow_summary.json` as source of truth.

New run dirs must not contain:

- `node_runs/`
- `workflow_graph.json`
- `format: legacy_graph`
- `legacy_compatibility: true`
- `binding_mode: legacy_full`

`workflow_summary.json`, if kept, must be projection only.

Exit gate:

- run directory tests assert the forbidden files/fields are absent;
- `workflow_summary.json`, if present, is generated only from v2 facts and labeled projection-only.

## Phase 8: CLI / API / Debugger Projection

Entry condition:

- app use cases expose canonical workflow invocation and run projection.

Forbidden edits:

- server-side graph normalization;
- fallback-running legacy graph payloads;
- `acc run <capsule_id>` through `CapsuleSpec`;
- replay/debug from `.graph.json` temporary files;
- logs on stdout when JSON flags are used.

Allowed CLI:

- `acc workflow run workflow.accflow.json`
- `acc workflow validate workflow.accflow.json`
- `acc migrate graph old.graph.json --out workflow.accflow.json`
- `acc migrate capsule capsules/<id>/capsule.yaml --out callables/...`
- `acc runs show <run_id>`
- `acc runs events <run_id>`
- `acc runs artifacts <run_id>`

Disallowed CLI:

- `acc workflow run old.graph.json`
- `acc workflow validate old.graph.json`
- `acc run old_capsule_id` through `CapsuleSpec`

Server routes must call app use cases only and read projections from `RunRecord`, `EventLog`, `ResultStore`, and `ArtifactBundle`.

Endpoint migration:

- new runtime endpoints must name canonical workflow/function invocation rather than graph payloads;
- `/api/workflows/run-graph`, if retained, must reject or route to migration/read-only inspection only;
- server routes must not create temporary `.graph.json` replay sources.

Exit gate:

- `.graph.json` is rejected by run/validate/save/list/show as runnable workflow;
- `acc workflow import-graph`, if retained, aliases to migration or rejects;
- `acc workflow run --emit-json` and any retained `acc run --emit-conductor-json` produce exactly one JSON object on stdout.

## Phase 9: GraphOps

Entry condition:

- canonical loader/validator can validate GraphOps output before apply.

Forbidden edits:

- GraphOps generating `capsule_id`, `legacy_capsule_id`, `input_mapping`, `legacy_value_edges`, `.graph.json`, or old workflow graph shapes;
- apply without validation, dry-run, human approval, or path guard.

GraphOps may operate only on:

- `WorkflowFunctionTemplate`
- `NodeInvocationSpec`
- `CallableRef`
- `BindingSpec`
- `PermissionProfile`

GraphOps must not generate legacy fields, write `.graph.json`, or treat old `WorkflowGraph` as runtime truth.

GraphOps v2 patch operations must name `CallableRef` and binding specs, not `capsule_id`.

Exit gate:

- persistent apply requires validation passed, dry-run passed, human approval present, target path within workspace, and destructive operation record when destructive;
- output contains no legacy runtime fields.

## Phase 10: Final Deletion

Entry condition:

- Phases 1-9 pass their tests and search gates.

Forbidden edits:

- preserving dead legacy runtime paths for compatibility;
- rewriting tests to ignore missing v2 semantics;
- keeping byte-equivalence tests as runtime acceptance.

After all replacements and tests pass, remove:

- `NodeSpec` execution usage;
- `WorkflowTemplate` execution usage;
- `CapsuleSpec` runtime usage;
- `CapsuleRunner` runtime usage;
- direct legacy graph runner;
- legacy node input resolver;
- legacy upstream context builder;
- legacy value edge runtime resolver;
- legacy `node_runs` source-of-truth writer;
- `NodeSpec.raw` semantic reads;
- `BindingMode`;
- `LegacyPassthroughBinding`;
- legacy byte-equivalence tests.

Rewrite tests that depended on compatibility into:

- legacy input can migrate;
- legacy input cannot run directly;
- canonical v2 semantics are stable;
- new runtime never reads raw;
- new run record is source of truth.

Exit gate:

- Phase 10 search gates have no matches outside `acc/migration`, `tests/migration`, explicit rejection tests, and historical docs;
- full `uv run pytest -q` and `uv run ruff check .` pass.
