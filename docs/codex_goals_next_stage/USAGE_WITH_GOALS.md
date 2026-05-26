# How to Use These Goals with Codex

## 1. Copy package into repository

From project root:

```bash
bash agent_capsule_next_goals_package/scripts/copy_into_repo.sh
```

## 2. Commit baseline first

```bash
git status
git add .
git commit -m "chore: baseline before next-stage ACC goals"
```

## 3. Ask Codex for a plan first

Do not start with `/goal`.

Use:

```text
/plan Read AGENTS.md, docs/codex_goal*/**/*.md if present, docs/codex_goals_next_stage/*.md, and docs/human/ACC_NEXT_STAGE_PLAIN_LANGUAGE.md. Produce a concise plan for next-stage ACC goals. Do not implement yet.
```

Reject the plan if it proposes:

- rewriting `acc run`,
- building a new LLM agent framework,
- ignoring stdout JSON contract,
- making default tests depend on real Codex/Claude/Hermes,
- skipping browser evidence for browser UX,
- auto-applying dangerous GraphOps patches.

## 4. Use Master Goal or individual goals

For overnight full run, use:

```text
docs/codex_goals_next_stage/GOAL_COMMAND_MASTER.txt
```

For safer step-by-step execution, use:

```text
GOAL_COMMAND_1_DEBUGGER_REPLAY.txt
GOAL_COMMAND_2_WORKFLOW_CAPSULES.txt
GOAL_COMMAND_3_AGENT_CONTROL_PLANE.txt
GOAL_COMMAND_4_BROWSER_E2E_UX.txt
```

## 5. During development

Use short steering instructions:

```text
Preserve acc run stdout JSON contract.
```

```text
Default tests must remain hermetic.
```

```text
Use browser automation to rerun failed journey and record evidence.
```

```text
Do not mark goal complete until ACCEPTANCE.md passes.
```

## 6. Completion check

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goals_next_stage/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark complete if any command fails.
```
