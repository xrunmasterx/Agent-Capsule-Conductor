# How to use the Workbench Next Package with Codex `/goal`

## 1. Add, do not replace

Your repository already has:

```text
docs/codex_goal/
```

Keep it. It records the completed MVP objective and acceptance criteria.

Add this package as:

```text
docs/codex_goal_workbench/
```

Do not overwrite the old files unless you intentionally want to re-run the MVP goal from scratch.

## 2. Recommended setup

Commit the current MVP first:

```bash
git status
git add .
git commit -m "chore: complete agent capsule conductor mvp baseline"
```

Copy package contents:

```bash
cp -r agent_capsule_workbench_next_package/docs/codex_goal_workbench docs/
cp -r agent_capsule_workbench_next_package/schemas ./schemas
cp -r agent_capsule_workbench_next_package/examples ./examples
```

Optional AGENTS update:

```bash
cat agent_capsule_workbench_next_package/AGENTS_PHASE2_APPEND.md >> AGENTS.md
```

## 3. First ask Codex for a plan

Use `/plan` first:

```text
/plan Read AGENTS.md, docs/codex_goal/ACCEPTANCE.md, docs/codex_goal/PROGRESS.md, and docs/codex_goal_workbench/*.md. Produce a concise implementation plan for Phase 2A Usability Core only. Do not implement yet.
```

Reject the plan if it proposes:

- UI first,
- server before CLI usability,
- database migration,
- custom agent loop,
- workflow editor,
- real external agent dependency in default tests.

## 4. Run Goal 1 first

Copy and paste:

```text
docs/codex_goal_workbench/GOAL_COMMAND_1_USABILITY_CORE.txt
```

Do not start Goal 2 until Goal 1 acceptance passes.

## 5. Then run Goal 2

Copy and paste:

```text
docs/codex_goal_workbench/GOAL_COMMAND_2_LOCAL_SERVER.txt
```

Do not start UI until the server API is stable.

## 6. Then run Goal 3

Copy and paste:

```text
docs/codex_goal_workbench/GOAL_COMMAND_3_VISUAL_WORKBENCH_READONLY.txt
```

This is read-only UI only. No graph editing yet.

## 7. Completion check

For each goal, ask Codex:

```text
Run the required acceptance commands for the current phase. Report each command, exit code, and relevant output. Do not mark the goal complete if any command fails.
```

## 8. Mental model

Current MVP:

```text
Headless core
```

Next phase:

```text
Usability core -> local server -> read-only visual workbench
```

Future phase:

```text
GraphOps -> drag/edit workflow -> human-approved apply
```
