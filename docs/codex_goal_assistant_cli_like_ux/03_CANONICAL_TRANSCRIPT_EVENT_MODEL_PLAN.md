# Plan 03: Canonical Transcript Event Model

## Goal

Make transcript visibility and event semantics explicit in backend evidence/read models so frontend
projection no longer relies on ad hoc event type filtering.

This plan does not change chat semantics; it gives the UI a stable way to decide which evidence is
primary conversation, folded process, technical detail, or hidden status.

## Layering Contract

ACC must keep four layers separate:

```text
Fact event
  Append-only evidence in events.jsonl. It records what happened.

Transcript projection
  Deterministic display hint derived from the fact event. It is not the business fact itself.

Live event
  SSE transport envelope with stream-local seq for reconnect/replay.

UI transcript item
  Frontend render model. It is never persisted as evidence.
```

This mirrors the useful Multica boundary: durable task/turn evidence exists independently from the
user-facing chat timeline.

## Current Problem

The frontend currently infers visibility from event types and payload quirks such as:

- `agent_status`
- `agent_output_draft`
- `agent_turn_failed`
- `agent_tool_use`
- `agent_tool_result`
- generic `agent_event` with `payload.event_type`

There is also more than one projection path:

- assistant transcript projection in `web/src/components/WorkflowViewer.tsx`;
- run transcript projection in `web/src/lib/runTranscript.ts`;
- backend live event conversion in `acc/server/live_events.py`;
- run projection compatibility logic in `acc/app/run_events.py` and route-level helpers.

Without one shared policy, a provider status event can be hidden in the assistant panel but appear in
another transcript surface.

## Projection Schema

Use a top-level `projection` object, not a nested payload field:

```json
{
  "schema_version": "acc.agent_event.v1",
  "event_seq": 12,
  "type": "agent_tool_use",
  "payload": {},
  "projection": {
    "schema_version": "acc.transcript_projection.v1",
    "visibility": "folded",
    "category": "tool",
    "severity": "info",
    "display_kind": "tool_call",
    "summary": "exec_command",
    "source": "computed"
  }
}
```

Projection fields:

- `schema_version`: currently `acc.transcript_projection.v1`.
- `visibility`: `primary | folded | technical | hidden`.
- `category`: `assistant_text | tool | approval | proposal | artifact | status | error | usage |
  provider | decision`.
- `severity`: `info | warning | error`.
- `display_kind`: stable semantic display kind such as `assistant_text`, `tool_call`,
  `tool_result`, `status_pill`, `error_message`, `artifact_link`.
- `summary`: short sanitized summary only; not a second raw payload.
- `source`: `authored | computed | computed_legacy`.
- optional `requires_action`: true for approvals or user decision points.

Do not persist localized UI labels such as `title: "Running command"` as canonical facts. Prefer
`display_kind` or `label_key`; frontend i18n owns user-visible Chinese/English copy.

## Event Sequencing

Add a durable `event_seq` to new agent events.

Rules:

- `event_seq` is scoped to `session_id + turn_id`.
- It is not the same as `WorkbenchLiveEvent.seq`.
- `WorkbenchLiveEvent.seq` remains the stream-local reconnect cursor.
- Live events may copy top-level `event_seq` for ordering/debugging.
- Old events without `event_seq` are ordered by file line order when available, then timestamp and
  stable fallback index.

## Event Policy Matrix

| Event type | Visibility | Category | Notes |
| --- | --- | --- | --- |
| `agent_turn_started` | `hidden` | `status` | runtime fact, not transcript row |
| `agent_status` | `technical` or `hidden` | `status` / `provider` | never raw provider spam in primary transcript |
| `agent_message` | `primary` | `assistant_text` | final text |
| `agent_message_delta` | `primary` | `assistant_text` | streaming text; merge by `turn_id` + item id |
| `agent_tool_use` | `folded` | `tool` | compact row |
| `agent_tool_result` | `folded` | `tool` | compact row |
| `agent_approval_requested` | `folded` or `primary` | `approval` | `requires_action=true` |
| `agent_usage` | `technical` | `usage` | hidden by default |
| `agent_output_draft` | `technical` by default | `proposal` / `artifact` | folded only when proposal-ready |
| `agent_output_published` | `folded` | `artifact` | no raw path in primary text |
| `agent_turn_completed` | `hidden` | `status` | status state only |
| `agent_turn_failed` | `primary` | `error` | `severity=error` |
| `agent_turn_cancelled` | `primary` or `hidden` | `status` / `error` | policy depends on user-visible cancel reason |

Future supervisor/GraphOps decision events should use `category=decision`, including explicit
`no_action` decisions. The goal is explainability: the user should be able to inspect why the agent
did or did not proceed.

## Required Backend Changes

### 1. Define One Projection Helper

Add a canonical helper near event creation, for example in `acc/agent_events.py`:

```python
def project_agent_event(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    ...
```

Rules:

- produce the projection schema above;
- keep raw provider/domain payload separate;
- sanitize and truncate `summary`;
- preserve tool/message correlation keys such as `item_id`, `message_id`, `tool_call_id`, or
  `parent_event_id` when present;
- never put prompt previews, stack traces, or full provider frames in `summary`.

### 2. Persist Projection Metadata for New Events

Extend `append_agent_event()` to write:

- `event_seq`;
- top-level `projection`.

Add fields only; do not remove or rename existing event fields.

### 3. Legacy Fallback Algorithm

Readers must support old evidence:

```text
If event.projection exists and schema_version is supported, use it.
Else compute projection from event.type + payload using legacy mapping.
Mark the returned projection as source = computed_legacy.
Never rewrite old events.jsonl during read.
```

This fallback should exist in the backend API/live read model, not only in React.

### 4. SSE Transport Rule

- `WorkbenchLiveEvent.projection` is top-level.
- `payload` remains the original event payload.
- `WorkbenchLiveEvent.seq` is stream-local replay cursor.
- `event_seq`, if present, is copied from durable event and used only for ordering/debugging.
- Prefer `live_event` as the semantic stream consumed by UI. Raw `agent_event` SSE frames can remain
  for compatibility/debugging.

### 5. Preserve Projection Through Run/Node Views

- `RunEventProjectionService.project_agent_event()` may add identity fields such as `run_id`,
  `node_id`, `ui_node_id`, `parent_node_id`, or `node_run_dir`.
- It must preserve existing `projection`.
- Route-level compatibility projection must be consolidated or kept behaviorally identical.
- Nested workflow projection must preserve `projection` while adding nested identity.

## Required Frontend Changes

- `WorkbenchLiveEvent` and `RunEvent` types include optional top-level `projection` and `event_seq`.
- `assistantTranscriptItemFromLiveEvent()` reads `projection.visibility` first and falls back to old
  type mapping only when missing/unsupported.
- `buildAccTranscript()` in `web/src/lib/runTranscript.ts` must use the same policy.
- Technical events remain accessible in technical details/raw event views.
- Folded tool/proposal/artifact rows must not merge into assistant text.
- `agent_message_delta` aggregation must not cross `turn_id` or provider item/message id.

No new frontend event-type allowlist should be added without extending backend projection tests.

## Expected Files

Backend:

- `acc/agent_events.py`
- `acc/server/live_events.py`
- `acc/app/run_events.py`
- `acc/server/routes/runs.py` if route-level compatibility remains
- `acc/adapters/codex_app_server.py` only where event payload metadata/correlation is produced
- tests under `tests/server/` and `tests/unit/`

Frontend:

- `web/src/types.ts`
- `web/src/components/WorkflowViewer.tsx`
- `web/src/lib/runTranscript.ts`
- `web/src/lib/runTranscript.test.ts`
- `web/src/App.test.tsx`

## Tests

Backend:

- `append_agent_event("agent_message_delta", ...)` writes primary assistant text projection and
  preserves item/message correlation.
- `agent_status` and `agent_usage` project as technical/hidden and do not leak raw provider frames.
- `agent_approval_requested` is visible/actionable, not technical-only.
- `agent_output_draft` is technical by default; proposal-ready draft can be folded/proposal.
- `agent_turn_failed` is `primary + category=error + severity=error`.
- `agent_turn_cancelled` policy is explicit.
- `live_event_from_agent_event()` preserves top-level `projection`.
- Missing projection old fixtures receive `computed_legacy` projection in API/live responses.
- `/api/agent-sessions/{session}/turns/{turn}/stream` replay and tail preserve projection.
- `/api/runs/{run}/stream` preserves projection through run/node identity projection.
- Same-timestamp events order by `event_seq`; old events fall back deterministically.

Frontend:

- types accept optional `projection`.
- assistant transcript and run transcript prioritize projection over type mapping.
- technical events remain hidden by default but visible in technical details.
- old events missing projection still follow current fallback behavior.
- folded tool/proposal/artifact rows render compactly.

## Acceptance

- Adding a new provider status event cannot place raw provider data in the default chat.
- The visible transcript policy is documented, versioned, and testable.
- Assistant transcript and run transcript use the same visibility semantics.
- Old `events.jsonl` files remain readable without rewrite.

## Risks

- Persisting new fields into `events.jsonl` changes evidence shape.
- Overpersisting UI text can pollute audit evidence.
- Sequence fields can be confused with SSE reconnect cursors.

Mitigation:

- Add fields only and keep readers permissive.
- Persist semantic display hints, not localized labels.
- Name durable order `event_seq`; keep SSE cursor as `seq`.
