# ACC Ideal Layering Spec

## 1. Product definition

ACC is a local-first Agent Workflow runtime. It runs stateless WorkflowTemplates by binding them to EnvironmentFrames, scheduling Nodes deterministically, transporting artifacts through Port / Inbox / Outbox contracts, and executing nodes through isolated Runtime runners.

## 2. Core modules

### `acc.domain`

Pure data and invariants. No filesystem IO. No subprocess. No CLI. No UI.

Contains:

- WorkflowTemplate
- EnvironmentBinding
- EnvironmentFrame
- NodeSpec
- NodeId
- PortId
- PortContract
- ControlEdge
- DataEdge
- WorkflowPolicy
- FailureMode
- RetryPolicy
- TimeoutPolicy
- PermissionProfile
- EnvPolicy
- WorkspaceAccess
- ArtifactBundle
- RuntimeResult
- Event

### `acc.ports`

Protocol / interface definitions.

Contains:

- RunStoreProtocol
- EventSinkProtocol
- NodeRunnerProtocol
- ClockProtocol
- IdGeneratorProtocol
- PathResolverProtocol

### `acc.engine`

Pure graph and scheduling logic.

Responsibilities:

- validate workflow graph
- reject local absolute workspace paths in templates
- validate control/data edge consistency
- compute topological levels
- build execution plan
- apply failure policy
- plan data materialization
- calculate node readiness
- expose deterministic state transitions

Forbidden:

- opening files
- writing files
- spawning processes
- reading OS env
- printing to stdout/stderr

### `acc.store`

Filesystem-backed implementation of storage ports.

Responsibilities:

- create run directory
- write workflow_run_manifest.json
- write environment_manifest.json
- write events.jsonl
- write nodes/<node_id>/events.jsonl
- write nodes/<node_id>/output.json
- manage inbox/outbox materialization
- write artifact_bundle.json
- reject path traversal
- support retry attempt cleanup

### `acc.runtime`

Runtime execution.

Responsibilities:

- FakeNodeRunner
- ToolNodeRunner
- AgentNodeRunner abstraction
- WorkflowNodeRunner
- timeout enforcement
- env whitelist
- cwd selection
- workspace access policy
- output/artifact validation

Forbidden:

- changing workflow graph semantics
- modifying engine validation rules
- printing logs to machine-readable stdout
- inheriting full host environment by default

### `acc.app`

Application services.

Responsibilities:

- orchestrate engine/store/runtime
- run workflow
- run node
- rerun/fork if existing commands use them
- map CLI/API calls to core services

### `acc.cli`

Thin entry layer.

Responsibilities:

- parse arguments
- call app services
- output stable JSON when requested
- route logs to stderr

## 3. Public behavior to preserve

The implementation may change module internals, but these behaviors must remain stable or have explicit migration notes:

- `uv run pytest -q` passes.
- `uv run ruff check .` passes.
- Existing echo/fake capsule smoke tests pass or are migrated to equivalent clean-core commands.
- `--emit-conductor-json` emits exactly one JSON object to stdout.
- Default tests do not require real Codex/Claude/Cursor/Hermes/Conductor/network.
- No stateless workflow writes to ACC install directory.
- Data flows through scheduler-managed outbox -> inbox materialization.

## 4. Deletion policy

It is allowed to remove legacy modules if:

1. equivalent behavior exists in the new layer,
2. tests prove it,
3. MIGRATION_NOTES.md documents the change.
