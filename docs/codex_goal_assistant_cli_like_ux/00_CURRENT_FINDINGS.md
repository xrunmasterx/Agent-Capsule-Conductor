# Current Findings

## Executive Judgment

The current `confidence/questions/risk_notes` normalization is correct as a short-term compatibility
guard, but it is not the best final design for CLI-like conversation.

It is correct because it only fills non-destructive metadata defaults:

- `questions: []`
- `risk_notes: []`
- `confidence: "medium"`

It remains strict for fields that carry real contract meaning:

- `schema_version`
- `assistant_message`
- `proposal_kind`
- `proposal`
- extra unsupported keys

The limitation is architectural: ordinary `workbench_chat` still shares the structured authoring
contract. That makes a natural chat answer depend on JSON output validity. In a CLI-like experience,
assistant text should be the primary channel; structured authoring output should be an attached
artifact/result only when modification is requested.

## ACC Code Facts

### Backend Session and Turn Flow

- `AgentTurnService.submit_agent_turn()` creates the turn directory, writes input/resolved prompt
  artifacts, initializes logs, and appends the user message.
- `AgentTurnService.execute_agent_turn()` runs the adapter, appends assistant messages, processes
  output draft/current output, and marks the turn terminal.
- `render_workbench_assistant_prompt()` is currently the overloaded prompt path that made ordinary
  chat share authoring output semantics.
- `normalize_workbench_authoring_output()` fills missing metadata before validation.
- `validate_authoring_output_payload()` enforces the authoring output contract.

The important control-flow issue is the sequence:

```text
provider result
  -> assistant message append
  -> provider_session_id may be recorded
  -> output_draft normalize/validate
  -> failure may be marked after provider context already contains bad structured output
```

That is why provider session reuse policy belongs in the long-term fix, not just UI filtering.

### Adapter and Event Flow

The adapter maps provider events into canonical agent events such as:

- `agent_message_delta`
- `agent_message`
- `agent_tool_use`
- `agent_tool_result`
- `agent_status`
- `agent_usage`
- `agent_output_draft`
- `agent_turn_failed`

`append_agent_event()` writes these facts to `events.jsonl`. Today these events do not carry a
canonical transcript projection, so the frontend decides visibility by interpreting event types and
payload quirks.

### Frontend Projection Flow

The Workbench assistant currently merges:

- `messages.jsonl`;
- live/polled `events.jsonl`;
- session/turn status;
- draft validation state;
- proposal and GraphOps review state.

This is why stale `output_draft.json` rows or repeated raw errors can appear to occupy the newest
transcript position: messages, events, and result blocks do not yet share one explicit ordering and
visibility contract.

## Multica Comparison

`F:\Multica\multica` uses a clearer three-layer design:

1. `chat_message`: durable user/assistant conversation facts.
2. `agent_task_queue`: one task/turn runtime fact.
3. `task_message`: CLI transcript facts such as text, thinking, tool use, tool result, error.

Useful observed properties:

- Status is not default transcript content; it drives a status pill.
- Tool/thinking/middle transcript is folded by default.
- Final assistant answer is expanded and natural.
- Failures become conversation-visible failure bubbles with expandable raw detail.
- Resume pointers are guarded against poisoned sessions.

ACC can keep local JSONL evidence and still adopt these boundaries:

```text
messages.jsonl              -> conversation facts
session.json + turn.json    -> runtime/status facts
events.jsonl                -> transcript/evidence facts
projection                  -> default UI visibility/read model
```

## Core Problem Statement

ACC's current assistant UX is forced to infer "conversation" from mixed artifacts:

- `messages.jsonl`
- `events.jsonl`
- `output_draft.json`
- `current_output.json`
- frontend-only proposal state

The durable model does not yet state which facts are primary conversation, folded process, or
technical evidence. As a result, UX regressions recur as filtering/sorting bugs.

The root problem is not the single `confidence` error. The root problem is that ordinary chat,
structured authoring output, technical event transcript, and failure recovery are currently too
tightly coupled.

## Target Principle

The assistant should use this mental model:

```text
User message
  -> Assistant turn
    -> primary text stream
    -> folded tool/status/evidence timeline
    -> optional proposal/result block
    -> terminal success/failure state
```

For ordinary chat, the primary text stream is sufficient for success.

For modification requests, the optional proposal/result block must pass authoring and GraphOps
governance before changing durable workflow/template resources.

## Final Architecture Direction

1. **Frontend fallback projection first.**
   Keep current APIs, sort and filter the transcript correctly, and stop stale technical rows from
   pinning themselves below newer messages.

2. **Decouple chat from authoring JSON.**
   `workbench_chat` becomes a text channel. `canvas_revision` and `selected_node_revision` remain
   structured authoring channels.

3. **Add canonical event projection.**
   Backend/read models expose `primary/folded/technical/hidden` visibility so UI surfaces stop
   reverse-engineering provider event types.

4. **Productize failure recovery.**
   Failed turns carry `failure_kind`, `recoverability`, and provider session policy. A failed turn is
   no longer just raw backend text plus `session.status=failed`.

5. **Polish the CLI-like surface.**
   Conversation stays first, middle process evidence folds, final answer stays readable, GraphOps
   actions stay governed, and composer behavior remains predictable.

## Current Error Judgment

`Authoring agent output confidence must be a string` is a real backend validation failure, not a fake
frontend error.

For historical turns:

- keeping the evidence is correct;
- showing it as raw bottom-pinned transcript content is not correct;
- Plan 01 handles the display problem.

For future ordinary chat:

- the best fix is not to keep expanding normalization;
- the best fix is Plan 02: ordinary chat should not enter authoring schema validation.

For future modification turns:

- normalization remains a useful compatibility guard;
- invalid structured authoring output should still fail;
- Plan 04 should prevent repeated reuse of a poisoned structured-output provider context.
