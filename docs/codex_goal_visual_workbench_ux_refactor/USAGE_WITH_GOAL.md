# Usage With Codex Goal

## 1. Plan first

Use `/plan` before implementation:

```text
/plan Read AGENTS.md and docs/codex_goal_visual_workbench_ux_refactor/*.md. Produce a concise milestone plan for the Visual Workbench UX Refactor. Do not implement yet.
```

Reject a plan if it proposes:

- rewriting `acc run`;
- building a new LLM agent loop;
- deleting hermetic fixtures without test proof;
- making real market/news/network data required in default tests;
- using Codex goal internal state as ACC runtime state;
- skipping browser evidence.

## 2. Start goal

Paste `GOAL_COMMAND.txt` into Codex.

If `/goal` is unavailable, enable Codex goals according to the official Codex docs or run the same command as a normal prompt. The repository acceptance contract remains the source of truth.

## 3. During implementation

Useful steering messages:

```text
Keep class configuration in the resource library; task nodes are invocation instances.
```

```text
Do not delete examples required by tests. Remove UI demo clutter only after proving it is not a fixture.
```

```text
Show real input/output evidence from artifacts, not placeholder UI state.
```

```text
Run the browser journey again after every UX fix.
```

## 4. Completion

Ask Codex:

```text
Run every command and browser journey in docs/codex_goal_visual_workbench_ux_refactor/ACCEPTANCE.md. Report command, exit code, evidence path, and remaining risks. Do not mark the goal complete if any required acceptance fails.
```

## 5. OpenAI/Codex goal guidance used

Public Codex docs describe Goal mode as a persistent objective for longer tasks whose text acts as both starting prompt and completion criteria. They also recommend measurable outcomes and test criteria, and suggest using `/plan` first when the goal is hard to define. This goal package follows that pattern by keeping the long contract in versioned repository files and making `ACCEPTANCE.md` the completion authority.
