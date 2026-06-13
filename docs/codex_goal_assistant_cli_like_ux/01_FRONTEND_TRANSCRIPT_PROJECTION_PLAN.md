# Plan 01: Frontend Transcript Projection

## Goal

Stabilize the current AI assistant UI projection without changing backend API, event evidence, prompt
contracts, GraphOps semantics, or provider session behavior.

This is a frontend fallback projection plan. It makes the current mixed message/event stream behave
like a CLI timeline while later plans fix backend semantics.

## First Principles

- The default transcript is a conversation surface, not a raw event log.
- UI projection can hide or fold noise, but it must not rewrite durable facts.
- New user/assistant messages must appear in chronological order at the bottom.
- Failed turns should be visible, but stale technical artifacts must not occupy the newest position.
- Composer availability should follow turn execution state, not the last session terminal status.

## Explicit Non-goals

This plan must not:

- add or require backend projection metadata;
- change `messages.jsonl`, `events.jsonl`, `session.json`, or turn evidence;
- change `workbench_chat` prompt or response semantics;
- add failure classification, recoverability, or provider session health;
- change GraphOps proposal validation, dry-run, approval, or apply.

## Current Code Facts

The frontend currently reconstructs the assistant transcript from three kinds of facts:

- `messages.jsonl` / agent session messages: conversation facts.
- `AgentSessionRecord` + `AgentTurnRecord`: runtime and status facts.
- `events.jsonl` / `WorkbenchLiveEvent`: transcript/evidence facts that should be folded or hidden
  by default when they are technical.

Important paths to preserve:

- `generateAssistantProposal()` creates optimistic local user messages before server refresh.
- `refreshAssistantTurn()` fetches server messages and converts them through
  `agentMessagesToAssistantMessages()`.
- Events can arrive from both polled `assistantEvents` and `useWorkbenchLiveStream()`.
- `liveEventFromAgentRunEvent()` may store the raw event type in `payload.event_type`.
- `terminal` live events are runtime status, not transcript rows.
- Current proposal/validation blocks can be appended outside the sorted event/message list; this is
  what can pin stale results below newer messages.
- Validation errors/warnings may not have timestamps.
- `agent_output_draft`, `agent_output_published`, generic `agent_event` payload summaries, and raw
  evidence paths can leak into the visible transcript if not filtered.

Expected files:

- `web/src/components/WorkflowViewer.tsx`
- `web/src/App.test.tsx`
- optional `web/src/styles.css` for folded row/error styling only

## Required Changes

### 1. Stable Time-order Merge

`buildAssistantTranscriptItems()` should return a single stable ordered list across:

- user messages;
- final assistant messages;
- current running assistant stream;
- compact tool summaries;
- explicit error blocks;
- validation/proposal/GraphOps result blocks.

Rules:

- Use `createdAt` / `timestamp` when available.
- Preserve input order for equal timestamps.
- Put optimistic local messages without server time at the bottom until server refresh replaces or
  merges them.
- Never append proposal, validation, or draft blocks after the sorted list if they belong to an older
  turn.
- Validation/proposal items without timestamps should attach to their related turn/message, or fall
  back to current insertion order without becoming permanently pinned at the bottom.

### 2. Default Visibility Filter

Default transcript includes:

- user messages;
- final assistant messages;
- current running assistant stream;
- `agent_tool_use` / `agent_tool_result` as compact folded rows;
- explicit `agent_turn_failed` error rows;
- validation errors and warnings;
- proposal/result blocks only when tied to the relevant turn.

Default transcript excludes:

- `terminal` live events;
- generic status rows;
- `agent_usage`;
- `agent_output_draft` and `agent_output_published` path rows;
- provider start/completion/reasoning events;
- prompt previews;
- stack traces;
- full raw payloads;
- raw output paths such as `current_output.json` and `output_draft.json`;
- generic `agent_status` unless it maps to a user-actionable state.

When the live event type is generic `agent_event`, use `payload.event_type` to apply the same rules.
For example:

- `payload.event_type === "agent_turn_failed"` renders an error.
- `payload.event_type === "agent_output_draft"` is hidden by default.

### 3. Status Derivation

Keep status outside the transcript:

- `connecting`: session is being created or restored.
- `runningTurn`: pending turn is `queued` or `running`.
- `ready`: no pending turn and session is usable.
- `lastFailed`: session status is `failed` but no pending turn exists; composer remains usable.

Submit should be disabled only for `connecting` states where no session can accept input and for an
active queued/running turn. A previous failed turn must not disable ordinary next input.

### 4. Error Display Limits

This plan may render existing `agent_turn_failed` as:

- title: `本轮失败`;
- summary: short sanitized text from `payload.error` or equivalent;
- raw detail: expandable technical disclosure.

This plan must not invent backend fields such as `failure_kind`, `recoverability`, `user_summary`, or
session health. Those belong to Plan 04.

Do not show full stack traces, prompt previews, provider frames, or evidence paths by default.

## Tests

Add or maintain frontend tests for:

- chronological merge across messages and events;
- optimistic no-timestamp user message appears at bottom, then server refresh does not duplicate it;
- `agent_event` with `payload.event_type=agent_turn_failed` renders an error;
- `agent_event` with `payload.event_type=agent_output_draft` is hidden;
- `agent_output_published` / output path rows are hidden by default;
- `terminal`, generic status, and usage events are hidden by default;
- streaming content updates keep the viewport at bottom only when the user is pinned to bottom;
- proposal/validation blocks do not pin stale content below newer messages;
- composer is enabled when no queued/running pending turn exists, including after failed status.

Commands:

```powershell
cd F:\Agent-Capsule-Conductor-v2\web
npx tsc --noEmit
npm run test -- src/App.test.tsx
npm run build
```

## Acceptance

- Empty assistant panel shows a clean composer and no stale technical rows.
- Sending a normal message immediately appends the user message at the bottom.
- Historical errors remain in chronological position, not pinned at the bottom.
- New assistant responses appear below previous content.
- Technical paths such as `output_draft.json` are absent from the default transcript.
- Technical detail remains inspectable through the existing disclosure/debug surface.

## Risks

- Sorting without stable timestamps can reorder old local-only messages.
- Hiding too much event data can make debugging harder.
- Overfitting frontend filters can mask the need for backend event semantics.

Mitigation:

- Keep raw event fetch APIs unchanged.
- Keep technical detail accessible.
- Treat this as a compatibility layer; Plan 03 must replace type-guessing with canonical projection.
