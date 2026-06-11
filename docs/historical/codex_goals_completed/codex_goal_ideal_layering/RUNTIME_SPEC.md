# Runtime Spec

## Responsibilities

`acc.runtime` owns node execution:

- FakeNodeRunner,
- ToolNodeRunner,
- AgentNodeRunner abstraction,
- WorkflowNodeRunner,
- subprocess execution where needed,
- timeout enforcement,
- env whitelist,
- workspace access enforcement,
- output collection.

## Runtime input

Runtime receives an ExecutionContext from app/store. It must not invent paths.

```text
run_dir
node_dir
inbox_dir
outbox_dir
artifact_dir
workspace_dir
events_path
permission_profile
allowed_env
```

## PermissionProfile

Required fields:

```text
workspace_access: read_only | writes_run_only | writes_workspace
network: false | true
shell: false | true
dangerous: false | true
env_policy: acc_whitelist | explicit_allowlist
allowed_env: list[str]
timeout_seconds: int
```

## Default env whitelist

By default only pass:

```text
ACC_RUN_DIR
ACC_NODE_ID
ACC_INBOX_DIR
ACC_OUTBOX_DIR
ACC_ARTIFACT_DIR
ACC_WORKSPACE_DIR
ACC_EVENTS_JSONL
```

Plus explicitly declared env keys.

## Must test

- Runtime does not inherit full host env.
- Missing permission profile fails validation.
- writes_workspace requires workspace lock.
- read_only node cannot write workspace in fake simulation.
- timeout returns timeout RuntimeResult.
- runner writes node events.
