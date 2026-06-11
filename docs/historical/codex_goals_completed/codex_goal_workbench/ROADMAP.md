# Agent Capsule Workbench Roadmap

Status: historical Phase 2 roadmap.

Current reading rule: this roadmap predates the editable/run-scoped Workbench. Use
`docs/CURRENT_ARCHITECTURE.md`, `web/README.md`, and
`docs/codex_goal_visual_workbench_ux_refactor/QUALITY_REPORT.md` for current Workbench behavior.

## Context

The current repository already implements the Agent Capsule Conductor MVP:

```text
capsule.yaml
  -> acc validate
  -> acc run
  -> resolved_prompt.md
  -> adapter execution
  -> events.jsonl
  -> output.json
  -> schema validation
  -> conductor_output.json
  -> exactly-one-JSON-object stdout
```

The next phase is not to re-build the runtime. The next phase is to make the system usable, debuggable, and clean.

## Product direction

Current product:

```text
Headless Agent Capsule Runtime
```

Next product:

```text
Agent Capsule Workbench
```

The Workbench should help users:

1. inspect previous runs,
2. understand node failures,
3. create and test capsules,
4. browse artifacts,
5. view workflow DAGs,
6. later edit workflows safely.

## Phases

### Phase 2A: Usability Core

Goal: improve CLI-level usability without adding a server or UI.

Deliver:

- `acc runs list`
- `acc runs show <run_id>`
- `acc inspect --json <run_dir>`
- `acc capsule test <capsule_id>`
- `acc capsule clone <source_id> <new_id>`
- `acc capsule doctor <capsule_id>`
- RunIndex
- NodeRunSummary
- ArtifactManifest v2
- better human-readable error summaries

### Phase 2B: Local Workbench Server

Goal: expose the core through a local API without polluting the core runtime.

Deliver:

- FastAPI server
- capsules API
- runs API
- artifacts API
- workflows API, read-only
- health and version endpoints

### Phase 2C: Visual Workbench Read-only MVP

Goal: build a clean UI for inspection and understanding, not editing.

Deliver:

- Run List
- Run Inspector
- Node Detail Panel
- Artifact Viewer
- Capsule Browser
- Workflow Viewer

Explicitly do not deliver yet:

- drag-and-drop graph editing
- edge editing
- workflow save from UI
- AI auto-apply graph patches

### Phase 3: GraphOps and Workflow Editor

Goal: allow humans and LLMs to propose workflow changes safely.

Required protocol:

```text
proposal -> validate -> dry-run -> human approval -> apply
```

Deliver later:

- GraphPatch schema
- GraphOps validation
- dry-run diff
- approval UI
- workflow editor
