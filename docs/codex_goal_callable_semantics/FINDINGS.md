# Findings

Status: Baseline audit updated before callable runtime code changes.

Date: 2026-05-28

Current worktree note:

- The repository already has unrelated web/UI edits in `web/src/*`.
- This refactor must avoid touching or reverting those files unless a later callable milestone explicitly requires it.

## Initial known findings

### F1: `NodeSpec` mixes callable definition, invocation, override, and compatibility state

Evidence:

- `acc.domain.NodeSpec` contains `kind`, `runtime`, `tool`, `workflow_ref`, `prompt`, `permission_profile`, ports, and `raw`.
- `acc.engine.parse_node_spec()` maps legacy fields directly into `NodeSpec`.
- There is no first-class `CallableRef` or `NodeInvocationSpec` domain type yet.

Root cause:

- Earlier phases needed a compact workflow node representation before class/function semantics were first-class.

Smallest safe fix:

- Add `NodeInvocationSpec` and normalize old `NodeSpec` fields into it.
- Keep old fields supported during migration.
- Keep `NodeSpec` as a compatibility facade until existing `.accflow.json` examples and server routes are migrated.

### F2: Nested workflow calls run, but function-call input/output semantics are incomplete

Evidence:

- Nested workflow execution is app-level orchestration.
- Existing path relies partly on upstream context rather than full exposed input/output binding.
- `acc.app.run_clean_workflow_node()` calls `run_clean_workflow_template()` for workflow nodes and writes child results under `nodes/<node>/nested_workflow`.
- `acc.app.build_nested_workflow_input_payload()` still builds child input primarily from parent `upstream_context`.
- Existing tests cover boundary isolation, but they still assert `upstream_context` behavior as the main compatibility path.

Smallest safe fix:

- Add explicit workflow-call input and output bindings.
- Return child exposed outputs through parent workflow-node outbox.
- Keep `upstream_context` as optional control context for compatibility only.

### F3: Function invocation and scope frame are not first-class manifests

Evidence:

- Existing workflow run manifests and environment manifests exist.
- Dedicated `function_invocation_manifest.json` and `scope_frame_manifest.json` are not yet guaranteed.
- `acc.store.FileSystemWorkflowStore.create_environment_frame()` writes `environment_manifest.json`.
- `acc.store.write_workflow_manifests()` writes `workflow_run_manifest.json`, `workflow_summary.json`, and `workflow_run.json`.
- `acc.domain.EnvironmentFrame` exists, but it has no `parent_frame_id`, `call_depth`, or invocation linkage.

Smallest safe fix:

- Add additive manifests without removing existing files.
- Extend the runtime evidence model through new domain types instead of renaming existing manifest files in place.

### F4: Session semantics are split between capsule runs and clean workflow node runs

Evidence:

- `SessionManifest` exists for `acc run`.
- Clean workflow nodes use node manifests and events but do not yet consistently emit `SessionInstance`.
- `acc.session.SessionManifest` supports legacy capsule sessions.
- Clean workflow node execution writes `node_run_manifest.json`, `events.jsonl`, outboxes, and artifact bundles.
- No `nodes/<node_id>/session_instance_manifest.json` is currently guaranteed for every agent/tool node.

Smallest safe fix:

- Add `session_instance_manifest.json` for every agent/tool node execution.
- Make `NodeRunManifest` reference `session_id` and `invocation_id` additively.

### F5: App layer is the main coordination complexity point

Evidence:

- `acc.app` coordinates validation, legacy import, execution, nested workflow calls, input building, output publishing, and inspection.
- `acc.app.__init__.py` currently contains workflow loading, execution, nested workflow call handling, upstream context collection, input payload construction, and inspect/debug payload assembly.
- `acc.engine` and `acc.store` already have cleaner responsibilities, so the safest first move is to add domain/normalization types before splitting app orchestration.

Smallest safe fix:

- Split app coordination modules while preserving public behavior.

### F6: Engine already owns several required safety gates, but callable-specific gates are incomplete

Evidence:

- `acc.engine.validate_clean_workflow_template()` already rejects absolute workspace paths in templates.
- `acc.engine.validate_permission_profile()` rejects dangerous permissions unless explicitly allowed, network in hermetic mode, and `allowed_env` values of `ALL` or `*`.
- `acc.engine.validate_data_edges_follow_control_dependencies()` requires data edges to originate from control ancestors.
- `acc.engine.validate_nested_internal_node_boundaries()` rejects parent references to nested UI internal nodes.
- There is no explicit `CallDepthPolicy`, `RecursionPolicy`, callable registry validation, or child workflow input/output binding validation yet.

Root cause:

- Existing validation protects Clean Core mechanics but has not lifted workflow calls into a first-class function-call model.

Smallest safe fix:

- Reuse existing graph/topological validation and add callable policies as pure engine validation.
- Keep engine free of filesystem IO and subprocess execution.

### F7: Store owns materialization and path safety, but invocation/session evidence is missing

Evidence:

- `acc.store.materialize_clean_inbox_edge()` performs inbox materialization and calls `safe_child_path()` for target path validation.
- `acc.store.write_clean_outboxes()` creates outbox directories and artifact bundles.
- Retry cleanup is centralized in `FileSystemWorkflowStore.cleanup_node_attempt()`.
- Store does not yet create `FunctionInvocation`, `ScopeFrame`, or `SessionInstance` manifests.

Root cause:

- The current store models workflow/environment/node artifacts, not callable invocation/session artifacts.

Smallest safe fix:

- Add store methods for additive callable manifests while leaving existing workflow manifests in place.

## Baseline results

Commands run before runtime/code changes:

```text
uv run pytest -q:
  FAILED, 259 passed / 1 failed.
  Failing test:
    tests/unit/test_registry.py::test_stock_market_demo_capsules_use_least_privilege_permissions
  Failure:
    CapsuleRegistry could not find stock-market-info-curation.codex.
  Current capsules include stock-market-info-cleaner.codex but not stock-market-info-curation.codex.
  This is a pre-existing baseline fixture/name mismatch; no callable runtime code had been changed.

uv run ruff check .:
  PASSED.

uv run pytest -q tests/architecture/test_import_boundaries.py:
  PASSED, 10 passed.
```

## Baseline implication

The original baseline had one registry fixture mismatch: the test expected `stock-market-info-curation.codex`, while the repository's actual capsule is `stock-market-info-cleaner.codex`. The test fixture was updated to the real capsule id after confirming no other repository references used the stale id.

Current baseline after the fixture correction:

```text
uv run pytest -q:
  PASSED, 284 passed.

uv run ruff check .:
  PASSED.
```
