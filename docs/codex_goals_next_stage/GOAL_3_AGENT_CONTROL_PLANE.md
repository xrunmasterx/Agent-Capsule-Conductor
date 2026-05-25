# Goal 3: Agent-callable ACC Control Plane

## Objective

Make ACC safely callable by higher-level agents such as Codex, Claude, Cursor, or Hermes.

## Problem

The user wants to let a higher-level agent call ACC workflows, inspect artifacts, and propose workflow changes. This requires a stable machine-readable control plane.

## Required CLI JSON commands

All commands must support stable JSON output:

```bash
uv run acc capsules list --json
uv run acc capsules show <capsule_id> --json
uv run acc workflows list --json
uv run acc workflows show <workflow_id_or_path> --json
uv run acc workflow run <workflow_path> --emit-json
uv run acc runs list --json
uv run acc runs show <run_id_or_dir> --json
uv run acc artifacts get <artifact_ref> --json
uv run acc graphops validate <patch.json> --json
uv run acc graphops dry-run <patch.json> --json
```

## Optional MCP server

If feasible without breaking hermetic tests, implement:

```bash
uv run acc control serve --mcp --port 8765
```

Expose tools:

```text
list_capsules
describe_capsule
list_workflows
describe_workflow
run_workflow
inspect_run
get_artifact
validate_graph_patch
dry_run_graph_patch
```

Do not expose destructive apply by default.

## Safety boundary

Default agent-callable operations may:

- query,
- run existing workflow,
- inspect run,
- get artifact,
- validate patch,
- dry-run patch.

Default operations may not:

- apply graph patch,
- delete capsule,
- enable network,
- enable write_files,
- enable danger-full-access,
- remove human gate,
- modify output schema.

## Browser/Workbench integration

Control-plane results should be usable by the Workbench, but this goal does not require a full UI redesign.

## Acceptance summary

The goal passes when:

- stable JSON CLI commands work,
- optional MCP server is implemented or gap is documented,
- dangerous operations are blocked by default,
- GraphOps validate/dry-run returns machine-readable reports,
- higher-level agent can discover and run an existing workflow using only JSON commands.
