# RISK_REGISTER

## R1: Legacy graph runner can hide old architecture debt

Severity: High

Risk:

- Resolved: `acc.workflow_runner` was removed after `.graph.json` execution moved behind
  `LegacyGraphImporter` and `WorkflowAppService`.

Mitigation:

- `acc.clean_workflow` has been removed.
- Migrate or retire `.graph.json` workflow execution after verifying UI/server/debugger replacement coverage.
- Add `QUALITY_REPORT.md` responsibility map.

## R2: Boundary tests may be too weak

Severity: High

Risk:

- If tests only check package existence, future imports can re-couple the layers.

Mitigation:

- Use AST scanning with explicit forbidden imports.
- Include checks for direct `os.environ`, `subprocess`, and CLI/server imports in pure layers.

## R3: Runtime safety can regress when real agents are added

Severity: High

Risk:

- Real Codex/Claude/Cursor/Hermes runners may inherit secrets, write arbitrary workspace files, or enable network/shell by accident.

Mitigation:

- Add hard `PermissionProfile`, `ExecutionContext`, env whitelist, workspace access, and dangerous permission checks before real runner integration.

## R4: Windows path behavior can differ from POSIX acceptance snippets

Severity: Medium

Risk:

- Acceptance examples mention `/tmp`, but this workspace runs on Windows.

Mitigation:

- Use equivalent PowerShell paths locally and keep CLI JSON contract tests platform-neutral.

## R5: Existing dirty worktree may contain user work

Severity: Medium

Risk:

- Refactor could accidentally overwrite unrelated local changes.

Mitigation:

- Avoid reverting files.
- Scope edits to Phase 10 core/docs/tests unless a dependency requires touching a file.
