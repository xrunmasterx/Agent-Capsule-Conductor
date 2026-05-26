# Design

## Architecture

```text
ACC Workbench / CLI / API
        |
        v
WorkflowTemplate Authoring IR
        |
        v
Environment Binding Resolver
        |
        v
EnvironmentFrame Runtime
        |
        v
WorkflowEngine
  - graph validator
  - scheduler
  - data materializer
  - event emitter
        |
        +--> AgentNodeRunner
        |      +--> Codex / Claude / Cursor / Hermes / Generic CLI
        |
        +--> ToolNodeRunner
        |      +--> Python / Shell / if / for_each / merge / wait
        |
        +--> WorkflowNodeRunner
               +--> nested WorkflowTemplate
```

## Module boundaries

### acc.domain

Pure models:

- WorkflowTemplate
- EnvironmentBinding
- EnvironmentFrame
- NodeSpec
- PortContract
- ControlEdge
- DataEdge
- ArtifactBundle
- WorkflowRunManifest

No subprocess, no filesystem side effects except validation helpers.

### acc.engine

Runtime engine:

- graph validation
- topological levels
- scheduler
- data materialization
- resource locks
- event emission
- failure policy

### acc.runtime

Node execution:

- AgentNodeRunner
- ToolNodeRunner
- WorkflowNodeRunner
- adapter calls

### acc.store

Filesystem layout:

- run directories
- environment directories
- inbox/outbox
- artifact bundles
- event logs
- snapshots

### acc.cli

CLI wrappers around core services.

### acc.web / acc.server

Optional. Must not be required for core tests.

## Core invariant

The workflow engine never knows how Codex or Claude thinks. It only knows:

- node input ports,
- environment frame,
- permissions,
- events,
- output ports,
- artifacts,
- status.
