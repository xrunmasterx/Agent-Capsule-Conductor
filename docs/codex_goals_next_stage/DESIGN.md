# ACC Next Stage Design

## 1. Architecture

```text
Browser Workbench / Higher-level Agent
        |
        v
Control Plane / Browser E2E / GraphOps
        |
        v
Workflow Kernel + Debugger + Replay
        |
        v
Capsule Runtime
        |
        v
External Agent / Agent Workflow
```

## 2. Key principle

ACC must remain a composition system, not a new agent framework.

The architecture should keep these boundaries:

```text
Workbench:
  visual authoring, inspection, browser validation

Control Plane:
  stable machine-readable commands/tools for agents

Workflow Kernel:
  scheduling, dependencies, failure policy, replay metadata

Capsule Runtime:
  template/session/artifact boundary

External Agents:
  Codex, Claude, Cursor, Hermes, external workflows
```

## 3. Debugger / Replay design

### 3.1 Event replay

Read event logs and manifests to reconstruct workflow state.

Inputs:

```text
workflow_run_manifest.json
workflow_events.jsonl
node events.jsonl
node_summary.json
```

Output:

```json
{
  "status": "success",
  "nodes": [],
  "timeline": [],
  "errors": []
}
```

### 3.2 Rerun node

Rerun only one node with preserved upstream artifacts.

### 3.3 Rerun from node

Rerun selected node and downstream consumers.

### 3.4 Fork

Create a new run lineage with input/prompt/schema override.

### 3.5 Diff

Compare two runs or artifacts.

## 4. Workflow Capsule design

### 4.1 Capsule kinds

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

### 4.2 behavior_pack

A behavior pack is a directory of prebuilt agent workflow assets:

```text
AGENTS.md
CLAUDE.md
skills/
hooks/
prompts/
scripts/
config/
```

### 4.3 lifecycle

Lifecycle stages:

```text
setup
run
collect
cleanup
```

Each stage must be timeout-limited and logged.

### 4.4 materialized snapshot

Every workflow capsule run must snapshot its template and behavior pack for reproducibility.

## 5. Agent-callable control plane design

### 5.1 Stable JSON CLI

All agent-facing commands must support `--json` or `--emit-json`.

### 5.2 Optional MCP

MCP is optional but recommended if dependency constraints are manageable.

### 5.3 Safety

Default control-plane operations must be non-destructive.

## 6. Browser E2E design

### 6.1 Browser journeys

Browser tests must verify real usage, not just component rendering.

### 6.2 Evidence capture

Every browser E2E run should produce:

```text
browser_e2e_report.json
screenshots/
console.log
network.log
```

### 6.3 Optimization loop

Failure -> diagnose -> patch -> rerun journey -> record result.

## 7. Integration with existing ACC

Do not rewrite existing modules. Extend:

```text
acc.workflow
acc.events
acc.debugger
acc.capsule_kinds
acc.control
acc.browser_e2e
```

Exact module names may adapt to the existing repo, but the separation of responsibilities must remain.
