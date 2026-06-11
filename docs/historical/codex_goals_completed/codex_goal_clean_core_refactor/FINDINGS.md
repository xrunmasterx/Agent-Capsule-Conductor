# Clean Core Refactor Findings

Updated: 2026-05-26

## Baseline

Commands run before code changes:

```bash
uv run pytest -q
uv run ruff check .
```

Result:

- `uv run pytest -q`: passed, 189 tests.
- `uv run ruff check .`: passed.

Important workspace note:

- The working tree already contains many modified and untracked files, including `acc/environment.py`, `acc/port_io.py`, Clean Core docs, example workflows, schemas, tests, web files, and stock-market capsules.
- Treat these as existing user or prior-goal work. Do not revert them during the refactor.

## Executive Summary

Current ACC already has useful pieces for the Clean Core goal: workflow validation, workflow runs, environment frames, inbox/outbox materialization, behavior pack snapshots, event logs, fake-agent based hermetic tests, and old `acc run` stdout contract coverage.

But the implementation is not yet a clean core. The current workflow runtime is still centered on legacy `CapsuleRunner` and `capsule_id` nodes, while the active contract requires a primary `WorkflowTemplate + EnvironmentBinding + EnvironmentFrame + Node + Port + Inbox/Outbox + ArtifactBundle` model. The `.graph.json` examples are closer to the existing implementation; the `.accflow.json` examples named in `ACCEPTANCE.md` are closer to the desired new model but currently fail validation and execution.

The minimum safe refactor path is not to rewrite adapters first. It is to introduce a clean domain/engine/runtime/store boundary, align schemas and examples to one WorkflowTemplate format, then reconnect existing fake/generic/Codex adapter code behind AgentNodeRunner.

## Acceptance Probes

These Clean Core acceptance commands currently fail:

```bash
uv run acc workflow validate examples/workflows/stateless_template_demo.accflow.json --json
uv run acc workflow validate examples/workflows/environment_stateful_demo.accflow.json --json
uv run acc workflow validate examples/workflows/nested_environment_demo.accflow.json --json
```

Observed failure:

- `acc workflow validate` has no `--json` option.

Without `--json`, `stateless_template_demo.accflow.json` also fails because the current validator selects the legacy workflow schema and expects each node to have `capsule_id`; the `.accflow.json` file uses new `kind/tool/runtime/ports` node shape instead.

This Clean Core acceptance command also currently fails:

```bash
uv run acc workflow bind examples/workflows/environment_stateful_demo.accflow.json --workspace . --out runs/acceptance_clean_binding/binding.local.json --json
```

Observed failure:

- `acc workflow bind` has no `--json` option.

This probe succeeds with the older `.graph.json` format:

```bash
uv run acc workflow run examples/workflows/stateless_template_demo.graph.json --run-dir runs/tmp_clean_stateless_graph_probe --emit-json
```

Key evidence:

- Status is `success`.
- Workspace path is under the run directory: `runs/tmp_clean_stateless_graph_probe/environments/root_env/workspace`.
- Node runs inherit that workspace.
- Inbox/outbox manifests are written under `environments/root_env/.acc/`.

This probe currently fails:

```bash
uv run acc workflow run examples/workflows/nested_environment_demo.graph.json --run-dir runs/tmp_clean_nested_graph_probe --emit-json
```

Observed failure:

- `stateless_child_a` fails inside the nested workflow with: `Failed to render node input template: 'dict object' has no attribute 'message'`.
- Root cause appears to be nested workflow input propagation: the parent workflow invokes `acc-subworkflow-capsule.example` without providing the input shape expected by the child `echo-test.generic` node.

## Findings

### Critical: Active `.accflow.json` format is not executable by current engine

Evidence:

- `examples/workflows/stateless_template_demo.accflow.json` uses nodes like:
  - `{"id": "producer", "kind": "tool", "tool": "fake_producer", "ports": ...}`
  - `{"id": "consumer", "kind": "agent", "runtime": "generic_fake_agent", "ports": ...}`
- `acc.workflow_graph.validate_graph_semantics` still requires `node["capsule_id"]`.
- `schemas/workflow_graph_schema.json` and `schemas/workflow_graph_v3_schema.json` both require `capsule_id` for nodes unless `workspace_policy` triggers `workflow_template_v4_schema.json`.
- The `.accflow.json` acceptance files do not contain `workspace_policy`, so the validator selects the wrong schema.

Design violation:

- Clean Core says `NodeSpec` kinds are `agent`, `tool`, and `workflow`; old flat capsule kinds may be compatibility wrappers only.
- Current engine still treats capsule-backed nodes as the primary runtime model.

Smallest safe fix:

- Create a single WorkflowTemplate loader that recognizes `.accflow.json` as the active Clean Core format regardless of `workspace_policy`.
- Add typed domain validation for `agent/tool/workflow` nodes and ports.
- Either map old capsule-backed `.graph.json` nodes into compatibility NodeSpec, or keep legacy validation behind an explicit compatibility path.

### Critical: Required CLI JSON flags are missing

Evidence:

- `acc workflow validate ... --json` fails with `No such option '--json'`.
- `acc workflow bind ... --json` fails with `No such option '--json'`.
- `ACCEPTANCE.md` requires both commands to accept those flags and emit valid JSON.

Design violation:

- Machine-readable outputs must be explicit and stable.
- Acceptance cannot pass even though existing non-flag output is already JSON-like.

Smallest safe fix:

- Add `--json` to `workflow validate` and `workflow bind`.
- Keep stdout as exactly one JSON object for JSON modes.
- Ensure errors go to stderr and exit non-zero.

### High: Clean architecture boundary is not established

Evidence:

- There is no `acc.domain`, `acc.engine`, `acc.runtime`, or `acc.store` package boundary.
- `acc.workflow_graph` mixes schema selection, JSON Schema validation, graph semantics, capsule registry lookup, port-ish data edge validation, cycle detection, and legacy mapping rules.
- `acc.workflow_runner` mixes scheduling, event emission, environment creation, inbox materialization, node execution through `CapsuleRunner`, legacy compatibility copy, run index update, failure policy, and manifest writing.
- `acc.runner.CapsuleRunner` is approximately 35 KB and owns session setup, workspace prep, prompt rendering, adapter calls, workflow capsule lifecycle, nested workflow invocation, summary writing, and compatibility behavior.

Design violation:

- Active design requires dependency direction: `cli/web/server -> application services -> engine/runtime/store -> domain`.
- Domain models must not depend on registry, subprocess, CLI, or adapter behavior.

Smallest safe fix:

- Add pure domain models first.
- Move graph validation/topological levels into engine.
- Move filesystem layout to store.
- Keep existing adapters but call them through runtime node runners.

### High: Scheduler lacks workspace write locks

Evidence:

- `acc.workflow_runner.run_workflow_graph` uses an `asyncio.Semaphore(max_concurrency)` for level concurrency.
- No current lock map or read/write lock exists around an `EnvironmentFrame` or workspace.
- Search evidence shows no implementation of workspace write locks outside docs.

Design violation:

- Clean Core requires bounded concurrency plus workspace write locks.
- Write nodes in the same environment must serialize; read-only nodes may run concurrently.

Smallest safe fix:

- Add per-environment lock state to the workflow engine.
- Add node permission/effect classification: read-only vs writes-workspace.
- Acquire write lock only for nodes that can mutate workspace.
- Add tests proving parallel read-only nodes can overlap while write nodes serialize.

### High: Data edge port validation is incomplete for the new port model

Evidence:

- `.accflow.json` nodes declare `ports.inputs` / `ports.outputs` maps.
- Existing `.graph.json` nodes declare `input_ports` / `output_ports` arrays.
- `acc.workflow_graph.validate_data_edges` validates node existence and upstream relationship, but does not consistently verify that `from.port` exists in the source node's declared output ports or that `to.port` exists in the target node's declared input ports.
- `acc.port_io.materialize_inbox` builds paths directly from node and port ids without a central safe identifier validator.

Design violation:

- `PortContract` is a first-class domain contract.
- Data edges must reference existing ports.
- Materialization must prevent path traversal.

Smallest safe fix:

- Normalize both old and new port declarations into `PortContract`.
- Validate port ids with a restricted identifier pattern.
- Reject absolute paths, `..`, path separators, and ambiguous materialization modes.

Status after follow-up audit:

- Fixed for the clean `.accflow.json` path.
- Data edges now validate source and target port existence.
- Data edges must also point from an upstream control dependency, preventing same-level materialization races.

### High: Retry could reuse stale failed-attempt outputs

Evidence:

- Clean node retry previously re-entered execution using the same `nodes/<node_id>/` directory.
- A failed attempt could leave `output.json`, `artifacts/`, or `outbox/` behind.
- A later successful attempt could then produce an ArtifactBundle containing stale files.

Design violation:

- ArtifactBundle provenance must represent the successful node attempt, not residue from a failed attempt.
- Retry must restore a clean per-attempt output boundary.

Status after follow-up audit:

- Fixed for the clean `.accflow.json` path.
- Each retry attempt clears `output.json`, `artifacts/`, and `outbox/` before execution while preserving materialized inbox.

### Medium: Node-level event logs were missing in clean path

Evidence:

- `WORKFLOW_ENGINE_SPEC.md` requires `nodes/<node_id>/events.jsonl`.
- Clean workflow initially emitted workflow-level events only.

Status after follow-up audit:

- Fixed for the clean `.accflow.json` path.
- Clean nodes now write `nodes/<node_id>/events.jsonl` for scheduled, inbox materialized, completed, and failed lifecycle changes.

### Medium: Workflow policy was under-validated

Evidence:

- Clean workflow initially accepted arbitrary `failure_mode` values and relied on later runtime behavior.
- `continue_on_error` continued execution but still left final workflow status as `failed`.

Status after follow-up audit:

- Fixed for the clean `.accflow.json` path.
- Unsupported `failure_mode` values and invalid `max_concurrency` are rejected.
- `continue_on_error` preserves per-node errors but keeps workflow status successful, matching existing legacy runner semantics.

### High: EnvironmentBinding allows ACC install directory as a stateful workspace without policy signal

Evidence:

- Acceptance intentionally binds `--workspace .`, so using the repository root can be valid for explicit stateful runs.
- `SECURITY_MODEL.md` says binding workspace paths that point to ACC install directory should be rejected unless explicitly allowed and documented.
- `create_workspace_binding` currently accepts any existing directory, including `.`.

Design tension:

- Acceptance expects `--workspace .` to work.
- Security model warns that binding to ACC install directory needs explicit allowance/documentation.

Smallest safe fix:

- Do not reject `--workspace .` outright, because acceptance requires it.
- Record `workspace_is_project_root: true` or equivalent warning in binding/environment manifest.
- Keep stateless default strictly run-scoped and never project root.

### High: Nested workflow support is still capsule-wrapper driven

Evidence:

- `nested_environment_demo.graph.json` uses `kind: workflow` but still uses `capsule_id: acc-subworkflow-capsule.example`.
- `CapsuleRunner._run_nested_acc_workflow_capsule` copies template snapshots into `workflow_workspace` and then invokes `run_workflow_graph`.
- The acceptance `.accflow.json` uses direct `workflow_ref` and `environment_policy`, but current engine does not execute that format.

Design violation:

- `WorkflowNode` should invoke a nested `WorkflowTemplate` as a node.
- Parent should not depend on the child's internal node details.
- Environment policy should be enforced at workflow-node boundary, not hidden inside old capsule lifecycle.

Smallest safe fix:

- Implement `WorkflowNodeRunner` for direct `workflow_ref`.
- Keep `acc_workflow` capsule only as compatibility wrapper.
- Fix parent-to-child input mapping and output bundle projection.

### Medium: ArtifactBundle shape is not aligned with spec

Evidence:

- `acc.port_io.write_node_outboxes` writes `artifact_bundle.json` with:
  - `bundle_id`
  - `producer_node_id`
  - `producer_session_id`
  - `artifacts`
- `PORT_IO_AND_ARTIFACT_SPEC.md` requires:
  - `bundle_id`
  - `node_id`
  - `run_id`
  - `outputs`
  - `files`
  - `created_at`
  - `provenance`

Design violation:

- ArtifactBundle is supposed to be a structured node output package with stable provenance.

Smallest safe fix:

- Introduce a domain `ArtifactBundle` model and write the vNext fields.
- Preserve old fields temporarily only if needed for existing tests.

### Medium: Runtime still copies legacy node run directories

Evidence:

- `copy_node_run_for_legacy_compat(result.run_dir, legacy_nodes_dir / result.node_id)` writes `runs/<run>/nodes/<node_id>`.
- Main run dirs are under `node_runs/`.
- Clean Core output spec expects `nodes/<node_id>/...`.

Design violation:

- Runtime layout should be singular and inspectable, not duplicated for compatibility.

Smallest safe fix:

- Choose the Clean Core layout as canonical.
- Keep compatibility aliases only if documented in `MIGRATION_NOTES.md`.

### Medium: Environment model names do not match active contract

Evidence:

- Code uses `WorkspaceBinding`.
- Active docs require `EnvironmentBinding`.
- Code uses `state_mode`; docs use EnvironmentBinding and EnvironmentFrame terminology with `ephemeral` flag.

Design violation:

- Mandatory concepts must be used consistently.

Smallest safe fix:

- Rename or alias to `EnvironmentBinding` in domain.
- Keep compatibility wrapper only where needed for old tests.

### Medium: Agent environment leaks host environment

Evidence:

- `GenericCliAdapter`, `CodexCliAdapter`, and workflow lifecycle use `os.environ.copy()`.
- `SECURITY_MODEL.md` says agent nodes should receive an environment variable whitelist and should not receive all host env vars by default.

Design violation:

- No secret values in logs/events/artifacts.
- Do not pass all host environment variables by default.

Smallest safe fix:

- Add an environment whitelist builder.
- Pass only ACC-specific env plus explicitly configured env.
- Keep test fixtures hermetic.

### Low: UI/server modules are outside current core priority

Evidence:

- `acc/server/*` and `web/*` exist.
- Clean Core says UI/API state must be separate from runtime state, and UI is optional.

Design implication:

- Do not delete UI by default, but do not let UI state drive core workflow semantics.

Smallest safe fix:

- Keep server/web as adapters over application services.
- Avoid making browser/UI tests mandatory unless acceptance asks for them.

## Module Classification

Keep, with minor adaptation:

- `acc/adapters/base.py`
- `acc/adapters/generic_cli.py`
- `acc/adapters/codex_cli.py`
- `acc/adapters/claude_sdk.py`
- `acc/events.py`
- `acc/utils.py`
- `acc/fake_agents.py`
- `acc/validation.py`
- `acc/artifact_manifest.py`

Move or split:

- `acc/schemas.py` -> split old CapsuleSpec compatibility from new domain WorkflowTemplate/EnvironmentBinding/NodeSpec models.
- `acc/workflow_graph.py` -> move pure graph/domain validation to engine; keep legacy graph adapter separately.
- `acc/workflow_runner.py` -> split into scheduler, materializer, node runners, and manifest writer.
- `acc/environment.py` -> move EnvironmentBinding/EnvironmentFrame to domain/store boundary; keep behavior pack snapshot logic in store/runtime.
- `acc/port_io.py` -> move path-safe materialization into engine/store with typed PortContract and ArtifactBundle.
- `acc/artifact_store.py` -> adapt to Clean Core run layout.
- `acc/cli.py` -> keep as wrapper, but reduce direct orchestration.
- `acc/run_index.py` -> keep as inspectability layer, but make it consume canonical manifests.

Rewrite:

- Scheduler logic in `acc/workflow_runner.py`, because it lacks workspace write locks and is coupled to CapsuleRunner.
- WorkflowTemplate validation, because current schema selection and node model do not match `.accflow.json`.
- WorkflowNode execution, because current nested workflow path is hidden behind `acc_workflow` capsule lifecycle.

Delete or deprecate after replacement:

- Old flat capsule kinds as primary workflow model: `atomic`, `agent_session`, `agent_workflow`, `acc_workflow`, `external_workflow`.
- Duplicate run layout copying if canonical `nodes/<node_id>/...` replaces `node_runs/` or vice versa.
- Any compatibility path that uses `Path.cwd()` or ACC install directory as implicit default workspace for stateless workflow execution.

## Recommended Implementation Order

1. Add `acc.domain` models for WorkflowTemplate, EnvironmentBinding, EnvironmentFrame, NodeSpec, PortContract, ControlEdge, DataEdge, ArtifactBundle, and WorkflowRunManifest.
2. Add a Clean Core loader/validator that treats `.accflow.json` as WorkflowTemplate and rejects absolute workspace paths.
3. Add `--json` to `acc workflow validate` and `acc workflow bind`.
4. Implement environment frame creation with explicit `ephemeral` flag and project-root binding warning.
5. Implement typed port validation and path-safe inbox/outbox materialization.
6. Implement deterministic scheduler with bounded concurrency and environment write locks.
7. Implement ToolNodeRunner, AgentNodeRunner, and WorkflowNodeRunner; reuse adapters only behind AgentNodeRunner.
8. Align example `.accflow.json` files with the new domain model and acceptance commands.
9. Update tests for Clean Core acceptance, security defaults, scheduler locks, nested workflow policy, and performance budget.
10. Update `QUALITY_REPORT.md` and `MIGRATION_NOTES.md`.

## Immediate Blockers

- Clean Core acceptance commands cannot pass until CLI `--json` options are added.
- `.accflow.json` examples cannot pass until the engine supports the new node kinds and port shape.
- Nested workflow acceptance cannot pass until direct `WorkflowNode` input/output mapping is implemented or the example is corrected to match the current child workflow input contract.
