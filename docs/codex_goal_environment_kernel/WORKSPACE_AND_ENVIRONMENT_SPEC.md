# Workspace and Environment Spec

## 1. Terms

- `WorkflowTemplate`: saved reusable workflow definition.
- `WorkspaceBinding`: user-provided runtime path for a workflow.
- `EnvironmentFrame`: runtime scope that binds a workflow instance to a workspace.
- `Stateless`: saved template has no fixed workspace path.
- `Stateful`: runtime instance has a concrete workspace path.

## 2. Saved workflow rule

Saved workflow templates must be portable.

They must not persist local absolute paths by default.

Local bindings go into:

```text
*.binding.local.json
```

and should be gitignored.

## 3. Default stateless workspace

Do not use ACC install directory as mutable workspace.

Use:

```text
runs/<run_id>/environments/<env_id>/workspace/
```

## 4. Bound workspace

If user provides:

```bash
--workspace F:\Agent-Capsule-Conductor
```

then agent nodes run with:

```text
cwd = F:\Agent-Capsule-Conductor
```

unless node overrides a relative subdirectory.

## 5. Workspace-native config

Agent nodes can use native config from cwd:

```text
AGENTS.md
CLAUDE.md
.cursor/
.claude/skills/
skills/
hooks/
```

This is controlled by `behavior_pack_policy`.

## 6. Safety

- No default writes to ACC install directory.
- No direct upstream writes into downstream workspaces.
- Statefulness must be explicit at run/binding time.
- Workspace path must be validated and normalized.
- Optional allowlist root should be supported.
