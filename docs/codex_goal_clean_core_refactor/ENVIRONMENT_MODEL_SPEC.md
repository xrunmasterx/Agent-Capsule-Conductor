# Environment Model Spec

## WorkflowTemplate is stateless

WorkflowTemplate must not store local absolute workspace path.

## EnvironmentBinding

Binding file example:

```json
{
  "workflow_id": "environment_stateful_demo",
  "binding_name": "local_repo",
  "workspace_root": "F:/Agent-Capsule-Conductor",
  "behavior_policy": {
    "mode": "workspace_native"
  }
}
```

Binding files should be treated as local machine state.

## Stateless default

If no binding is provided, create an ephemeral workspace:

```text
runs/<run_id>/environments/<env_id>/workspace/
```

Never use ACC install directory as default workspace.

## Stateful binding

If binding is provided, use `workspace_root` as effective cwd for agent nodes, but store ACC run metadata under `runs/<run_id>/`.

## Nesting policy

Default rules:

- Stateless parent -> stateless child: allowed.
- Stateless parent -> stateful child: allowed with explicit binding.
- Stateful parent -> stateless child inheriting parent workspace: allowed.
- Stateful parent -> stateful child with different workspace: rejected by default unless `allow_nested_stateful_environment=true`.

## Behavior pack policy

Modes:

```text
workspace_native
template_overlay
hybrid
```

`workspace_native`:

- uses AGENTS.md / CLAUDE.md / skills / hooks from effective cwd.

`template_overlay`:

- materializes behavior_pack from template into effective cwd or staging area.

`hybrid`:

- combines both with explicit precedence.

Every run must snapshot the effective behavior pack.
