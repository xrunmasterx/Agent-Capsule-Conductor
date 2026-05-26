# ACC Next Stage Roadmap

## Current baseline

ACC has already implemented the core MVP, Workbench layers, Graph Workbench, and Workflow Kernel. The next stage must improve usefulness, debuggability, reuse, and browser-validated UX.

## Final target

ACC should become:

```text
A lightweight, pluggable, nested, observable Agent Workflow orchestration layer.
```

It must allow:

1. Human-authored Capsules and Workflows.
2. Existing Codex / Claude / Cursor / Hermes workflows to be wrapped as reusable Capsules.
3. ACC workflows to be nested as Capsules.
4. Higher-level agents to call ACC safely.
5. Humans to inspect every intermediate artifact and optimize nodes manually.
6. Browser automation to continuously test and improve the real UI.

## Goals

### Goal 1: Workflow Debugger & Replay

Make complex workflow runs debuggable:

- event replay
- node rerun
- rerun from node
- fork run
- run diff
- artifact diff
- prompt diff
- inspector API / UI hooks

### Goal 2: Workflow Capsule & Agent Workflow Adapter

Make existing agent workflows reusable:

- `kind=agent_workflow`
- `kind=acc_workflow`
- `kind=external_workflow`
- behavior packs
- lifecycle hooks
- materialized snapshots
- nested workflow capsules

### Goal 3: Agent-callable ACC Control Plane

Make ACC callable by Codex / Claude / other agents:

- stable JSON CLI
- optional MCP server
- control-plane tools
- safe GraphOps proposal/dry-run/approval boundaries

### Goal 4: Browser E2E UX Optimization

Make the system genuinely usable in the browser:

- Chinese-first UI verification
- mouse/keyboard journeys
- create capsule
- connect graph nodes
- run workflow
- inspect artifacts
- inspect parallel workflow
- record screenshots / console errors / network failures
- fix and retest loop

## What not to do

- Do not rewrite `acc run`.
- Do not rewrite the Workflow Kernel from scratch.
- Do not implement a new LLM tool-calling loop.
- Do not make default tests depend on real Codex / Claude / Hermes.
- Do not auto-apply destructive GraphOps patches.
- Do not hide failures behind narrative summaries.
