# ACC Workflow Kernel Upgrade Spec

## 1. Product definition

This phase upgrades ACC from a capsule execution boundary into a lightweight Agent Workflow Kernel.

ACC must remain a local-first, artifact-first, mature-agent-capsule framework. It does not implement an LLM agent loop. It schedules and observes reusable capsules, where a capsule may wrap a single agent session, an existing agent workflow, an ACC subworkflow, or an external workflow.

## 2. Existing baseline to preserve

Existing ACC already has:

- `acc run <capsule_id>`;
- capsule registry;
- artifact store;
- adapter layer;
- workspace manager;
- schema validation;
- batch runner;
- Conductor-compatible stdout contract;
- hermetic default tests.

This phase must not break those.

## 3. New concepts

### 3.1 WorkflowGraph v3

A workflow graph now contains:

- metadata;
- workflow policy;
- nodes;
- control edges;
- data edges;
- optional groups;
- optional foreach definitions;
- validation metadata.

### 3.2 Workflow Kernel

The Workflow Kernel executes graph nodes by topological levels. Nodes in the same ready level may run concurrently.

### 3.3 Workflow Capsule

Capsule `kind` must support:

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

### 3.4 Event emitters

ACC must have standard event emission for sessions and workflows.

### 3.5 Conductor Bridge

ACC graph remains the authoring IR. Conductor YAML is export-only for production/compatibility.

## 4. Required CLI additions

### Workflow commands

```bash
acc workflow validate <workflow.graph.json>
acc workflow run <workflow.graph.json> --run-dir <run_dir> --emit-json
acc workflow events <workflow_run_dir> --json
acc workflow inspect <workflow_run_dir> --json
```

Existing workflow commands may be extended instead of duplicated, but these semantics must exist.

### Conductor bridge commands

```bash
acc conductor export <workflow.graph.json> --out <workflow.conductor.yaml>
```

Optional:

```bash
acc conductor validate <workflow.conductor.yaml>
```

Validation must be skipped or gracefully marked unavailable when Conductor is not installed.

### GraphOps commands

```bash
acc graphops validate-patch <patch.json> --semantic
acc graphops apply-patch <patch.json> --dry-run --semantic
```

Optional apply must require explicit approval:

```bash
acc graphops apply-patch <patch.json> --apply --human-approved
```

### Capsule commands

Existing capsule commands must accept or validate new `kind` values.

Optional:

```bash
acc capsule validate-kind <capsule_id>
```

## 5. Required files written during workflow run

A workflow run directory must contain:

```text
workflow_run_manifest.json
workflow_events.jsonl
workflow_summary.json
node_runs/
  <node_id>/
    input.json
    resolved_prompt.md
    output.json
    events.jsonl
    session_manifest.json
    artifacts/
```

Existing per-capsule run files remain valid.

## 6. Failure modes

Workflow-level failure modes:

```text
fail_fast
continue_on_error
all_or_nothing
manual_review
```

Node-level failure behavior:

```text
fail
skip
retry
manual_review
```

Minimum required implementation:

- `fail_fast`;
- `continue_on_error`;
- `all_or_nothing` for same-level group;
- deterministic reporting for `manual_review`, even if actual UI resolution is deferred.

## 7. Event types

Minimum required workflow events:

```text
workflow_started
workflow_level_started
node_scheduled
node_started
node_completed
node_failed
workflow_level_completed
workflow_completed
workflow_failed
```

Minimum required session events:

```text
session_started
input_materialized
prompt_rendered
workspace_prepared
adapter_started
adapter_event
output_written
output_validated
artifact_validated
session_completed
session_failed
```

## 8. Graph semantics

Validation must detect:

- duplicate node ids;
- missing capsule ids;
- invalid edge endpoints;
- cycles;
- invalid data references;
- data dependency that points to non-upstream node;
- required input missing after mapping;
- unsupported capsule kind;
- unsafe permission changes in GraphOps patches.

## 9. Hermetic testing

All default tests must run without:

- real Codex login;
- real Claude credentials;
- real Hermes/Cursor;
- network;
- Conductor installed.

## 10. UI scope

This phase may update existing Workbench API/UI to consume workflow events and show node statuses, but it must not do a full visual redesign.
