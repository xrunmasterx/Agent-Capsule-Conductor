# Goal: Agent Capsule Conductor V2 MVP

## Objective

Implement **Agent Capsule Conductor V2**.

The MVP is a Python CLI named `acc`. It loads reusable **Capsule Templates** from `capsules/*/capsule.yaml`. Each `acc run <capsule_id>` creates a new **Session**, prepares a workspace, renders prompts, invokes an adapter, captures events/artifacts, validates `output.json`, writes `session_manifest.json`, and emits exactly one Conductor-compatible JSON object to stdout when `--emit-conductor-json` is set.

The system is designed so Microsoft Conductor script steps can call:

```bash
uv run acc run <capsule_id> --input <input.json> --run-dir <run_dir> --emit-conductor-json
```

## V2 additions over V1

1. Explicitly separate **Capsule Template** and **Session**.
2. Add `session_manifest.json` as a required run artifact.
3. Add `acc session inspect <run_dir>` as an alias/future-compatible command.
4. Add minimal **GraphOps Control Plane**:
   - `acc graphops validate-patch <patch.json>`
   - `acc graphops apply-patch <patch.json> --dry-run`
   - real apply requires explicit `--apply` and human approval flag.
5. Add tests proving multiple sessions can be created from one template without state leakage.
6. Add docs and example capsule for a workflow-editor agent that proposes graph patches but does not auto-apply them.

## Must deliver

1. Python package and CLI:
   - `acc list`
   - `acc show <capsule_id>`
   - `acc validate <capsule_id>`
   - `acc run <capsule_id> --input <path> --run-dir <run_dir> --emit-conductor-json`
   - `acc inspect <run_dir>`
   - `acc session inspect <run_dir>`
   - `acc batch-run --spec <batch.json> --run-dir <run_dir> --max-concurrency <n>`
   - `acc graphops validate-patch <patch.json>`
   - `acc graphops apply-patch <patch.json> --dry-run`

2. Core components:
   - Capsule Template schema
   - Session manifest schema
   - Capsule registry
   - Session / run artifact store
   - Prompt rendering
   - Workspace manager
   - Output schema validation
   - Generic CLI adapter
   - Codex CLI adapter
   - Claude SDK adapter stub/import guard
   - Batch runner
   - GraphOps patch validator and dry-run patch preview

3. Example capsules:
   - `echo-test.generic`
   - `fake-agent.generic`
   - `source-reality-check.codex`
   - `critical-review.claude`
   - `workflow-editor.codex`

4. Example workflows:
   - `workflows/engine-architecture-research.v2.yaml`
   - `workflows/meta-improve-workflow.v2.yaml`

5. Test suite:
   - unit tests
   - CLI tests
   - adapter tests with mocked subprocess
   - artifact/session tests
   - schema validation tests
   - batch runner tests
   - GraphOps dry-run tests
   - optional external-agent smoke tests skipped by default

## Completion condition

The project is complete only when all commands in `docs/codex_goal/ACCEPTANCE.md` pass and the produced examples demonstrate this core flow:

```text
capsule.yaml                  # Capsule Template / Agent Class
  -> acc validate
  -> acc run                  # creates a Session / Agent Instance
  -> session_manifest.json
  -> resolved_prompt.md
  -> adapter execution
  -> events.jsonl
  -> output.json
  -> artifact validation
  -> conductor_output.json
  -> exactly-one-JSON-object stdout
```

For GraphOps:

```text
workflow-editor.codex
  -> proposes graph_patch.json
  -> acc graphops validate-patch graph_patch.json
  -> acc graphops apply-patch graph_patch.json --dry-run
  -> no real mutation unless explicit human-approved --apply is used
```

## Constraints

- Do not build a visual UI.
- Do not implement a custom LLM tool-calling loop.
- Do not require real external agent credentials for default tests.
- Do not write logs to stdout when `--emit-conductor-json` is used.
- Do not use `danger-full-access` by default.
- Do not let a failed external dependency make the default test suite fail.
- Do not let an LLM automatically rewrite workflows/capsules without explicit human approval.

## Iteration policy

Work milestone by milestone:

1. Skeleton and schemas.
2. Registry and validation.
3. Session manifest and artifact store.
4. Generic CLI adapter and `acc run`.
5. Output/artifact/session validation.
6. Codex CLI adapter with mocked subprocess tests.
7. Workspace manager.
8. Batch runner.
9. GraphOps patch validator and dry-run.
10. Example capsules, workflows, docs, acceptance pass.

After each milestone, run relevant tests and update `docs/codex_goal/PROGRESS.md`.

## Blocked stop condition

If a required external tool is unavailable:

- keep default tests hermetic with mocks/fakes,
- mark real integration tests as optional,
- document missing command/tool/version in `docs/codex_goal/INTEGRATION_GAPS.md`,
- continue implementing locally testable functionality.
