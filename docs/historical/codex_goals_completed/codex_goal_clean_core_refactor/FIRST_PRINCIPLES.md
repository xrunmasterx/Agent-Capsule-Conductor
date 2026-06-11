# First Principles

## 1. Template is not runtime state

A workflow file is an asset. It must be portable.

Therefore:

- `WorkflowTemplate` must not store machine-specific absolute workspace paths.
- Local workspace selection belongs to `EnvironmentBinding`.
- Runtime materialization belongs to `EnvironmentFrame`.

## 2. Environment is not a node

A workflow is not merely a node. It is also an execution environment.

Therefore:

- Agent nodes inherit an effective working directory from an environment.
- Tools and nested workflows also execute inside an environment frame.
- Workspace config such as `AGENTS.md`, `CLAUDE.md`, skills, hooks, and rules are environment inputs.

## 3. Session is not template

Opening Codex/Claude/Cursor/Hermes CLI is a session behavior.

Therefore:

- Agent node definitions are static.
- Each run creates independent session state.
- Session outputs must be explicit artifacts, not implicit chat memory.

## 4. Control dependency is not data dependency

`A -> B` can mean execution order or data transfer. These must be separate.

Therefore:

- Use `control_edges` for readiness.
- Use `data_edges` for artifact/output materialization.

## 5. Upstream must not write downstream

Direct upstream writes into downstream directories break ownership and replay.

Therefore:

- A node writes its own outbox.
- Scheduler materializes data into downstream inbox.
- Downstream reads inbox.

## 6. Stateless does not mean ACC install directory

No workflow should write into the ACC installation directory by default.

Therefore:

- Unbound stateless workflows use run-scoped ephemeral workspaces.

## 7. Intelligent internals, deterministic exterior

Codex/Claude/Cursor/Hermes may be non-deterministic internally.

ACC must still make exterior execution deterministic:

- explicit inputs,
- explicit environment,
- explicit permissions,
- explicit outputs,
- explicit artifacts,
- explicit events.

## 8. Keep the core small

If a feature is not needed for environment-scoped workflow execution, it does not belong in the core.

Avoid:

- database by default,
- cloud by default,
- distributed workers,
- full Conductor clone,
- new LLM agent loop.
