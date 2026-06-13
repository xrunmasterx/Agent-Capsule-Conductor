# Implementation Order

## Recommended Split

Use five implementation plans.

1. **Frontend transcript projection**
   - Lowest risk.
   - Fixes the immediate user-visible annoyance.
   - No backend API or evidence changes.

2. **Chat text channel decoupling**
   - Most important semantic fix.
   - Ordinary chat no longer depends on authoring JSON.
   - Modification requests remain structured and governed.

3. **Canonical transcript event model**
   - Makes backend event visibility explicit.
   - Reduces future UI filtering regressions.

4. **Failure recovery and session health**
   - Converts raw failures into recoverable conversation states.
   - Prevents poisoned provider sessions from degrading future structured turns.

5. **CLI-like UX polish and acceptance**
   - Final visual/interaction polish.
   - Browser, keyboard, accessibility, and responsive QA.

## Why Not One Plan

Doing this as one large refactor would couple:

- backend prompt contracts;
- adapter response modes;
- event evidence shape;
- frontend transcript rendering;
- failure recovery;
- provider session reuse;
- GraphOps proposal UI.

That is too much blast radius for a UX refactor. The correct sequencing is to first make the current
projection sane, then fix backend chat semantics, then add durable event visibility, then productize
failure recovery, then polish.

## Suggested Development Gates

### Gate 1: UI Projection Stable

Required before Plan 02:

- New messages appear at the bottom.
- Optimistic messages merge with server messages without duplicates.
- Technical rows are hidden by default.
- `agent_turn_failed` is visible as a concise error.
- Failed session with no running turn no longer blocks composer.
- No backend evidence/API changes have been introduced.

### Gate 2: Chat Decoupled

Required before Plan 03:

- `workbench_chat` succeeds without authoring JSON.
- `workbench_chat` containing fenced JSON or valid-looking authoring JSON does not generate a draft.
- `current_output_turn_id` is not advanced by ordinary chat.
- Modification turns without JSON fail.
- Modification turns still require valid `acc.authoring.output.v1`.
- Failed authoring turn does not poison the next ordinary chat path.
- Existing GraphOps proposal/apply tests still pass.

### Gate 3: Event Visibility Explicit

Required before Plan 04:

- New backend events carry versioned projection/visibility metadata.
- Old events missing projection receive computed legacy projection in read/live models.
- `WorkbenchLiveEvent` and run transcript types preserve top-level projection.
- Assistant transcript and run transcript honor the same projection policy.
- `event_seq` is distinct from SSE `seq` and tested for deterministic ordering.

### Gate 4: Failure Model Productized

Required before Plan 05:

- Failed turns carry `failure_kind`, `failure_origin`, `recoverability`, and provider session policy.
- `agent_turn_failed` has user summary plus expandable technical detail.
- Session health reflects whether provider session reuse is safe.
- Composer remains usable when `can_submit_next_turn=true`.
- Structured output failures do not blindly reuse poisoned provider session for the next structured
  turn.

### Gate 5: UX Acceptance

Complete when:

- browser QA passes at 1366px and 1920px, plus the narrower/zoom checks in Plan 05;
- ordinary chat feels natural;
- streaming/tool middle content is folded correctly after completion;
- modification proposals remain governed;
- no raw provider/status/evidence noise dominates the default transcript;
- Chinese labels render without mojibake.

## Parallelization Guidance

Safe parallel work:

- Frontend visual prototypes can happen after Plan 01, but should not land until Plan 02/03 semantics
  are stable.
- Backend tests for failure classification can be drafted while Plan 03 event projection is underway.
- Browser QA scripts can be prepared before Plan 05, as long as expected semantics are not asserted
  before earlier gates land.

Unsafe parallel work:

- Do not change `workbench_chat` prompt contract and frontend transcript assumptions in separate
  branches without agreeing on final message semantics.
- Do not change event evidence shape without backward-compatible readers.
- Do not implement provider session clearing without tests proving when provider session is unsafe.
- Do not polish proposal UI in a way that bypasses GraphOps review/apply controls.

## Rollback Strategy

Each plan should be independently revertible:

- Plan 01: frontend projection only.
- Plan 02: restore old `workbench_chat` structured prompt if needed.
- Plan 03: ignore projection metadata and fallback to event type filtering.
- Plan 04: ignore failure metadata and use old status field.
- Plan 05: visual/presentation only.

Rollback must preserve existing evidence readability. Do not rewrite old `events.jsonl` merely to
undo a display policy.
