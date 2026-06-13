# Plan 04: Failure Recovery and Session Health

## Goal

Turn failed assistant turns into clear, recoverable user experience while protecting later turns from
poisoned provider/session state.

This plan productizes failure semantics. It should run after Plan 02 makes ordinary chat independent
from authoring JSON and after Plan 03 gives failed events a stable projection path.

## Problem

Current state uses broad statuses such as `failed`, but it does not clearly encode:

- what kind of failure happened;
- which layer produced the failure;
- whether the user can keep typing;
- whether the same provider session can be reused;
- whether the next structured turn should start fresh;
- what concise user-facing explanation should appear in the transcript.

The highest-risk current path is structured output validation after the adapter has already returned a
provider session id. If the provider thread produced bad structured output, blindly resuming that
thread can poison the next structured authoring turn.

## Failure Metadata Schema

Each failed turn should persist structured metadata:

```json
{
  "status": "failed",
  "failure_kind": "invalid_authoring_output",
  "failure_origin": "acc_authoring_validation",
  "failed_stage": "post_provider_result_validation",
  "recoverability": "retry_allowed",
  "provider_session_policy": "clear_before_next_structured_turn",
  "provider_session_health": "poisoned_for_structured_output",
  "can_submit_next_turn": true,
  "user_summary": "结构化修改草稿无效，已保留对话，可以继续输入。",
  "technical_detail": "Authoring agent output confidence must be a string",
  "raw_error_ref": "events.jsonl#event_id",
  "failed_at": "2026-06-13T00:00:00Z",
  "previous_provider_session_id": "thread_old",
  "next_provider_session_id": null
}
```

Field meanings:

- `failure_kind`: user/product-level class.
- `failure_origin`: layer that produced the failure, such as `provider_transport`,
  `provider_protocol`, `acc_authoring_validation`, `graphops_validation`, or `user_cancel`.
- `failed_stage`: where in the turn lifecycle it failed.
- `recoverability`: user next-step class, such as `continue_allowed`, `retry_allowed`,
  `user_action_required`, or `blocked`.
- `provider_session_policy`: whether and when to reuse provider thread state.
- `provider_session_health`: whether the provider thread is trusted for later structured work.
- `can_submit_next_turn`: explicit UI contract; `session.status=failed` alone must not mean blocked.
- `user_summary`: short localized message for the transcript.
- `technical_detail`: raw-ish diagnostic detail for disclosure only.
- `raw_error_ref`: pointer to durable evidence, not a full stack trace in primary UI.

## Classification Table

| Failure example | Origin/stage | `failure_kind` | `recoverability` | Provider session policy |
| --- | --- | --- | --- | --- |
| invalid `acc.authoring.output.v1` in modification turn | `acc_authoring_validation` / post-provider validation | `invalid_authoring_output` | `retry_allowed` | `clear_before_next_structured_turn` |
| structured node output schema failure | `acc_output_validation` / post-provider validation | `validation_failed` | `retry_allowed` | `clear_before_next_structured_turn` |
| GraphOps validation or dry-run failed | `graphops_validation` | `validation_failed` | `user_action_required` | `reuse_allowed` |
| provider timeout after turn/thread started | `provider_transport` | `timeout` | `retry_allowed` | `clear_before_next_turn` or `clear_immediately` |
| user cancellation after provider turn started | `user_cancel` / provider state unknown | `cancelled` | `continue_allowed` | `clear_before_next_structured_turn` unless provider terminal cancel is confirmed |
| transport/process crash after thread id exists | `provider_transport` | `transport_error` | `retry_allowed` | `clear_immediately` |
| bad/expired provider session resumed and fallback starts fresh | `provider_protocol` | `provider_error` | `continue_allowed` | `fresh_session_started`; emit recovery event |
| stale `expected_provider_session_id` | pre-turn stale pointer check | `stale_provider_session` | `user_action_required` or refresh-and-retry | do not create turn; do not change health |
| auth missing / rate limit / runtime offline | provider/infrastructure | `provider_error` | `user_action_required` or `retry_allowed` | usually `reuse_allowed` if no provider turn started |
| permission denied / human approval denied | policy/human gate | `permission_denied` | `user_action_required` | usually `reuse_allowed` |

Suggested `failure_kind` values:

- `provider_error`
- `invalid_authoring_output`
- `validation_failed`
- `timeout`
- `cancelled`
- `permission_denied`
- `transport_error`
- `stale_provider_session`
- `unknown`

Suggested `provider_session_policy` values:

- `reuse_allowed`
- `reuse_for_chat_only`
- `clear_before_next_structured_turn`
- `clear_before_next_turn`
- `clear_immediately`
- `fresh_session_started`

Suggested `provider_session_health` values:

- `healthy`
- `unknown`
- `poisoned`
- `poisoned_for_structured_output`

## Reason-aware Semantics

Failure classification must receive the turn `reason`.

- After Plan 02, `invalid_authoring_output` should not occur for ordinary `workbench_chat`. If it
  does, the route/response mode is wrong.
- `canvas_revision` and `selected_node_revision` are structured authoring turns; invalid envelopes
  are real authoring failures.
- GraphOps failures are governance results, not provider thread poisoning by default.

## Required Backend Changes

### 1. Classify All Turn Failure Paths

Cover at least these paths:

- adapter directly returns failed/timeout/cancelled;
- adapter succeeds but ACC authoring/output validation raises;
- background task exception enters the task manager failure path;
- stale provider session pointer rejection before turn creation.

Add a narrow classifier near turn failure handling:

```python
def classify_agent_turn_failure(error: str, *, reason: str, stage: str, provider_session_id: str | None) -> dict[str, Any]:
    ...
```

### 2. Persist Failure Metadata

Store failure metadata in:

- turn manifest (`turn.json`);
- `agent_turn_failed` payload;
- session manifest (`session.json`) summary fields.

Do not change canonical status names (`success`, `failed`, `cancelled`, `crashed`).

If an adapter already wrote a raw `agent_turn_failed`, avoid duplicate visible failures. Either enrich
the terminal failure event or emit a separate metadata event with hidden/folded projection.

### 3. Session Health Contract

Add or derive session-level fields:

- `last_failure_kind`
- `last_recoverability`
- `provider_session_health`
- `provider_session_policy`

Rules:

- `session.status=failed` means the last turn failed; it does not mean the ACC session is
  unsubmittable.
- Successful fresh session after a poisoned state should clear or downgrade `last_failure_kind` and
  health fields.
- Structured output failures should not blindly reuse the old provider session for the next
  structured turn.
- Fresh provider session means clearing/ignoring `provider_session_id` before adapter `thread/start`;
  it does not require creating a new ACC session.
- ACC `messages.jsonl` remains the visible conversation continuity source.

### 4. User-facing Failure Message

Append or expose concise user-facing text such as:

```text
本轮结构化输出无效，已保留对话。你可以继续输入；如果要修改画布，我会重新生成草稿。
```

Raw detail remains attached to the error event or technical details.

### 5. Event Projection Integration

Plan 03 projection should render:

- `agent_turn_failed.projection.visibility = "primary"`;
- `category = "error"`;
- `severity = "error"`;
- `summary = user_summary`.

`technical_detail` and raw error stay outside the primary transcript.

## Required Frontend Changes

- Render failure messages as assistant failure bubbles, not generic system log spam.
- Show short status such as `可继续 · 上轮失败`.
- Use `can_submit_next_turn` / `recoverability` when available; fall back to existing status logic for
  old evidence.
- Add expandable raw detail for failure events.
- Do not disable composer after terminal failed state when no turn is running.
- If recoverability implies fresh structured session, explain that the next modification turn will use
  a clean provider context once implemented.

## Expected Files

Backend:

- `acc/app/agent_sessions.py`
- `acc/agent_events.py`
- `acc/server/live_events.py` if failure projection is transported there
- tests under `tests/server/`

Frontend:

- `web/src/components/WorkflowViewer.tsx`
- `web/src/App.test.tsx`

## Tests

Backend:

- invalid authoring output in modification turn produces
  `failure_kind=invalid_authoring_output`.
- ordinary `workbench_chat` natural text never produces `invalid_authoring_output`.
- provider timeout, transport crash, cancel, bad provider session, permission denied, stale expected
  provider id, GraphOps validation failure, and auth/rate limit classify distinctly.
- failed turn persists failure metadata in `turn.json`.
- `agent_turn_failed` payload includes structured failure metadata while remaining backward
  compatible with old `error` readers.
- duplicate failure events are not shown when adapter and service both see the failure.
- after invalid structured authoring output, next structured turn starts fresh or explicitly avoids
  unsafe provider session reuse.
- `session.status=failed` does not block next `workbench_chat`.
- stale `expected_provider_session_id` creates no turn, appends no user message, and does not poison
  session health.

Frontend:

- failure bubble defaults to `user_summary`, not raw backend detail.
- raw detail is available only in disclosure/technical details.
- status chip uses recoverability when available and shows `可继续 · 上轮失败` for continue-allowed
  failed state.
- composer remains enabled after terminal failure.
- projection is honored first; old raw `agent_turn_failed` falls back to Plan 01 behavior.
- Chinese user-visible strings are valid UTF-8 and snapshots/tests must not contain mojibake.

## Acceptance

- A user understands whether they can continue after a failure.
- Raw backend errors no longer dominate the default transcript.
- Future structured turns do not repeatedly reuse a known-bad structured-output provider context.
- Ordinary chat remains recoverable even after authoring failure.

## Risks

- Fresh provider session may lose provider-side conversation context.
- Too many failure enums can become inconsistent if not tested.
- UI can overpromise recovery if backend does not actually clear unsafe provider state.

Mitigation:

- Preserve conversation continuity in ACC `messages.jsonl`.
- Keep the classifier small and table-driven.
- Add provider session reuse tests before enabling automatic fresh-session behavior.
