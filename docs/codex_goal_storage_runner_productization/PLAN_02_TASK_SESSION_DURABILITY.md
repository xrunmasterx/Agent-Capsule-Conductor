# Plan 02: Task and Session Durability

## Objective

Make Workbench tasks, canvas snapshots, assistant sessions, authoring sessions, and run-linked agent
sessions durable local resources with explicit ownership and retention metadata.

This plan removes product dependence on browser-local state and global unbounded session folders.

## Problem

Current state is split:

- Workbench UI has browser-local task state and Zustand projections.
- Server-side canvas snapshots are stored under `runs/_workbench_canvas_snapshots`.
- Agent sessions are stored under `runs/_agent_sessions`.
- Authoring sessions are stored under `runs/_authoring_sessions`.
- Run-bound execution sessions and long-lived Workbench assistant sessions are mixed by storage
  shape rather than by ownership.

This works for a local prototype, but it is fragile for:

- EXE upgrades;
- browser cache loss;
- long-term resource growth;
- export/import;
- future local runner/cloud control plane synchronization.

## Target distinction

Separate two session kinds:

```text
Run-bound execution sessions
  belong to a specific run/node
  stored inside runs/<run_id>/nodes/<node_id>/sessions/<session_id>/

Long-lived Workbench sessions
  belong to a task, canvas, authoring flow, or proposal
  stored under .acc/sessions/<session_id>/
```

Do not store Workbench assistant memory inside reusable templates. Templates remain stateless.

## Source-of-truth contracts

### Workbench task and canvas startup

- `.acc/tasks/<task_id>/task.json` is durable task truth.
- `.acc/tasks/<task_id>/canvas_snapshot.json` is durable canvas truth.
- Browser `localStorage` is only a cold-start cache and one-time migration source.
- Workbench startup must load `GET /api/workbench/tasks` first.
- If backend durable tasks exist, backend `updated_at` wins over browser cache.
- If backend tasks are empty and browser cache exists, the UI may perform a one-time migration that
  writes `.acc/tasks/*` through backend APIs.
- After migration, `localStorage` is not treated as durable authority.

### Task deletion

- `DELETE /api/workbench/tasks/{task_id}` writes a tombstone or `deleted_at`.
- Task deletion does not physically delete the task directory, sessions, or run evidence.
- The UI should refresh from server projection after delete instead of treating
  `tasks.filter(...)` as storage truth.

### Canvas persistence

Canvas snapshots store authoring state only. Before write, recursively strip runtime-only fields:

- `status`, `runId`, `sessionId`, `runtime`, `run`, `output`, `output_path`
- `event_log`, `stdout_log`, `stderr_log`, `logs`, `messages`
- `provider_session_id`, `threadId`
- `current_output_ref`, `published_output_ref`
- `ui.internal_nodes`, transient selection, execution overlays

`PUT /api/workbench/tasks/{task_id}/canvas` should use `base_canvas_hash` or `If-Match` so a stale
browser tab cannot overwrite a newer canvas silently.

## Storage layout

```text
.acc/
  tasks/
    <task_id>/
      task.json
      canvas_snapshot.json
      refs.json
      ui_projection.json
      retention.json

  sessions/
    <session_id>/
      session.json
      messages.jsonl
      turns/
        <turn_id>/
          turn.json
          events.jsonl
          output.json
      refs.json
      retention.json

runs/
  <run_id>/
    nodes/
      <node_id>/
        session_instance_manifest.json
        sessions/
          <session_id>/
            session.json
            messages.jsonl
            turns/
```

Existing folders such as `runs/_agent_sessions` can remain during migration, but new writes should
move to the ownership-based layout.

The canonical ACC execution evidence remains
`runs/<run_id>/nodes/<node_id>/session_instance_manifest.json`. Provider conversation state lives
under `nodes/<node_id>/sessions/<session_id>/` and is referenced by an opaque `agent_session_ref`
from runtime projection or manifests.

## Task model

Minimum task record:

```json
{
  "schema_version": "acc.workbench.task.v1",
  "task_id": "task_...",
  "title": "Untitled task",
  "canvas_ref": "task_canvas:<task_id>",
  "saved_workflow_ref": null,
  "active_run_id": null,
  "latest_run_id": null,
  "created_at": "...",
  "updated_at": "...",
  "retention": {
    "pinned": false,
    "retention_class": "normal"
  }
}
```

Minimum canvas snapshot:

```json
{
  "schema_version": "acc.workbench.canvas_snapshot.v2",
  "task_id": "task_...",
  "canvas_hash": "sha256:...",
  "canvas_snapshot": {},
  "selection": {},
  "temporary_resources": {},
  "published_at": "..."
}
```

Canvas snapshots must strip runtime-only status, output, and logs.

## APIs

Add or converge to task APIs:

```text
GET    /api/workbench/tasks
POST   /api/workbench/tasks
GET    /api/workbench/tasks/{task_id}
PUT    /api/workbench/tasks/{task_id}
DELETE /api/workbench/tasks/{task_id}
PUT    /api/workbench/tasks/{task_id}/canvas
GET    /api/workbench/tasks/{task_id}/canvas
```

Rules:

- deleting a task tombstones the task first;
- deleting a task does not physically delete associated runs unless explicitly requested;
- task deletion should offer policy choices later: detach runs, tombstone runs, or purge eligible runs;
- browser `localStorage` is allowed only as a cache or migration source.

## Session APIs

Keep existing assistant APIs where possible, but route storage through the new session store:

```text
POST /api/agent-sessions
GET  /api/agent-sessions/{session_id}
GET  /api/agent-sessions/{session_id}/messages
POST /api/agent-sessions/{session_id}/turns/submit
```

Rules:

- workbench assistant sessions must have `owner_ref = task:<task_id>`;
- run-node sessions must have `owner_ref = run_node:<run_id>/<node_id>`;
- every session must have retention metadata;
- session lookup must use the SQLite index, with filesystem rebuild fallback;
- provider session IDs are local-only and must be marked sensitive.
- default task/session list, export bundle, cloud sync, canvas snapshot, and run summary must not
  expose raw provider session ids;
- authenticated local debug APIs may expose raw provider ids only when explicitly requested.

## Migration strategy

1. Add new task/session storage without deleting old folders.
2. Add index rows for existing `_agent_sessions`, `_authoring_sessions`, and `_workbench_canvas_snapshots`.
3. Change new Workbench snapshots to write `.acc/tasks/<task_id>/canvas_snapshot.json`.
4. Change new Workbench assistant sessions to write `.acc/sessions/<session_id>/`.
5. Change run-bound agent sessions to write under `runs/<run_id>/nodes/<node_id>/sessions/`.
6. Keep read fallback for old folders until a migration command can rewrite or index them.
7. Provide `acc storage migrate-sessions --dry-run` and `--apply`.
8. If new `.acc/sessions/*` conflicts with legacy session data, the new object wins and
   `acc storage doctor` reports the legacy conflict.

Lookup order should be SQLite index, file/schema verification, targeted rebuild, then legacy
fallback. Normal task/session list paths should not glob the whole `runs/` tree.

## Acceptance criteria

- Refreshing the browser does not lose tasks.
- Clearing browser localStorage does not delete tasks or canvas snapshots.
- Task list is loaded from server/local runner durable storage.
- Workbench assistant session lookup does not scan every `runs/_agent_sessions/*/*/session.json`.
- A run-bound session can be exported with its run directory.
- A long-lived assistant session can be retained or GC'd independently from run evidence.
- Existing old-session fixtures still load through compatibility paths.

## Verification

Add tests for:

- task create/update/delete/tombstone;
- canvas snapshot strips runtime state;
- session owner metadata;
- session index rebuild;
- old folder compatibility;
- browser task persistence using the new API.
- server reload after clearing browser `localStorage`;
- one-time localStorage migration;
- stale `base_canvas_hash` or `If-Match` rejection;
- node-local session projection and legacy `_agent_sessions` fallback;
- provider session id redaction from task list, export, canvas, run summary, and cloud projection;
- active task-owned sessions and run-bound sessions protected from GC.
