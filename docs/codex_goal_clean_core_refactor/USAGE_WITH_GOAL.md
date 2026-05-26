# Usage with Codex Goal

## 1. Commit before starting

```bash
git status
git add .
git commit -m "chore: baseline before clean core refactor"
```

## 2. Plan first

In Codex:

```text
/plan Read AGENTS.md, docs/codex_goal_clean_core_refactor/*.md, and docs/human/ACC_CLEAN_CORE_REFACTOR_PLAIN_LANGUAGE.md. Produce a concise clean-core refactor plan. Do not implement yet.
```

Reject plan if it:

- preserves old architecture solely for compatibility,
- uses ACC install directory as default workspace,
- lets upstream write downstream workspace,
- merges control and data edges,
- builds a new LLM agent loop,
- copies Conductor's full DSL,
- adds database/cloud/distributed workers.

## 3. Set goal

Copy `GOAL_COMMAND.txt` into Codex.

## 4. Steer with short messages

Examples:

```text
Do not patch around the old graph runner. Replace it if it violates the new domain model.
```

```text
Keep WorkflowTemplate stateless. Local workspace path belongs only to EnvironmentBinding.
```

```text
No upstream direct writes to downstream folders. Use outbox -> materialization -> inbox.
```

```text
Do not mark complete until ACCEPTANCE.md passes.
```

## 5. Completion

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goal_clean_core_refactor/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark complete if any command fails.
```
