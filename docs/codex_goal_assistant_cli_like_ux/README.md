# AI Assistant CLI-like UX Refactor

Status: planning package.

This package defines a staged plan for turning the Workbench AI assistant into a natural,
CLI-like conversation surface while preserving ACC's Core v2 constraints:

- Workbench UI is a projection, not durable truth.
- Runtime evidence lives in session/turn/run evidence files.
- Durable workflow/template mutation must go through GraphOps proposal, validation, dry-run,
  human approval, and apply.
- Ordinary chat success means the user receives a readable answer.
- Structured authoring success means a valid `acc.authoring.output.v1` payload and governed proposal
  path when mutation is requested.

## Why This Exists

The immediate `Authoring agent output confidence must be a string` failure was caused by ordinary
Workbench chat sharing the authoring JSON contract. The short-term normalization fix is correct and
low-risk for authoring compatibility, but it is not the final architecture for natural conversation.

The target architecture separates:

1. conversation facts: user/assistant-visible messages;
2. turn/runtime facts: queued/running/success/failed/cancelled state;
3. transcript/evidence facts: stream text, tool use, tool result, status, artifact, error, proposal;
4. projection facts: stable display hints that decide primary/folded/technical/hidden visibility.

This mirrors the useful pattern observed in `F:\Multica\multica`:

- Multica: `chat_message / agent_task_queue / task_message`.
- ACC: `messages.jsonl / session.json+turn.json / events.jsonl+provider_events.jsonl`.

The goal is not to copy Multica's database shape. The goal is to copy the fact separation and resume
safety: user-facing chat remains natural while technical transcript remains attached to a task/turn
and folded by default.

## Plan Set

Recommended implementation order:

1. [01 Frontend Transcript Projection](01_FRONTEND_TRANSCRIPT_PROJECTION_PLAN.md)
   - Frontend fallback projection only.
   - Stabilize the current UI without changing backend wire shape.
   - Keep messages at the bottom by true time order.
   - Hide technical noise by default.

2. [02 Chat Text Channel Decoupling](02_CHAT_TEXT_CHANNEL_DECOUPLING_PLAN.md)
   - Make `workbench_chat` a natural text turn.
   - Make `reason` drive prompt, response mode, adapter extraction, draft pointers, and validation.
   - Keep authoring JSON only for modification turns.

3. [03 Canonical Transcript Event Model](03_CANONICAL_TRANSCRIPT_EVENT_MODEL_PLAN.md)
   - Add backend projection metadata to events/read models.
   - Stop relying on front-end hardcoded event filtering.
   - Keep old evidence readable through computed legacy projection.

4. [04 Failure Recovery and Session Health](04_FAILURE_RECOVERY_AND_SESSION_HEALTH_PLAN.md)
   - Classify failures, recoverability, and provider session health.
   - Prevent poisoned structured-output sessions from degrading later turns.

5. [05 CLI-like UX Polish and Acceptance](05_CLI_LIKE_UX_POLISH_AND_ACCEPTANCE_PLAN.md)
   - Polish the interaction model after the data semantics are correct.
   - Add browser, keyboard, accessibility, and responsive acceptance gates.

Cross-cutting verification is in [TEST_PLAN.md](TEST_PLAN.md).

## Non-goals

- Do not replace GraphOps with direct LLM writes.
- Do not store runtime/session state in `.accflow.json` templates.
- Do not introduce a database solely to mimic Multica; ACC can implement the same separation with
  local-first JSONL evidence.
- Do not make provider raw events part of the default user transcript.
- Do not make ordinary chat depend on authoring proposal validation.
- Do not persist localized UI strings as canonical event facts.

## Completion Definition

The refactor is complete when a user can use the Workbench AI assistant like a CLI conversation:

- type a normal question;
- immediately see their message at the bottom;
- see assistant text stream or appear naturally;
- see concise running status without transcript spam;
- expand tool/proposal/error evidence only when needed;
- request a canvas modification and get a governed proposal block;
- recover from failed turns without losing the conversation or being blocked by stale failed state;
- inspect technical evidence when needed without it polluting the default conversation.
