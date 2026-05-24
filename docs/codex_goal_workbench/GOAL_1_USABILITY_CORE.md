# Goal 1: Agent Capsule Workbench Usability Core

## Objective

Extend the existing Agent Capsule Conductor MVP into a cleaner CLI-level workbench core.

Do not rebuild the MVP. Build on the existing `acc` CLI, capsule registry, runner, artifact store, validation system, adapters, and batch runner.

## Required deliverables

1. Run discovery and inspection:
   - `acc runs list`
   - `acc runs show <run_id>`
   - `acc inspect --json <run_dir>`

2. Capsule authoring utilities:
   - `acc capsule test <capsule_id> --input <input.json> --run-dir <run_dir>`
   - `acc capsule clone <source_id> <new_id>`
   - `acc capsule doctor <capsule_id>`

3. Data models:
   - `RunIndex`
   - `RunSummary`
   - `NodeRunSummary`
   - `ArtifactManifestV2`

4. Index and summary files:
   - `runs/index.json`
   - per-node `node_summary.json`
   - optional per-run `run_summary.json`

5. Better error reporting:
   - classify errors as `schema_error`, `artifact_error`, `adapter_error`, `workspace_error`, `timeout`, `unavailable`
   - show the most useful file paths for debugging

## Must preserve

- Existing MVP tests must keep passing.
- Existing `acc run` behavior must not break.
- `--emit-conductor-json` stdout must remain exactly one JSON object.
- Default tests must remain hermetic.
- Do not add UI.
- Do not add a server.
- Do not add a database.

## Completion condition

Complete only when:

- all previous MVP acceptance commands still pass,
- all new Phase 2A acceptance commands pass,
- new tests cover RunIndex, NodeRunSummary, ArtifactManifestV2, and new CLI commands.
