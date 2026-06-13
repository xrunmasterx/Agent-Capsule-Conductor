# Test Plan

## Backend Commands

Run after backend-facing plans:

```powershell
cd F:\Agent-Capsule-Conductor-v2
uv run pytest -q tests/server/test_agent_sessions_api.py tests/unit/test_codex_app_server_adapter.py
uv run pytest -q tests/unit/test_authoring_service.py
```

Run projection-specific tests after Plan 03:

```powershell
cd F:\Agent-Capsule-Conductor-v2
uv run pytest -q tests/server/test_run_log_projection_api.py tests/server/test_runs_projection_api.py
```

Run broader backend validation before final merge:

```powershell
cd F:\Agent-Capsule-Conductor-v2
uv run pytest -q
```

If the local `python` environment lacks server dependencies, use `uv run`.

## Frontend Commands

Run after every frontend-facing plan:

```powershell
cd F:\Agent-Capsule-Conductor-v2\web
npx tsc --noEmit
npm run test -- src/App.test.tsx
npm run build
```

If `web/src/lib/runTranscript.ts` changes:

```powershell
cd F:\Agent-Capsule-Conductor-v2\web
npm run test -- src/lib/runTranscript.test.ts
```

## Plan-specific Test Matrix

| Plan | Main risk | Required tests |
| --- | --- | --- |
| 01 Frontend projection | transcript ordering/noise regressions | ordering, optimistic merge, hidden technical events, visible failure, composer enabled after failure |
| 02 Chat decoupling | chat still requires JSON or authoring validation weakens | chat text-only success, JSON-in-chat ignored, modification no-JSON fails, authoring invalid schema still fails, GraphOps negative |
| 03 Event model | new event shape breaks old evidence readers or transcript surfaces diverge | projection metadata tests, old-event fallback, SSE preservation, run transcript + assistant transcript share policy |
| 04 Failure recovery | failure blocks future turns or reuses poisoned provider context | failure classifier, failure metadata persistence, duplicate failure prevention, next-turn submit, provider session policy |
| 05 UX polish | visual/layout/accessibility regression | browser QA matrix, composer visibility, no overlap, keyboard/IME, folded middle/final answer behavior |

## Required Detailed Tests

### Plan 01

- Optimistic no-timestamp user message appears at bottom and server refresh does not duplicate it.
- `agent_event` with `payload.event_type=agent_turn_failed` renders an error.
- `agent_event` with `payload.event_type=agent_output_draft` is hidden.
- `agent_output_published` and output path rows are hidden by default.
- `terminal`, generic `agent_status`, and `agent_usage` are hidden by default.
- Streaming updates keep bottom only when pinned; user upscroll is respected.
- Proposal/validation blocks do not pin stale content below newer messages.

### Plan 02

- `workbench_chat` pure text succeeds with assistant message and no draft/current output.
- `workbench_chat` fenced JSON or valid-looking authoring JSON remains text; no draft, no
  validation, no `current_output_turn_id`.
- `canvas_revision` / `selected_node_revision` pure text fails.
- Invalid authoring metadata tests use modification reasons, not `workbench_chat`.
- Adapter request mode is reason-aware.
- `agent_output_draft` event appears only in structured mode.
- Ordinary chat after failed authoring turn succeeds.
- Chat text containing GraphOps-like JSON creates no GraphOps proposal.

### Plan 03

- `append_agent_event()` writes `projection.schema_version` and `event_seq`.
- `agent_message_delta` is primary assistant text and preserves item/message correlation.
- `agent_status`, provider frames, and usage are technical/hidden and sanitized.
- `agent_approval_requested` is visible/actionable.
- `agent_output_draft` is technical by default and folded/proposal only when proposal-ready.
- `agent_turn_failed` is primary error.
- Old fixtures missing projection get `source=computed_legacy` without rewriting files.
- `live_event_from_agent_event()` preserves top-level projection.
- Run/node projection preserves projection while adding identity fields.
- `WorkbenchLiveEvent.seq` remains stream cursor; `event_seq` is durable ordering/debugging.

### Plan 04

- Classifier covers invalid authoring output, GraphOps validation, provider timeout, cancel,
  transport crash, bad provider session, permission denied, stale expected provider id, auth/rate
  limit.
- Failed turn persists metadata in `turn.json`.
- `agent_turn_failed` payload includes structured metadata while old `error` fallback remains.
- Adapter/service duplicate failure events are not double-rendered.
- Invalid structured authoring output prevents blind provider session reuse for next structured turn.
- `session.status=failed` remains submit-capable when `can_submit_next_turn=true`.
- Stale `expected_provider_session_id` creates no turn and does not poison session health.
- Chinese failure copy is UTF-8 and snapshots/tests contain no mojibake.

### Plan 05

- Live stream and persisted assistant message do not duplicate.
- Folded middle/final answer rule works for completed tool turns.
- `Enter`, `Shift+Enter`, and IME composition behave correctly.
- `跳到底部` appears when user has scrolled up and new content arrives.
- Failure alert announces summary without stack trace.
- Proposal actions remain attached to proposal block and call existing GraphOps handlers.

## Manual QA Scenarios

Use `http://localhost:5173/?dev=true`.

### Empty Session

- Open AI assistant.
- Expected:
  - composer visible;
  - no stale `output_draft.json` rows;
  - status is `连接中...` only while creating/restoring the session, then ready/usable.

### Ordinary Chat

- Send `你好`.
- Expected:
  - user message appears immediately at the bottom;
  - assistant answer appears below it;
  - no `acc.authoring.output.v1` JSON shown;
  - no `confidence/questions/risk_notes` failure;
  - no provider prompt preview.

### Chat With JSON Example

- Ask the assistant to show a JSON example.
- Expected:
  - JSON appears as assistant text;
  - no draft is created;
  - no proposal block appears.

### Structured Modification

- Switch to modification mode.
- Ask for a small canvas change.
- Expected:
  - proposal/result block appears;
  - validation result is visible;
  - apply/discard controls still work;
  - no direct durable mutation without approval.

### Failed Structured Output

- Force or mock invalid authoring output.
- Expected:
  - readable failure bubble;
  - raw technical detail expandable;
  - composer remains usable;
  - next ordinary chat succeeds;
  - next structured turn uses the configured provider session safety policy.

### Provider/Tool Events

- Trigger a turn with tool use.
- Expected:
  - compact folded tool rows;
  - no raw provider item spam;
  - technical details still expose enough evidence for debugging.

### Responsive and Accessibility Checks

- Verify 1920x1080, 1366x768, 1280x720, 1024x768, and 125% zoom.
- Composer must stay visible.
- Buttons and chips must not overlap.
- Keyboard path must reach mode, textarea, submit, proposal actions, details.

## Acceptance Definition

The whole refactor is accepted only if:

- ordinary chat is natural and does not require structured authoring JSON;
- modification requests still use governed authoring/GraphOps path;
- technical transcript is available but not default primary conversation;
- failures are understandable and recoverable;
- provider session reuse is safe for structured output after failures;
- frontend tests, backend tests, build, and browser QA pass.
