# How to use this package with Codex `/goal`

## 1. Do not replace old docs

Keep:

```text
docs/codex_goal/
docs/codex_goal_workbench/
```

Add:

```text
docs/codex_goal_editable_workbench/
```

## 2. Prepare repository

```bash
unzip agent_capsule_editable_workbench_goal_package.zip
cp -r agent_capsule_editable_workbench_goal_package/docs/codex_goal_editable_workbench docs/
cp -r agent_capsule_editable_workbench_goal_package/schemas/* schemas/
cp -r agent_capsule_editable_workbench_goal_package/examples/* examples/
cat agent_capsule_editable_workbench_goal_package/AGENTS_PHASE3_APPEND.md >> AGENTS.md
```

Commit current baseline first:

```bash
git status
git add .
git commit -m "chore: complete workbench baseline before editable MVP"
```

## 3. Ask for plan first

In Codex:

```text
/plan Read AGENTS.md, docs/codex_goal/ACCEPTANCE.md, docs/codex_goal_workbench/*.md, and docs/codex_goal_editable_workbench/*.md. Produce a concise implementation plan for the Editable Workbench MVP only. Do not implement yet.
```

Reject plans that propose:

```text
rewriting acc run
rewriting adapters
building a full Dify clone
adding database persistence
AI auto-applying graph edits
requiring real Codex/Claude credentials in default tests
```

## 4. Set goal

Copy:

```text
docs/codex_goal_editable_workbench/GOAL_COMMAND.txt
```

Paste into Codex.

## 5. During the run

Use short steering messages:

```text
Stay on Milestone 2. Do not start UI until capsule scaffold tests pass.
```

```text
Keep the graph runner deterministic: no loops, no LLM routing, no retries.
```

```text
Default tests must remain hermetic. Move real external calls behind optional env flags.
```

## 6. Completion check

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goal_editable_workbench/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark the goal complete if any command fails.
```

## 7. Expected final user path

After completion, you should be able to:

```text
1. Start local server.
2. Open web workbench.
3. Create capsule from form.
4. Edit prompt/schema.
5. Validate capsule.
6. Add capsule to workflow canvas.
7. Connect two nodes.
8. Save graph.
9. Run graph.
10. Inspect node output/artifacts/logs.
```
