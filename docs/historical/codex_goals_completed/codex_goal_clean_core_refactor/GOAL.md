# Goal: ACC Clean Core Refactor

## Objective

Aggressively refactor ACC into a clean, lightweight, robust environment-scoped workflow kernel.

This goal supersedes older implementation details when conflicts exist. Previous docs remain historical references. The active contract is this directory:

```text
docs/codex_goal_clean_core_refactor/
```

## New core model

Implement and enforce these concepts:

```text
WorkflowTemplate
  Stateless reusable workflow graph.

EnvironmentBinding
  Local runtime binding that assigns a workspace to a workflow template.

EnvironmentFrame
  Run-time environment created from a template + binding.

NodeSpec
  A node inside a workflow. Node kinds are agent, tool, and workflow.

AgentSessionNode
  Starts a mature agent CLI/SDK in an EnvironmentFrame working directory.

ToolNode
  Runs deterministic logic: atomic script, if, for_each, merge, wait.

WorkflowNode
  Runs a nested workflow as a node.

PortContract
  Declares node input/output ports.

Inbox/Outbox
  File/artifact channels for node-to-node data transfer.

ArtifactBundle
  Structured node output package.
```

## Must deliver

1. New clean domain model.
2. Workflow template schema that does not store local absolute workspace paths.
3. Environment binding schema for local workspace assignment.
4. Runtime EnvironmentFrame creation.
5. Agent nodes inherit effective cwd from their EnvironmentFrame.
6. Stateless workflows use run-scoped ephemeral workspace by default, not the ACC install directory.
7. Control edges and data edges are separate.
8. Data transfer uses outbox -> scheduler materialization -> inbox.
9. Deterministic scheduler with bounded concurrency and workspace write locks.
10. Behavior pack policy: workspace_native, template_overlay, hybrid.
11. Effective behavior pack snapshot per session.
12. Run artifacts and events remain inspectable.
13. Old architecture debt may be deleted or replaced.
14. Acceptance tests define the new completion boundary.

## Non-goals

Do not implement:

- a new LLM tool-calling framework,
- a full Conductor DSL clone,
- cloud deployment,
- database-backed backend,
- distributed workers,
- complex SaaS/team features,
- default tests that require real external agents.

## Completion condition

The goal is complete only when every required command in `ACCEPTANCE.md` passes, the new model is documented, and `QUALITY_REPORT.md` states which old modules were kept, replaced, or deleted.
