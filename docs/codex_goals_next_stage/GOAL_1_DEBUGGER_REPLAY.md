# Goal 1: Workflow Debugger & Replay

## Objective

Make ACC workflow runs easy to debug, replay, fork, and compare.

## Problem

A complex ACC workflow may contain many Capsule nodes, parallel branches, nested workflow capsules, and multiple artifact dependencies. If one node fails or produces a bad result, the user needs to identify the cause quickly and rerun only the necessary part.

## Required features

### 1. Event replay

Implement commands and APIs that can reconstruct a workflow or node state from event logs:

```bash
uv run acc events replay <run_dir> --json
uv run acc events replay <run_dir> --node <node_id> --json
```

Replay should derive:

- workflow status,
- node status,
- start/end times,
- failed node,
- schema errors,
- artifact errors,
- adapter events if available.

### 2. Node rerun

Implement:

```bash
uv run acc workflow rerun-node <run_dir> <node_id> --out runs/rerun_node
```

Rules:

- preserve upstream artifacts,
- rerun only the selected node,
- write a new run directory,
- record parent run and rerun metadata.

### 3. Rerun from node

Implement:

```bash
uv run acc workflow rerun-from <run_dir> <node_id> --out runs/rerun_from_node
```

Rules:

- preserve upstream completed nodes before `node_id`,
- rerun `node_id` and downstream consumers,
- skip unrelated branches if possible.

### 4. Fork run

Implement:

```bash
uv run acc workflow fork <run_dir> --from-node <node_id> --input override.json --out runs/forked_run
```

Rules:

- copy relevant run context,
- apply input override,
- do not mutate original run,
- store fork metadata.

### 5. Run diff

Implement:

```bash
uv run acc run diff <run_a> <run_b> --json
```

Compare:

- workflow status,
- node status,
- output.json,
- artifacts manifest,
- prompt diff,
- schema errors,
- duration.

### 6. Artifact diff

Implement:

```bash
uv run acc artifacts diff <artifact_a> <artifact_b> --json
```

Support at least:

- JSON diff,
- markdown/text diff,
- existence/status diff.

## UI hooks

Expose API endpoints or structured commands for:

- list run nodes,
- replay run,
- rerun node,
- rerun from node,
- fork run,
- diff runs,
- diff artifacts.

The UI does not need to be fully redesigned in this goal, but backend capabilities must be usable by the Workbench.

## Acceptance summary

The goal passes when:

- replay can reconstruct demo workflow state,
- node rerun works,
- rerun-from works,
- fork works,
- run diff works,
- artifact diff works,
- old `acc run --emit-conductor-json` contract remains intact,
- tests are hermetic.
