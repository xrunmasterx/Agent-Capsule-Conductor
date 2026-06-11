# Security Model

## Defaults

- No network by default.
- No dangerous shell by default.
- No writes outside effective workspace and run directory.
- No direct upstream writes into downstream workspace.
- No secret values in logs, events, artifacts, or manifests.

## Path safety

Reject:

- `../` traversal,
- absolute paths in artifact paths,
- symlinks escaping allowed roots unless explicitly approved,
- binding workspace paths that point to ACC install directory unless explicitly allowed and documented.

## Workspace safety

- Stateless workflows use run-scoped ephemeral workspace.
- Stateful workflows use explicit binding.
- Write nodes acquire workspace write lock.

## Agent safety

Agent nodes must receive:

- effective cwd,
- permission profile,
- timeout,
- environment variables whitelist.

Do not pass all host environment variables by default.

## GraphOps safety

If GraphOps exists:

- validate patch shape,
- dry-run materialize,
- validate resulting workflow,
- require human approval for dangerous changes.
