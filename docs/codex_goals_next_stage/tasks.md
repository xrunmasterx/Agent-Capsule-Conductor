# Goal 3 Tasks

Status: In Progress

## Task 1
- [x] Audit Goal 3 requirements against the current CLI, workflow, run index, artifact, and GraphOps implementations.
- [x] Identify the minimum compatibility layer needed for stable machine-readable JSON commands.

## Task 2
- [x] Add Goal 3 agent-callable CLI commands for capsules, workflows, runs, artifacts, and GraphOps JSON control-plane operations.
- [x] Preserve existing `acc run` behavior and stdout JSON contract.
- [x] Keep dangerous operations disabled by default.

## Task 3
- [x] Add hermetic tests and demo coverage for Goal 3 commands.
- [x] Document the MCP server gap if dependency/maintenance cost is not justified for default tests.
- [x] Run Goal 3 acceptance commands and update `docs/codex_goals_next_stage/PROGRESS.md`.
