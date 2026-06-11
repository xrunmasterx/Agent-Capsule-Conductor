# MIGRATION_NOTES

Status: Updated for the Phase 10 ideal-layering refactor.

## Public Commands

No public command migration was required.

Commands preserved:

- `uv run acc run <capsule_id> --emit-conductor-json`
- `uv run acc workflow validate <graph_or_accflow> --json`
- `uv run acc workflow run <graph_or_accflow> --emit-json`
- `uv run acc inspect <run_dir>`
- `uv run acc session inspect <run_dir>`

## Internal Migration Completed

- `acc.clean_workflow` was removed after CLI and tests were updated to call the new layers directly.
- Legacy `.graph.json` workflow execution now imports to canonical `WorkflowTemplate` through
  `LegacyGraphImporter`, then runs through `WorkflowAppService`.
- `acc.workflow_runner` was removed after production code and tests stopped importing it. The
  replacement is `WorkflowAppService`.
- Workflow CLI and server run/validate paths route through `WorkflowAppService`.
- Debugger rerun/fork paths generate a lineage graph and invoke `WorkflowAppService` instead of
  calling old workflow runner internals.
- New implementation ownership moved to:
  - `acc.engine`: pure parsing, validation, scheduling, policy transitions.
  - `acc.store`: run layout, manifests, events, inbox/outbox, artifact bundles.
  - `acc.runtime`: node execution, permission/env/workspace enforcement.
  - `acc.app`: orchestration.

## Compatibility Notes

- Existing `.accflow.json` fields `kind`, `tool`, `runtime`, and `workflow_ref` remain supported.
- Phase 10 aliases `type` and `runner` are normalized at the parser boundary.
- `runner: "fake"` on a `type: "tool"` node maps to the fake tool runner used by hermetic tests.

## Remaining Legacy Surface

- `.graph.json` remains supported as a legacy authoring/import format for compatibility.
- `acc.environment` and `acc.port_io` still exist for legacy capsule execution context and port
  inspection compatibility, but normal workflow scheduling is no longer owned by them.
