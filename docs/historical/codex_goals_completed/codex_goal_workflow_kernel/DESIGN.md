# ACC Workflow Kernel Upgrade Design

## 1. Target architecture

```text
┌──────────────────────────────────────────────┐
│ Agent-callable Control Plane                  │
│ CLI / API / future MCP / GraphOps             │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ Visual Workbench                              │
│ Graph editor / run inspector / artifact view  │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ Workflow Kernel                               │
│ DAG levels / branch / failure / events        │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ Capsule Runtime                               │
│ Template / Session / Adapter / Artifact       │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ Mature Agent / Agent Workflow                 │
│ Codex / Claude / Cursor / Hermes / ACC subflow│
└──────────────────────────────────────────────┘
```

## 2. Core design principle

ACC must not become a Conductor clone. ACC borrows Conductor's useful workflow engineering ideas:

- semantic validation;
- deterministic routes;
- event logs;
- parallel/failure contracts;
- human gate concepts.

But ACC keeps its own domain model:

```text
Capsule Template -> Session -> Artifact Bundle
```

## 3. Workflow Kernel responsibilities

The Workflow Kernel owns:

- graph validation;
- topological level computation;
- deterministic scheduling;
- data mapping;
- failure policy;
- workflow event emission;
- workflow run manifest;
- nested ACC workflow execution.

It does not own:

- external mature agent reasoning;
- LLM tool loop;
- provider-specific session state;
- full production distributed scheduling.

## 4. WorkflowGraph v3

Recommended structure:

```json
{
  "id": "demo_level_parallel",
  "version": "0.3.0",
  "name": "Level Parallel Demo",
  "policy": {
    "failure_mode": "fail_fast",
    "max_concurrency": 3
  },
  "nodes": [
    {
      "id": "plan",
      "capsule_id": "echo-test.generic",
      "input": { "message": "plan" },
      "timeout_seconds": 60,
      "retry": { "max_attempts": 1 }
    }
  ],
  "control_edges": [
    { "id": "c1", "from": "plan", "to": "research_a" }
  ],
  "data_edges": [
    {
      "id": "d1",
      "from": { "node": "plan", "output": "summary" },
      "to": { "node": "research_a", "input": "message" }
    }
  ]
}
```

## 5. Execution model

1. Validate graph.
2. Compute topological levels from control edges.
3. For each level:
   - emit `workflow_level_started`;
   - materialize each ready node input from explicit input + data edges;
   - run nodes concurrently up to `max_concurrency`;
   - aggregate results;
   - apply failure policy;
   - emit `workflow_level_completed`.
4. Write summary and manifest.

## 6. Data mapping model

Data edges are explicit. A downstream node may consume:

- upstream `output.json` field;
- upstream artifact path by artifact name;
- static input value;
- workflow input.

The kernel must log input materialization.

## 7. Failure model

Node result contains:

```json
{
  "node_id": "research_a",
  "status": "success|failed|skipped|manual_review|timeout|schema_error|artifact_error",
  "output_path": "...",
  "artifact_dir": "...",
  "event_log": "...",
  "error": null
}
```

Workflow failure modes:

- `fail_fast`: stop on first failed node;
- `continue_on_error`: continue nodes whose dependencies succeeded or are allowed;
- `all_or_nothing`: if one node in a level/group fails, mark related siblings as failed/skipped;
- `manual_review`: stop and emit review-needed state.

## 8. Capsule kind design

`capsule.kind` is a new high-level category. Runtime still describes how to execute.

Examples:

```yaml
kind: agent_session
runtime:
  type: codex_cli
```

```yaml
kind: acc_workflow
workflow:
  type: acc_graph
  path: workflow.graph.json
```

```yaml
kind: external_workflow
workflow:
  type: conductor
  path: workflow.conductor.yaml
```

## 9. Event design

Events are append-only JSONL objects.

Every event should include:

```json
{
  "event_id": "uuid",
  "type": "node_started",
  "timestamp": "ISO-8601",
  "workflow_run_id": "...",
  "node_id": "...",
  "session_id": "...",
  "payload": {}
}
```

## 10. Conductor Bridge

Export ACC WorkflowGraph to Conductor YAML.

Each ACC node becomes a Conductor script step that calls:

```bash
uv run acc run <capsule_id> --input <generated-input.json> --run-dir <node-run-dir> --emit-conductor-json
```

The export must preserve:

- node order;
- control edges as routes;
- stdout contract;
- input materialization notes where possible.

## 11. GraphOps design

GraphOps must never directly mutate assets without validation.

Flow:

```text
patch schema validation
  -> policy validation
  -> dry-run materialization
  -> resulting graph/capsule semantic validation
  -> semantic diff report
  -> optional apply only with human approval
```

## 12. Server/UI integration

If the repository already has `acc/server` or `web`, add minimal endpoints/views:

- list workflow events;
- replay events;
- show node status from workflow summary;
- show Conductor export preview.

Do not do a full UI redesign in this goal.
