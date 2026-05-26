# Ideal Layering Design

## Architecture

```text
acc.cli / acc.server / web
        |
        v
acc.app
        |
        +--> acc.engine  ----> acc.domain
        |
        +--> acc.runtime ----> acc.domain / acc.ports
        |
        +--> acc.store   ----> acc.domain / acc.ports
        |
        +--> acc.ports
```

## Dependency rule

Allowed:

```text
cli -> app
server -> app
app -> engine/runtime/store/domain/ports
engine -> domain
runtime -> domain/ports
store -> domain/ports
ports -> domain
domain -> standard library only, no IO/process/UI imports
```

Forbidden:

```text
domain -> cli/store/runtime/engine/app
engine -> store/runtime/cli/server
store -> cli/server/ui
runtime -> cli/server/ui
engine -> subprocess/os.environ/open/path write
```

## Why app layer exists

The ideal design is not `engine -> runtime -> store -> domain`. That can make engine too powerful.

Better design:

```text
engine creates plans and state transitions.
app executes the loop using runtime and store.
store persists.
runtime executes nodes.
```

This keeps engine mostly pure and testable.

## Core execution loop

```text
1. app loads WorkflowTemplate via store or parser.
2. app asks engine.validate(template).
3. app creates EnvironmentFrame through store.
4. engine computes ready nodes / levels.
5. app asks store to materialize inbox for ready node.
6. app calls runtime runner.
7. runtime returns RuntimeResult.
8. app asks store to persist output/artifacts/events.
9. engine applies result to workflow state.
10. repeat until workflow complete or failed.
```

## Data materialization

DataEdge never writes directly into downstream node directory. The app/store owns materialization:

```text
upstream outbox
    -> store.materialize_data_edge()
        -> downstream inbox
```

## Permission enforcement

PermissionProfile is part of domain and validated before runtime execution.

Runtime must receive only an ExecutionContext created by app/store:

```text
run_dir
node_dir
inbox_dir
outbox_dir
artifact_dir
workspace_dir
env_whitelist
workspace_access
```

Runtime must not invent paths.
