# Plan 02: Chat Text Channel Decoupling

## Goal

Make ordinary `workbench_chat` a natural text conversation path. Keep structured
`acc.authoring.output.v1` only for modification turns.

This is the semantic root fix for the `confidence/questions/risk_notes` class of chat failures.
Normalization remains useful for authoring turns, but ordinary chat should not enter authoring
validation at all.

## First Principles

- Ordinary chat success means the user receives readable assistant text.
- Canvas/template mutation requires structured proposal governance.
- Proposal validation must not be weakened.
- A user question should not fail merely because it was not wrapped in authoring JSON.
- `reason -> prompt -> response_mode -> adapter extraction -> draft pointer -> validation` must be a
  clear state machine.

## Current Behavior

Current `workbench_chat` flow:

```text
user message
  -> render_workbench_assistant_prompt()
  -> prompt asks for acc.authoring.output.v1 JSON
  -> adapter extracts latest JSON object into output_draft.json
  -> execute_agent_turn() normalizes and validates the draft
  -> assistant_message is parsed out of JSON for display
```

This makes chat dependent on authoring output validity. It also means a normal answer containing a
JSON example can be accidentally interpreted as durable authoring output.

## Target Behavior

New `workbench_chat` flow:

```text
user message
  -> render_workbench_chat_prompt()
  -> adapter streams assistant text
  -> final assistant text is appended to messages.jsonl
  -> no output_draft.json is produced or consumed
  -> no current_output_turn_id is set by this turn
  -> no authoring validation or GraphOps proposal path is entered
```

Modification turns remain structured:

```text
canvas_revision / selected_node_revision
  -> render_workbench_authoring_prompt()
  -> require one acc.authoring.output.v1 JSON object
  -> proposal may be null, but the authoring envelope is required
  -> normalize metadata defaults
  -> validate authoring output
  -> validate/dry-run/review/apply proposal when mutation is requested
```

## Hard Invariants

- `workbench_chat` durable conversation truth is `messages.jsonl`.
- `workbench_chat` does not produce, consume, validate, or promote `output_draft.json`.
- `workbench_chat` success must leave `current_output_ref/current_output_turn_id` unchanged or null;
  this turn must never become the current authoring draft.
- `canvas_revision` and `selected_node_revision` success requires a valid authoring envelope.
- For modification turns, `proposal` can be `null`; the envelope cannot be absent.
- Ordinary chat containing JSON, GraphOps-like JSON, or `acc.authoring.output.v1` text is still just
  assistant text unless a later explicit modification path promotes it.

## Response Mode Matrix

| `reason` | Prompt | Response mode | Adapter JSON extraction | Success condition | Draft/current output |
| --- | --- | --- | --- | --- | --- |
| `workbench_chat` | natural chat prompt | `chat_optional_output` | No. If provider emits JSON text, keep it as text. | readable assistant text exists | never set by this turn |
| `canvas_revision` | authoring prompt | `structured_required` | Yes, exactly one object must be extracted | valid `acc.authoring.output.v1` | set after validation |
| `selected_node_revision` | authoring prompt | `structured_required` | Yes, exactly one object must be extracted | valid `acc.authoring.output.v1` | set after validation |
| run-node output revision | node-specific prompt | structured or node-specific | Yes when schema is required | node output schema valid | publish path as today |

If the current enum name `authoring_optional_proposal` remains, redefine or rename it so it means
`structured_required, proposal_optional`, not `structured envelope optional`.

## Required Backend Changes

### 1. Split Prompt Rendering

Replace the overloaded prompt renderer with explicit paths:

- `render_workbench_chat_prompt(...)`
- `render_workbench_authoring_prompt(...)`

`render_workbench_chat_prompt()` should:

- ask for natural language;
- include current canvas/selection context only as conversation context;
- not include `AUTHORING_CORE_RULES`;
- not say "Return exactly one JSON object";
- allow JSON examples only as normal explanation text when the user asks for them.

`render_workbench_authoring_prompt()` should:

- keep authoring and GraphOps rules;
- require exactly one `acc.authoring.output.v1` JSON object;
- include a short response shape;
- require defaults such as `questions`, `risk_notes`, and `confidence`.

### 2. Make `reason` the Source of Response Contract

`_run_session_streaming_adapter()` must choose the adapter response mode from the turn `reason`, not
only from `session_kind`.

Persist enough debugging state in turn input/manifest to explain the contract used:

- `reason`;
- `response_mode`;
- `primary_channel`;
- `expects_output_draft`.

Keep the public API shape unchanged unless an existing internal DTO already supports the distinction.

### 3. Stop JSON Draft Extraction in Chat Mode

Adapter behavior:

- `chat_optional_output`: `assistant_messages` are the only primary output; do not call
  `latest_json_object()` for durable draft purposes; do not write `output_draft.json`; do not emit
  `agent_output_draft`.
- `structured_required`: extract JSON; fail when missing; let service-level validation enforce
  authoring or node output schema.

Service behavior:

- For `workbench_chat`, ignore `result.output_json_path` if a legacy provider still emits one.
- Do not call `normalize_workbench_authoring_output()` or `validate_authoring_output_payload()` for
  `workbench_chat`.
- Do not write `current_output.json` for `workbench_chat`.
- If no readable assistant text exists, the chat turn fails with a readable provider/output failure.

### 4. Preserve Authoring Compatibility

Keep `normalize_workbench_authoring_output()` for modification turns only. It may fill:

- `questions: []`
- `risk_notes: []`
- `confidence: "medium"`

It must not fill semantic fields such as `schema_version`, `assistant_message`, `proposal_kind`, or
`proposal`.

Existing tests that use `workbench_chat` to validate authoring metadata must move to
`canvas_revision` or `selected_node_revision`.

## GraphOps Boundary

- `workbench_chat` must not create, promote, validate, dry-run, approve, or apply GraphOps.
- Natural language containing a `GraphOpsTransaction` JSON snippet is chat text, not a proposal.
- `acc.authoring.output.v1` is an authoring draft, not durable mutation.
- Durable agent/tool/workflow changes still require GraphOps `validate -> dry-run -> approval -> apply`.
- `current_output_turn_id` may point only to a validated modification draft.
- Provider tool approvals remain controlled; ordinary chat must not bypass session/run-scoped
  permission rules.

## Provider Session Safety

Plan 04 owns full failure recovery, but Plan 02 must not make session poisoning worse:

- A failed structured authoring turn must not force the next ordinary chat to resume an unsafe thread
  without an explicit policy.
- At minimum, structured failures should mark enough state for Plan 04 to clear or avoid the
  provider session before the next structured turn.
- Ordinary chat keeps ACC conversation continuity through `messages.jsonl`; it does not require
  provider thread reuse to feel continuous.

## Required Frontend Changes

- `AssistantComposer` remains a single input.
- Conversation mode maps to `workbench_chat`.
- Modification mode maps to `canvas_revision` or `selected_node_revision`.
- Ordinary chat final assistant text comes from `messages.jsonl`, not draft parsing.
- Frontend must not call `validateAssistantDraft()` for a completed chat turn.
- Proposal blocks appear only for modification turns with a valid draft/proposal.
- A failed authoring turn must not block later ordinary chat input.

## Expected Files

Backend:

- `acc/app/agent_sessions.py`
- `acc/adapters/codex_app_server.py`
- `tests/server/test_agent_sessions_api.py`
- `tests/unit/test_codex_app_server_adapter.py`

Frontend:

- `web/src/components/WorkflowViewer.tsx`
- `web/src/App.test.tsx`

## Tests

Backend:

- `workbench_chat` with pure text succeeds; `messages.jsonl` has assistant text; no
  `output_draft.json`, no `current_output.json`, and `current_output_turn_id is None`.
- `workbench_chat` with fenced JSON or valid-looking `acc.authoring.output.v1` text still succeeds as
  ordinary text and does not create a draft.
- `canvas_revision` with pure text or missing JSON fails and does not set `current_output_turn_id`.
- `canvas_revision` / `selected_node_revision` still fail on missing `schema_version`,
  `assistant_message`, `proposal_kind`, `proposal`, or invalid `confidence`.
- Adapter request capture proves `workbench_chat -> chat_optional_output` and modification reasons
  -> `structured_required`.
- `agent_output_draft` is emitted only in structured mode.
- Ordinary chat after failed authoring turn succeeds.
- GraphOps negative: chat text containing GraphOps-like JSON does not create a proposal directory.

Frontend:

- Ordinary chat completion does not call `validateAssistantDraft()`.
- Modification mode still validates draft and shows proposal/result block.
- Authoring failure leaves composer usable for ordinary chat.
- JSON examples in assistant chat text are displayed as text, not promoted to proposal UI.

Commands:

```powershell
cd F:\Agent-Capsule-Conductor-v2
uv run pytest -q tests/server/test_agent_sessions_api.py tests/unit/test_codex_app_server_adapter.py

cd F:\Agent-Capsule-Conductor-v2\web
npx tsc --noEmit
npm run test -- src/App.test.tsx
npm run build
```

## Acceptance

- User can type `你好` and receive a normal assistant reply without any authoring JSON requirement.
- No `confidence` / `questions` / `risk_notes` failure can occur for ordinary chat.
- Modification requests still cannot mutate canvas without valid authoring output plus GraphOps
  review path.
- `current_output_turn_id` is never advanced by an ordinary chat turn.

## Risks

- Existing tests may encode the old "all Workbench assistant turns produce drafts" assumption.
- Adapter parsing may currently write drafts before service code can ignore them.
- Provider session reuse can preserve bad structured-output history if Plan 04 is not followed.

Mitigation:

- Make response mode reason-aware first.
- Move authoring metadata tests out of `workbench_chat`.
- Add GraphOps negative tests before changing UI behavior.
