# Scope Frame And Environment Spec

## Purpose

`ScopeFrame` is the runtime function scope. It defines what a workflow invocation and its node sessions can see.

## ScopeFrame fields

Required:

- frame id,
- invocation id,
- parent frame id,
- call depth,
- workflow id,
- workspace root,
- environment root,
- inbox root,
- outbox root,
- artifact root,
- behavior snapshot path,
- ephemeral flag,
- binding path.

## Workspace rules

Default:

```text
no workspace/binding -> run-scoped ephemeral workspace
```

Explicit stateful workspace:

```text
--workspace or binding file -> stateful scope frame
```

Nested workflow:

```text
inherit_parent -> child uses parent workspace root
new_ephemeral  -> child gets its own run-scoped workspace
binding_required -> child must receive explicit binding
forbidden -> child workflow calls rejected
```

## Stateful nesting

Stateful parent to stateful child is rejected by default. Enabling it requires explicit policy and tests proving no upstream direct writes into downstream workspaces.

## Behavior pack

Workspace-native behavior files may be snapshotted into the scope frame. The snapshot is evidence, not a license for templates to store local machine paths.

