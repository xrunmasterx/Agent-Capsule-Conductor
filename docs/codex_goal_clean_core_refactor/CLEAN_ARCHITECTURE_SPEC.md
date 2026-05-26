# Clean Architecture Spec

## Allowed dependency direction

```text
cli/web/server -> application services -> engine/runtime/store -> domain
```

Domain models must not import CLI, web, adapters, subprocess, or external agent modules.

## Required refactor checks

Codex must inspect current code and classify modules as:

- keep
- move
- rewrite
- delete

Document the result in:

```text
docs/codex_goal_clean_core_refactor/FINDINGS.md
docs/codex_goal_clean_core_refactor/QUALITY_REPORT.md
```

## Delete aggressively

Delete or replace old modules if they:

- conflate workflow template and run state,
- use ACC install directory as workspace,
- allow direct upstream writes into downstream directories,
- mix UI-specific state into runtime graph,
- duplicate scheduler logic in multiple places,
- hide graph execution behind button sequence logic,
- make default tests depend on external tools.

## Preserve only if clean

Preserve old code only when it maps clearly into the new architecture.

Examples:

- old adapter code may be reused under AgentNodeRunner,
- old artifact store may be reused if it supports EnvironmentFrame / Inbox / Outbox,
- old graph UI may be reused if it uses WorkflowTemplate IR rather than React Flow state as source of truth.
