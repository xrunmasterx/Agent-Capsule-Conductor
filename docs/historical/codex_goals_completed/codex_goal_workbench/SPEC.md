# Workbench Next Phase Spec

Status: historical Phase 2 Workbench package.

Current reading rule: this document describes the older usability/server/read-only UI phase. The
current Workbench is editable and run-scoped. For current Workbench rules, read
`docs/CURRENT_ARCHITECTURE.md`, `web/README.md`, and
`docs/codex_goal_visual_workbench_ux_refactor/QUALITY_REPORT.md`.

## Product definition

Agent Capsule Workbench is the usability layer on top of Agent Capsule Conductor MVP.

The existing MVP is a headless runtime. This next phase adds:

1. better CLI inspection,
2. run indexing,
3. capsule authoring utilities,
4. local API server,
5. read-only visual inspection UI.

## Non-goals for this package

Do not implement in Phase 2A or Phase 2B:

- drag-and-drop workflow editor,
- node connection editing,
- workflow save from UI,
- autonomous scheduler,
- custom LLM tool-calling loop,
- database-first artifact backend,
- cloud deployment.

## Phase 2A CLI commands

### `acc runs list`

Lists known runs from `runs/index.json` or by scanning `runs/`.

Output fields:

- run_id
- workflow_id
- status
- started_at
- ended_at
- duration_ms
- node_count
- failed_nodes

Optional:

```bash
acc runs list --json
```

### `acc runs show <run_id>`

Shows a run summary and node summaries.

Optional:

```bash
acc runs show <run_id> --json
```

### `acc inspect --json <run_dir>`

Extends existing inspect command with machine-readable JSON output.

### `acc capsule test <capsule_id>`

Runs a capsule using a supplied test input.

```bash
acc capsule test <capsule_id> --input <input.json> --run-dir <run_dir>
```

### `acc capsule clone <source_id> <new_id>`

Copies a capsule template to a new capsule id and updates `capsule.yaml` metadata.

### `acc capsule doctor <capsule_id>`

Checks common authoring mistakes:

- missing prompt template,
- missing schema files,
- missing artifacts,
- invalid runtime,
- dangerous permissions,
- artifact paths outside capsule/run dir,
- output schema too deeply nested, if detectable.

## Phase 2A data files

### `runs/index.json`

Project-level run index.

### `run_summary.json`

Per-run summary.

### `node_summary.json`

Per-node summary. Generated during or after each node run.

### ArtifactManifest v2

Adds UI/display metadata to existing artifact manifest.

## Phase 2B server

The server must be a thin wrapper around core functionality.

```text
acc.core  -> no FastAPI dependency
acc.server -> imports acc.core
web       -> calls acc.server
```

## Phase 2C UI

Read-only UI only.

The UI should not write workflow files. It should consume server APIs.
