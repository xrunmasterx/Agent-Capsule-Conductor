# How to use this package with Codex `/goal`

## 1. Why the docs are split into files

Codex `/goal` should point to stable repository files instead of embedding a full architecture document inline.

This package uses:

```text
AGENTS.md
  repo-level rules

docs/codex_goal/GOAL.md
  outcome and completion condition

docs/codex_goal/SPEC.md
  functional contract

docs/codex_goal/DESIGN.md
  architecture and component design

docs/codex_goal/TEST_PLAN.md
  test cases and mock strategy

docs/codex_goal/ACCEPTANCE.md
  exact done criteria

docs/codex_goal/IMPLEMENTATION_ORDER.md
  milestone order

docs/codex_goal/GOAL_COMMAND.txt
  copy-paste /goal command
```

## 2. Prepare your repository

From your project root:

```bash
mkdir -p docs/codex_goal docs/concepts
cp -r <this-package>/docs/codex_goal/* docs/codex_goal/
cp -r <this-package>/docs/concepts/* docs/concepts/
cpy <this-package>/AGENTS.md ./AGENTS.md
```

Also copy templates if desired:

```bash
cp -r <this-package>/workflows ./workflows
cp -r <this-package>/capsules ./capsules
cp -r <this-package>/schemas ./schemas
cp -r <this-package>/examples ./examples
```

## 3. Start Codex and ask for a plan first

Open Codex in the repository root:

```bash
codex
```

Before setting a persistent goal, ask Codex to inspect the docs and produce a plan:

```text
/plan Read AGENTS.md, docs/codex_goal/*.md, and docs/concepts/*.md. Produce a concise implementation plan with milestones, files to create, tests to write, and the first command you will run. Do not implement yet.
```

Reject or correct the plan if it proposes:

- building a visual UI,
- building a custom LLM agent loop,
- requiring real Codex/Claude credentials in default tests,
- skipping the stdout JSON contract,
- allowing LLM-generated graph patches to apply without human approval,
- starting with a large architecture before the CLI smoke path works.

## 4. Set the persistent goal

Copy the full command from:

```text
docs/codex_goal/GOAL_COMMAND.txt
```

Paste it into Codex.

## 5. During development

Use short steering messages:

```text
Stay on Milestone 3. Do not implement Codex adapter until session manifest and artifact store tests pass.
```

```text
The stdout contract is mandatory. Fix any test that detects extra stdout logs.
```

```text
GraphOps must remain dry-run by default. Do not allow LLM patches to mutate files without --apply --human-approved.
```

```text
Default tests must be hermetic. Move real Codex/Claude calls behind ACC_RUN_EXTERNAL_AGENT_TESTS=1.
```

## 6. Pause, resume, inspect, clear

During a long task:

```text
/goal
/goal pause
/goal resume
/goal clear
```

Use pause when you want to manually inspect files or run acceptance commands yourself.

## 7. Completion check

Do not accept a narrative completion message. Ask Codex to run the exact commands in `ACCEPTANCE.md`:

```text
Run all required acceptance commands in docs/codex_goal/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark the goal complete if any command fails.
```

## 8. If external tools are unavailable

If Codex, Claude SDK, or Conductor is not installed locally, Codex should not fake a real integration result.

Expected behavior:

- keep default tests mocked/hermetic,
- record the missing tool in `docs/codex_goal/INTEGRATION_GAPS.md`,
- finish all locally testable functionality,
- leave optional smoke tests skipped unless the required environment variable is enabled.

## 9. Engineering mental model

Correct model:

```text
Conductor = workflow topology
acc = template/session execution boundary
Capsule Template = Agent class
Session = Agent instance
Claude/Codex/Gemini/Cursor = mature agent internals
artifacts = typed data flowing between nodes
GraphOps = controlled workflow/capsule editing API
```

Wrong model:

```text
Build a new agent from LLM node + tool node + memory node.
```
