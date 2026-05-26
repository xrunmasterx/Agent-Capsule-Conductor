# Store Spec

## Responsibilities

`acc.store` owns file persistence:

- run directories,
- environment manifests,
- workflow event logs,
- node event logs,
- node output files,
- inbox/outbox,
- artifact bundles,
- attempt cleanup,
- path traversal defense.

## Required store contracts

```python
class RunStoreProtocol:
    create_run(...)
    create_environment(...)
    create_node_attempt(...)
    write_workflow_event(...)
    write_node_event(...)
    write_node_output(...)
    write_artifact_bundle(...)
    materialize_data_edge(...)
    cleanup_node_attempt(...)
```

## Path safety

- Reject `..` traversal.
- Reject absolute paths inside templates unless explicitly from EnvironmentBinding.
- Keep run-scoped paths under run_dir.
- Store must never write to ACC install directory as default workspace.

## Must test

- Creates expected run layout.
- Materializes outbox to inbox without direct upstream writes.
- Cleans retry attempt outputs.
- Rejects path traversal.
- Writes node-level events.
- Writes workflow-level events.
