# ACC Next Stage Spec

## 1. Product definition

ACC is a lightweight, pluggable, nested Agent Workflow orchestration system.

It must support:

- reusable Capsule templates,
- workflow graph execution,
- workflow debugging and replay,
- existing agent workflow capsules,
- agent-callable control plane,
- browser-validated Workbench UX.

## 2. Preserve existing baseline

The following must remain true:

- `acc run` still works.
- `--emit-conductor-json` still emits exactly one JSON object to stdout.
- logs do not pollute stdout.
- default tests remain hermetic.
- external real-agent integrations remain optional.
- Capsule Runner still owns execution boundary.
- mature external agents still own their internal reasoning/tool loops.

## 3. New required modules

### 3.1 Debugger / Replay module

Required commands:

```bash
acc events replay
acc workflow rerun-node
acc workflow rerun-from
acc workflow fork
acc run diff
acc artifacts diff
```

### 3.2 Workflow Capsule module

Required support:

```text
kind=agent_workflow
kind=acc_workflow
kind=external_workflow
behavior_pack
lifecycle
materialized_snapshot
nested workflow capsule
```

### 3.3 Control Plane module

Required commands:

```bash
acc capsules list --json
acc capsules show --json
acc workflows list --json
acc workflows show --json
acc workflow run --emit-json
acc runs list --json
acc runs show --json
acc artifacts get --json
acc graphops validate --json
acc graphops dry-run --json
```

Optional:

```bash
acc control serve --mcp
```

### 3.4 Browser E2E validation module

Required:

- browser journey specs,
- browser E2E report,
- Chinese UI label checks,
- graph-first workflow validation,
- UX optimization loop.

## 4. New data artifacts

### 4.1 Replay manifest

```text
replay_manifest.json
```

### 4.2 Fork manifest

```text
fork_manifest.json
```

### 4.3 Diff report

```text
run_diff.json
artifact_diff.json
```

### 4.4 Workflow capsule snapshot

```text
template_snapshot/
  capsule.yaml
  input_schema.json
  output_schema.json
  artifact_manifest.yaml
  behavior_pack/
  workflow.graph.json
```

### 4.5 Browser E2E report

```text
browser_e2e_report.json
screenshots/
console.log
network.log
```

## 5. Safety

Dangerous operations must be blocked by default:

- direct apply of graph patch,
- deleting capsule,
- enabling network,
- enabling write_files,
- enabling danger-full-access,
- removing human gate,
- modifying output schema without explicit review.

## 6. UI language

Workbench core UI must default to Simplified Chinese for user-facing labels in this phase.

## 7. Non-goals

Do not implement:

- full SaaS platform,
- full Conductor clone,
- new LLM agent framework,
- cloud deployment,
- default real-agent dependency,
- destructive auto-apply GraphOps.
