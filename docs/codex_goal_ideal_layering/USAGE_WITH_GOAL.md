# How to use with Codex Goal

## 1. Commit baseline

```bash
git status
git add .
git commit -m "chore: baseline before ideal layering refactor"
```

## 2. Copy package

```bash
bash acc_ideal_layering_goal_package/scripts/copy_into_repo.sh
```

## 3. Ask for plan first

```text
/plan Read AGENTS.md, docs/codex_goal_ideal_layering/*.md, and docs/human/ACC_IDEAL_LAYERING_PLAIN_LANGUAGE.md. Produce a concise ideal-layering refactor plan. Do not implement yet.
```

Reject the plan if it proposes:

- preserving broken legacy layers,
- implementing new product features first,
- calling real external agents in default tests,
- ignoring stdout JSON contract,
- moving files without dependency-boundary tests.

## 4. Start goal

Copy `GOAL_COMMAND.txt` into Codex.

## 5. Completion

Ask Codex:

```text
Run every required acceptance command in docs/codex_goal_ideal_layering/ACCEPTANCE.md. Report command, exit code, and output. Do not mark complete if any command fails.
```
