# Plan 05: CLI-like UX Polish and Acceptance

## Goal

After backend semantics are correct, polish the Workbench AI assistant so the visible interaction
feels like a CLI conversation: one input, one timeline, streaming feedback, folded process evidence,
clear proposal blocks, and recoverable failures.

This plan is presentation and acceptance. It must not change backend chat semantics, event projection
schema, provider session policy, or GraphOps governance.

## UX Principles

- The transcript is for conversation first.
- Process evidence is available but folded by default.
- Status appears as a compact pill/chip, not as log spam.
- The composer is always visible and predictable.
- `Enter` sends; `Shift+Enter` inserts a newline.
- IME composition must not accidentally submit.
- Technical identifiers belong in technical details, not primary UI.
- Proposal actions live with the proposal result block.
- Composer layout must be stable at 1366px; no overlap between mode control, input, and submit.

## Transcript Projection Contract

| Source | Default visibility | Row type | Default expanded |
| --- | --- | --- | --- |
| user message | primary | user message | yes |
| assistant final message | primary | assistant message | yes |
| assistant delta/current stream | primary while running | streaming assistant message | yes while running |
| `agent_tool_use` | folded | tool/process row | no |
| `agent_tool_result` | folded | tool/process row | no |
| `agent_status` | technical/hidden | status pill or technical row | no |
| `agent_usage` | technical | technical detail | no |
| `agent_output_draft` | technical or proposal-attached | proposal/artifact detail | no unless proposal block |
| `agent_turn_failed` | primary | failure bubble | summary yes, raw detail no |
| validation error/warning | primary or proposal-attached | validation row | summary yes |
| proposal | primary/folded result block | proposal block | summary yes |
| GraphOps review | proposal-attached | governance block | summary yes |

Plan 05 consumes Plan 03 projection when available and falls back to Plan 01 rules for old evidence.

## Final Answer / Folded Middle Rule

For a completed turn, use a CLI-like structure:

```text
optional assistant preface
folded middle process timeline
final assistant answer
optional proposal/result block
```

Rules:

- Text before the first process event is preface.
- From the first process event to the last process event, including interleaved assistant text, is the
  folded middle.
- Text after the last process event is the final answer and is expanded by default.
- While streaming, current assistant text may remain expanded.
- After completion, middle reasoning/tool/status content defaults folded.

## Duplicate Suppression Rule

The same turn must not show both a live streaming assistant block and the persisted final assistant
message as separate answers.

Rules:

- Merge by `turn_id` plus provider `item_id`/message id when available.
- Persisted final assistant message replaces or completes the live stream.
- Optimistic user message is merged with server message after refresh.
- Proposal/result blocks remain attached to the same turn and do not duplicate text rows.

## Required Frontend Work

### 1. Message Row Design

Rows:

- user message;
- assistant final message;
- assistant streaming message;
- assistant failure bubble;
- folded tool/process group;
- proposal/result block.

Each row should have stable dimensions and avoid layout shifts.

### 2. Folded Process Timeline

For each turn:

- show compact running status while running;
- group tool events;
- collapse middle technical/process details by default after completion;
- let user expand when debugging;
- keep raw provider frames out of the default row body.

Suggested Chinese labels:

- `思考中`
- `调用工具`
- `读取文件`
- `生成草稿`
- `校验失败`

### 3. Composer Contract

- Fixed at the bottom of the console.
- Mode segmented control near composer.
- Typed text remains visible during submission.
- Submit disabled only for actual connecting-without-session or queued/running turn.
- `failed` but recoverable state remains input-capable.
- `Enter` submits.
- `Shift+Enter` inserts newline.
- IME composition does not submit.
- Focus returns to textarea after send unless a proposal action takes focus intentionally.

Submit labels:

- `连接中...`
- `执行中...`
- `发送`
- `生成修改`
- `继续微调`

### 4. Scroll Contract

- If the user is pinned to bottom, token growth, proposal result, and failure bubble keep the viewport
  at bottom.
- If the user manually scrolls up, do not steal scroll.
- Show `跳到底部` when newer content exists below the viewport.
- Composer is never covered by transcript content.
- Selected node details must not push the composer out of view.

### 5. Technical Details

Technical details may include:

- session id;
- provider session id;
- current turn id;
- response mode / reason;
- raw event count and summarized list;
- output/current draft path when relevant;
- validation details;
- provider/session health.

Technical details should be collapsed by default and should not consume primary transcript space.

### 6. Proposal Result Blocks

Proposal blocks should show:

- proposal summary;
- validation status;
- affected nodes/resources;
- GraphOps dry-run summary;
- actions: apply/discard/persist/approve.

Proposal actions call existing GraphOps paths only. This plan must not create direct durable
workflow/template mutation.

## Accessibility Contract

- Transcript container uses `role="log"` where appropriate.
- Live updates use restrained `aria-live`; do not read raw provider event spam.
- Failure summary is announced as an alert/status without reading stack traces.
- Folded details use accessible disclosure controls.
- Segmented mode control has clear selected state.
- Buttons have focus-visible states.
- Tab order reaches transcript controls, composer, submit, proposal actions, and technical details in
  a predictable order.

## Responsive Matrix

Verify at minimum:

- 1920x1080
- 1366x768
- 1280x720
- 1024x768
- 768x900 if the Workbench supports narrow/tablet layout
- browser zoom 125%
- browser zoom 200% for basic no-overlap/accessibility checks where feasible

Acceptance at 1366px is mandatory because that is where composer/control overlap is most likely.

## Browser Acceptance

Use `http://localhost:5173/?dev=true`.

Scenarios:

1. Empty assistant session:
   - composer visible;
   - no stale event rows;
   - status chip accurate.

2. Ordinary chat:
   - user message appears at bottom immediately;
   - assistant answer appears below it;
   - no authoring JSON visible;
   - no provider status spam.

3. Streaming/tool turn:
   - current assistant row updates in place;
   - tool events fold into compact rows;
   - status pill changes without adding transcript noise;
   - composer disabled only while the turn is running.

4. Failed authoring turn:
   - readable failure bubble;
   - raw detail expandable;
   - composer usable after failure.

5. Modification request:
   - proposal result block appears in transcript;
   - GraphOps controls still work;
   - no direct mutation bypass.

6. Selected node context:
   - context chip visible;
   - selected node output can be expanded;
   - composer remains visible.

Capture screenshots for at least normal chat, streaming/tool fold, failure, proposal, and selected
node context.

## Tests

Commands:

```powershell
cd F:\Agent-Capsule-Conductor-v2\web
npx tsc --noEmit
npm run test -- src/App.test.tsx
npm run build
```

If browser tooling is available:

```powershell
cd F:\Agent-Capsule-Conductor-v2\web
npm run dev
```

Then verify with Browser automation or manual QA.

## Acceptance

- A user can hold a multi-turn conversation without technical rows hiding the newest exchange.
- A user can distinguish chat, running, failed, and proposal states without reading raw events.
- A user can inspect evidence when needed.
- The UI remains consistent with the existing dark utilitarian Workbench style.
- Chinese labels render correctly as UTF-8; no mojibake appears in UI or snapshots.

## Risks

- Polishing UI before backend semantics may lead to brittle projection logic.
- Overly aggressive folding can hide action-required states.
- Accessibility can regress if transcript updates are treated as raw log spam.

Mitigation:

- Complete Plan 02 and Plan 03 before major visual polish.
- Keep action-required approvals/proposals visibly attached to the relevant turn.
- Include browser, keyboard, and basic screen-reader oriented checks in acceptance.
