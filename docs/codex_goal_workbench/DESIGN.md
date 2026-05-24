# Workbench Next Phase Design

## 1. Design philosophy

The current MVP is the execution kernel.

The next phase should not rewrite the kernel. It should make the kernel easier to inspect, operate, and extend.

Correct layering:

```text
acc.core
  registry / runner / artifacts / validation / workspace / adapters

acc.cli
  command-line interface

acc.server
  local API server

acc.web
  visual inspection UI
```

The core must not depend on server or UI code.

## 2. Architecture

```text
┌──────────────────────────────────────────────┐
│ acc-web                                      │
│ Run Inspector / Capsule Browser / Viewer     │
└──────────────────────┬───────────────────────┘
                       │ HTTP
                       ▼
┌──────────────────────────────────────────────┐
│ acc-server                                   │
│ FastAPI routes over acc.core                 │
└──────────────────────┬───────────────────────┘
                       │ calls
                       ▼
┌──────────────────────────────────────────────┐
│ acc-core                                     │
│ Registry / Runner / Artifact / Workspace     │
│ Validation / Adapter                         │
└──────────────────────┬───────────────────────┘
                       │ invokes
                       ▼
┌──────────────────────────────────────────────┐
│ External mature agents                       │
│ Codex / Claude / Generic CLI                 │
└──────────────────────────────────────────────┘
```

## 3. Phase 2A components

### 3.1 RunIndex

A lightweight JSON index for previous runs.

Purpose:

- avoid manually browsing `runs/`,
- power CLI `acc runs list`,
- power future API `GET /api/runs`,
- later replaceable by SQLite.

### 3.2 RunSummary

Per-run normalized summary.

Purpose:

- UI should not parse every log file,
- CLI can show concise run status,
- failed nodes can be listed quickly.

### 3.3 NodeRunSummary

Per-node normalized summary.

Purpose:

- summarize one capsule/session execution,
- point to input/output/artifacts/logs,
- classify failures.

### 3.4 ArtifactManifest v2

Adds presentation metadata:

- artifact name,
- type,
- viewer,
- display priority,
- required/optional.

This lets a future UI decide whether to render markdown, JSON, text, patch, or log views.

## 4. Phase 2B components

### 4.1 API server

FastAPI local server.

Purpose:

- avoid UI reading raw files directly,
- centralize path safety,
- expose stable API over unstable internal files.

### 4.2 Route groups

- health
- capsules
- runs
- artifacts
- workflows

## 5. Phase 2C components

### 5.1 Run Inspector

Most important first UI.

Shows:

- run status,
- node list/DAG,
- selected node details,
- input/prompt/output/artifacts/logs.

### 5.2 Capsule Browser

Shows:

- capsule metadata,
- runtime,
- workspace,
- permissions,
- schemas,
- last validation/test status.

### 5.3 Workflow Viewer

Read-only DAG view.

No editing yet.

## 6. Future GraphOps

Future editing must use:

```text
edit intent -> GraphPatch -> validate -> dry-run -> human approval -> apply
```

Never let UI or LLM directly mutate workflow YAML without validation.
