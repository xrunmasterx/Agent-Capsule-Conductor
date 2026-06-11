# Core v2 Legacy Inventory

Status: Phase 0 baseline
Evidence date: 2026-06-01

Classification is intentionally restricted to:

- `delete`
- `replace`
- `migration tool only`
- `read-only historical inspector`
- `historical fixture only`

No item may be classified as temporary runtime compatibility, hot path adapter, or fallback execution path.

## Required Inventory

| Legacy item | Classification | Current layer | Current evidence | Current hot-path role | V2 replacement | Removal phase | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NodeSpec` | replace | domain/engine/app/runtime/store | `acc/domain.py` defines it with `raw`; `acc/engine/__init__.py` parses and validates it; `acc/app/__init__.py::run_clean_node`, `acc/runtime/__init__.py::execute_clean_node_with_policy`, and `acc/store/__init__.py::write_artifact_bundle` consume it. | Execution node, scheduler input, runtime policy input, artifact/session manifest input. | `NodeInvocationSpec` + `ExecutionNode`. | Phase 1-4, final delete Phase 10. | Phase 10 `rg "NodeSpec" acc/app acc/runtime acc/store acc/engine` has no hot-path matches. |
| `WorkflowTemplate` | replace | domain/engine/app/store | `acc/engine/__init__.py::parse_clean_workflow_template` returns it; `acc/app/__init__.py::run_workflow_template_instance` is still the main execution entry; `FileSystemWorkflowStore` is built around it. | Executable workflow root. | `WorkflowFunctionTemplate` + `ExecutionPlan`. | Phase 1-4, final delete Phase 10. | Phase 10 `rg "WorkflowTemplate" acc/app acc/runtime acc/store acc/engine` has no hot-path matches. |
| `NodeSpec.raw` / `node.raw` | replace | domain/engine/app/runtime | `normalize_node_invocation_spec` reads workflow-call bindings, environment policy, retry, timeout; `runtime.node_writes_workspace` reads raw permissions/write flags; `is_legacy_capsule_node` reads `legacy_capsule_id`. | Semantic escape hatch for execution fields. | Strong typed fields: `CallableRef`, `InputBinding`, `RuntimePolicy`, `PermissionProfile`, `PromptPolicy`, `ArtifactContract`. | Phase 1-5. | Phase 10 `rg "node.raw|\\.raw" acc/app acc/runtime acc/store acc/engine` has no semantic reads. |
| `CapsuleSpec` | migration tool only | app/schemas | `acc/app/legacy_compat.py` maps `CapsuleSpec` into callable refs, class templates, and permissions. | Legacy asset source for callable compatibility. | Capsule migration output: `AgentClassTemplate` / `ToolClassTemplate`. | Phase 3, final delete Phase 10. | `rg "CapsuleSpec" acc/app acc/runtime acc/store acc/engine` has no matches. |
| `CapsuleRunner` | replace | app/runner | `execute_legacy_capsule_node` creates `CapsuleRunner`; `CallableInvocationService._run_capsule_backend` can also run it; `CapsuleAppService` still directly runs capsules. | Hot-path executor for capsule-backed nodes. | Callable runtime adapter/subprocess execution as `SessionInstance`. | Phase 3-6, final delete Phase 10. | `rg "CapsuleRunner" acc/app acc/runtime acc/store acc/engine` has no matches. |
| `CapsuleRegistry` | replace | app/registry | `WorkflowAppService` defaults to `CapsuleRegistry`; `discover_known_callable_refs` derives refs from it; `CallableInvocationService` holds it. | Runtime asset discovery. | `CallableRegistry`. | Phase 3. | `rg "CapsuleRegistry" acc/app acc/runtime acc/store acc/engine` has no matches. |
| `.graph.json` | migration tool only | CLI/server/app/importer | Non-clean workflow paths still enter `run_legacy_graph_template`; current server/API surfaces still expose graph workflow concepts. | Legacy runnable/discoverable workflow shape. | `acc migrate graph old.graph.json --out new.accflow.json`. | Phase 2 and Phase 8. | CLI/API tests prove run/validate/list/save reject with migration hint. |
| `legacy_capsule_id` | migration tool only | engine/app/tests/examples | Validation reads it; app branches on it; `execute_legacy_capsule_node` passes it to `CapsuleRunner`; invocation service falls back to it. | Runtime callable selector and branch control. | `CallableRef`. | Phase 2-4. | v2 loader rejects it; migration tests convert it. |
| `input_mapping` | migration tool only | app | `resolve_legacy_node_input` renders it through Jinja context before legacy capsule execution. | Legacy dynamic input construction. | Typed `InputBinding` selectors. | Phase 2 and Phase 5. | v2 loader rejects it; binding tests cover selector equivalent. |
| `legacy_value_edges` | migration tool only | app | `resolve_legacy_node_input` iterates it; `resolve_legacy_value_edge` derives input values from old edge shape. | Legacy data movement path. | Data bindings / ResultStore selectors. | Phase 2 and Phase 5. | v2 loader rejects it; ResultStore binding tests cover equivalent. |
| `legacy_full` | delete | domain/engine/app/runtime | `BindingMode.LEGACY_FULL`, `resolve_binding_mode`, `clean_workflow_uses_legacy_full_mode`, and `runtime.payload.split_payloads` preserve legacy payload behavior. | Switch for five-segment payload and control-edge upstream output behavior. | Explicit binding-only payload contract. | Phase 5. | Phase 5 search gate has no execution-path matches. |
| mixed binding mode | delete | domain/app/binding | `BindingMode.MIXED` overlays resolver fields on top of legacy payload. | Hybrid payload mode. | Explicit binding-only mode. | Phase 5. | Phase 5 search gate has no execution-path matches. |
| `LegacyPassthroughBinding` | delete | domain/binding | `BindingResolver` accepts it and no-ops so legacy upstream context remains elsewhere; `acc/binding/legacy.py` owns old upstream context collection. | Marker that preserves legacy upstream-context path. | Explicit binding declarations. | Phase 5. | Phase 5 search gate has no matches. |
| `node_runs/` | read-only historical inspector | app/store/projection | `mirror_legacy_node_run` writes `run_dir/node_runs/<node>` on success and failure; summary records `node_runs_dir`. | Legacy mirror of node evidence. | `nodes/<node_id>/...` manifests plus `RunRecord`/`EventLog`/`ResultStore`. | Phase 7. | New run directory tests assert absence. |
| `workflow_graph.json` | read-only historical inspector | app/store/projection | Legacy graph path writes `workflow_graph.json` and exposes `graph_snapshot_path`. | Legacy run graph snapshot. | `WorkflowFunctionTemplate` identity plus `RunRecord` projection. | Phase 7. | New run directory tests assert absence. |
| legacy run manifests | read-only historical inspector | store/projection | Store writes `workflow_run_manifest.json`, `workflow_summary.json`, `workflow_run.json`, node manifests, and can read old `session_manifest.json`. | Mixed projection/source evidence. | `RunRecord` + `EventLog` + `ResultStore` + `ArtifactBundle`. | Phase 7-8. | New inspector/debugger tests read only v2 facts; historical inspector is labeled read-only. |
| `CallableKind.legacy_capsule` | delete | domain/engine/app | `acc/domain.py` includes `legacy_capsule`; `acc/engine/__init__.py::CALLABLE_KINDS` accepts it; `acc/app/legacy_compat.py` emits it. | Legacy callable namespace entry. | `CallableRef.kind in {"agent_class", "tool_class", "workflow_function"}` only. | Phase 1 and Phase 3. | `CallableRef.kind` tests reject `legacy_capsule`; final search has no hot-path matches. |
| `upstream_context` implicit payload | delete | app/runtime/binding | `acc/app/node_invocation.py` builds upstream context; `acc/app/__init__.py` injects it; `acc/runtime/__init__.py` fake runtimes read it. | Implicit data channel through control edges and legacy payload. | Explicit `InputBinding` selectors backed by `ResultStore`. | Phase 5. | Phase 5 search gate has no execution-path matches except explicit rejection/migration tests. |
| `ACC_USE_CALLABLE_DISPATCH` | delete | app | `execute_app_clean_node` uses the flag, but the callable service still accepts `NodeSpec` and can call `CapsuleRunner`. | Opt-in branch between old and new execution. | Single canonical workflow function invocation path. | Phase 4. | No runtime feature flag selects old/new execution. |
| `ControlEdge.context = upstream_output` | replace | domain/engine/app/binding | `ControlContextMode` allows `upstream_output`; legacy full mode defaults control edges to upstream output; legacy binding code collects upstream context. | Control edge implies data movement. | Control edge expresses readiness only; data moves through bindings. | Phase 1 and Phase 5. | Domain validation rejects data-carrying control context; binding tests prove control edges do not move payload data. |

## Additional Hot-Path Findings

| Finding | Evidence | Risk |
| --- | --- | --- |
| `CallableKind` still includes `legacy_capsule`. | `acc/domain.py` defines `CallableKind = Literal[..., "legacy_capsule"]`; `acc/engine/__init__.py` includes it in `CALLABLE_KINDS`. | The canonical callable namespace can still route to legacy assets. |
| `ControlEdge.context = upstream_output` still exists. | `acc/domain.py` allows `ControlContextMode = Literal["upstream_output", "none"]`; `parse_control_edge` defaults to upstream output under legacy full mode. | Control edges can still imply data movement. |
| App layer branches between callable dispatch and legacy execution. | `acc/app/__init__.py::execute_app_clean_node` checks `ACC_USE_CALLABLE_DISPATCH`, then falls back to legacy capsule or clean node execution. | New architecture is opt-in rather than the only hot path. |
| ResultStore is additive, not authoritative. | `acc/app/binding_runtime.py::record_node_result_in_store` writes ResultStore after node success while legacy outputs/manifests continue to drive run behavior. | Bindings and workflow outputs can still read from non-authoritative legacy artifacts. |
| Payload split preserves legacy behavior. | `acc/runtime/payload.py::split_payloads` returns the merged payload unchanged in `legacy_full`. | Runtime can still inject the old five-segment payload. |
| Server/API still exposes graph compatibility names. | Current workflow routes include graph workflow surfaces according to the code and docs. | API users can continue treating graph payloads as runnable unless Phase 8 rejects or migrates explicitly. |

## Inventory Gate

Before Phase 1 starts, each row above must have an owning phase and a target replacement/deletion test. Before the whole goal is complete, the Phase 10 search gates from `docs/goal.md` must return no hot-path matches outside the allowed exception directories.
