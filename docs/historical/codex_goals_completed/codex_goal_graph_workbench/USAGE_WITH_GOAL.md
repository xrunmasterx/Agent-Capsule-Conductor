# How to use this package with Codex `/goal`

## 1. Copy files

From repo root:

```bash
cp -r agent_capsule_graph_workbench_goal_package/docs/codex_goal_graph_workbench docs/
cp -r agent_capsule_graph_workbench_goal_package/schemas/* schemas/
cp -r agent_capsule_graph_workbench_goal_package/examples/* examples/
cat agent_capsule_graph_workbench_goal_package/AGENTS_PHASE4_APPEND.md >> AGENTS.md
```

## 2. Ask for plan first

```text
/plan Read AGENTS.md, docs/codex_goal/ACCEPTANCE.md, docs/codex_goal_workbench/*.md, docs/codex_goal_editable_workbench/*.md if present, and docs/codex_goal_graph_workbench/*.md. Produce a concise implementation plan for Graph Workbench only. Do not implement yet.
```

Reject the plan if it proposes:

- rewriting `acc run`,
- rewriting adapters,
- building a Dify clone,
- adding real external-agent dependency to default tests,
- skipping Chinese UI,
- continuing with button-only node sequencing,
- implementing AI auto-apply graph mutation.

## 3. Set goal

Copy `GOAL_COMMAND.txt` and paste it into Codex.

## 4. During implementation

Useful steering messages:

```text
Focus on graph canvas and node edges. Button-only sequencing is not acceptable.
```

```text
Keep UI Chinese-first. Add i18n keys instead of hard-coded English labels.
```

```text
Do not rewrite runtime. Graph runner must call existing capsule runner.
```

```text
Default tests must remain hermetic.
```

## 5. Acceptance

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goal_graph_workbench/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark the goal complete if any command fails.
```
