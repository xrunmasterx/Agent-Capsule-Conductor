# Implementation Order

## Milestone 1: Model and schema

Implement:

- WorkflowTemplate
- EnvironmentFrame
- WorkspaceBinding
- PortSpec
- InboxManifest
- OutboxManifest
- ArtifactBundle
- BehaviorPackPolicy

Run model tests.

## Milestone 2: Workflow binding

Implement:

```bash
acc workflow bind <workflow> --workspace <path> --out <binding.json>
```

Ensure saved workflow is not mutated with local path.

## Milestone 3: Environment creation

Implement:

- stateless ephemeral environment workspace;
- stateful bound environment workspace;
- environment manifest.

## Milestone 4: Port IO

Implement:

- outbox writing/manifest;
- inbox materialization;
- ports inspect command;
- multiple upstreams to one input port.

## Milestone 5: Agent node cwd inheritance

Agent nodes must run with cwd inherited from EnvironmentFrame.

Add fake adapter tests to verify cwd.

## Milestone 6: Behavior pack policies

Implement:

- workspace_native;
- template_overlay;
- hybrid;
- effective behavior snapshot;
- conflict report.

## Milestone 7: Nesting validation

Implement:

- stateless child workflow allowed;
- stateful-in-stateful rejected by default.

## Milestone 8: Scheduler integration

Update workflow runner readiness and fan-out semantics to use ports and environment frames.

## Milestone 9: UI integration if UI exists

Update workbench to show:

- workflow container/environment boundary;
- bound workspace status;
- ports;
- inbox/outbox inspector;
- node cwd.

## Milestone 10: Acceptance

Run all commands in ACCEPTANCE.md.
