# Goal 2: Workflow Capsule & Agent Workflow Adapter

## Objective

Make existing agent workflows reusable as ACC Capsules.

## Problem

Users may already have Codex, Claude, Cursor, Hermes, or ACC sub-workflows configured with skills, hooks, prompts, scripts, and project-specific rules. They should not rewrite these workflows just to integrate with ACC.

## Required Capsule kinds

Extend capsule kind support to include:

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

### `agent_workflow`

Wraps an existing external agent workflow directory.

Required fields:

```yaml
kind: agent_workflow
behavior_pack:
  root: behavior/
lifecycle:
  setup: []
  run: []
  collect: []
  cleanup: []
```

Behavior pack may contain:

```text
AGENTS.md
CLAUDE.md
skills/
hooks/
prompts/
scripts/
config/
```

### `acc_workflow`

Wraps an ACC workflow graph as a Capsule.

Required behavior:

- parent workflow calls child workflow as one node,
- child workflow has isolated run directory,
- parent consumes child standard output/artifacts,
- no session state leaks between parent and child.

### `external_workflow`

Wraps an external workflow runner such as Conductor or another CLI.

Required behavior:

- run external command,
- capture output/artifacts,
- validate standard output schema,
- record external workflow manifest.

## Materialized snapshot

Every workflow capsule run must snapshot:

```text
template_snapshot/
  capsule.yaml
  input_schema.json
  output_schema.json
  artifact_manifest.yaml
  behavior_pack/
  workflow.graph.json if acc_workflow
```

This is required for reproducibility.

## Lifecycle

Support lifecycle stages:

```text
setup
run
collect
cleanup
```

Rules:

- failures in setup fail the capsule,
- collect must run after run if run succeeds,
- cleanup should run best-effort and log failures,
- lifecycle commands must be timeout-limited.

## Examples

Add example capsules:

```text
examples/capsules/codex-workflow-capsule.example.yaml
examples/capsules/acc-subworkflow-capsule.example.yaml
examples/capsules/external-workflow-capsule.example.yaml
```

## Acceptance summary

The goal passes when:

- `agent_workflow` validates and runs with a fake local workflow,
- `acc_workflow` validates and runs a nested ACC graph,
- `external_workflow` validates and runs a fake external workflow command,
- materialized snapshots exist,
- lifecycle stages are tested,
- existing capsule kinds remain compatible.
