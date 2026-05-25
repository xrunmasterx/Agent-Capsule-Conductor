# Event-driven Observability Spec

## 1. Purpose

ACC currently stores files and manifests. This phase adds a unified event contract so CLI, API, and Workbench can reconstruct execution state from events.

## 2. Event object

```json
{
  "event_id": "uuid",
  "type": "node_started",
  "timestamp": "2026-05-25T00:00:00Z",
  "workflow_run_id": "run_x",
  "node_id": "source_check",
  "session_id": "session_y",
  "level": 1,
  "status": "running",
  "payload": {}
}
```

## 3. Required workflow events

```text
workflow_started
workflow_level_started
node_scheduled
node_started
node_completed
node_failed
workflow_level_completed
workflow_completed
workflow_failed
manual_review_requested
```

## 4. Required session events

```text
session_started
input_materialized
input_written
prompt_rendered
workspace_prepared
adapter_started
adapter_event
stdout_captured
stderr_captured
output_written
output_validated
artifact_validated
session_completed
session_failed
```

## 5. Files

Workflow event log:

```text
workflow_events.jsonl
```

Node/session event log:

```text
node_runs/<node_id>/events.jsonl
```

## 6. Commands

```bash
acc workflow events <run_dir> --json
acc inspect <session_run_dir> --events --json
```

## 7. API integration if server exists

Recommended endpoints:

```text
GET /api/runs/{run_id}/events
GET /api/runs/{run_id}/nodes/{node_id}/events
```

## 8. Test requirements

Tests must verify:

- event files exist;
- required event types appear in order;
- failed node emits `node_failed` and `workflow_failed` or policy-specific continuation events;
- events are valid JSONL;
- events are replayable into run summary.
