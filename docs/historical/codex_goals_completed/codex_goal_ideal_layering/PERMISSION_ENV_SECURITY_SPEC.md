# Permission, Environment, and Security Spec

## Why this matters

Fake runner risk is small. Real Codex/Claude/Cursor/Hermes runners can read files, write workspace, call shell, access network, and inherit secrets.

Therefore permissions must be a hard contract before real runner integration.

## Required contract

Every executable node must declare PermissionProfile.

```json
{
  "workspace_access": "read_only",
  "network": false,
  "shell": false,
  "dangerous": false,
  "env_policy": "acc_whitelist",
  "allowed_env": [],
  "timeout_seconds": 60
}
```

## Workspace access semantics

```text
read_only:
  Can read workspace. Cannot write workspace.

writes_run_only:
  Can write run_dir/node_dir/artifacts/outbox. Cannot write workspace.

writes_workspace:
  Can write effective workspace. Requires workspace write lock.
```

## Negative tests

- dangerous true without explicit allow flag is rejected.
- full host env inheritance is rejected.
- write_workspace node without lock fails.
- path traversal in artifact/inbox/outbox fails.
- network true without explicit policy fails in hermetic mode.

## Secret safety

Add minimal redaction utilities if logs may include env-like strings. At minimum, never pass sensitive env by default.
