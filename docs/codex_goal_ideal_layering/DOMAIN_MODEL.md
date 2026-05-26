# Domain Model

The domain model is the stable language of ACC.

## Required entities

```text
WorkflowTemplate
EnvironmentBinding
EnvironmentFrame
NodeSpec
AgentNodeSpec
ToolNodeSpec
WorkflowNodeSpec
PortContract
ControlEdge
DataEdge
WorkflowPolicy
FailureMode
RetryPolicy
TimeoutPolicy
PermissionProfile
EnvPolicy
WorkspaceAccess
ArtifactBundle
RuntimeResult
WorkflowEvent
NodeEvent
```

## Critical invariants

1. WorkflowTemplate must not contain local absolute workspace paths.
2. EnvironmentBinding owns local workspace paths.
3. EnvironmentFrame is created per run.
4. ControlEdge determines readiness/order.
5. DataEdge determines artifact/output transport.
6. A DataEdge must be from a control ancestor unless explicitly marked as external input.
7. Node writes to its own outbox/artifact directory only.
8. Store materializes upstream outbox to downstream inbox.
9. PermissionProfile must be explicit before runtime execution.
10. RuntimeResult must be JSON serializable.

## No IO rule

Domain can define paths as strings or value objects, but cannot create/delete/write/read files.
