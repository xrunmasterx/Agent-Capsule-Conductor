# Refactor Strategy

## Step 1: Audit

Before changing code, inspect current implementation and write:

```text
docs/codex_goal_clean_core_refactor/FINDINGS.md
```

Classify each issue:

```text
critical
high
medium
low
```

## Step 2: Extract domain

Create clean domain models before rewriting execution.

## Step 3: Replace scheduler

Replace old graph runner if it mixes button-flow UI logic, session state, or artifact materialization logic.

## Step 4: Replace workspace model

Implement EnvironmentBinding and EnvironmentFrame.

## Step 5: Replace IO model

Implement ports, inbox, outbox, artifact bundle.

## Step 6: Reconnect agent/tool runners

Reuse old adapters only if they fit the new AgentNodeRunner boundary.

## Step 7: Rebuild CLI commands

Keep or replace commands based on clean architecture, not compatibility pressure.

## Step 8: Run acceptance

Only mark complete after ACCEPTANCE.md passes.
