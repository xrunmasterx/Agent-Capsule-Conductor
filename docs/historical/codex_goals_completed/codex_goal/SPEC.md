# Agent Capsule Conductor V2 Spec

## 1. Product definition

Agent Capsule Conductor V2 is a lightweight Python CLI that makes mature external agents usable as deterministic workflow nodes.

It does not create new agents from LLM + tools. It wraps mature agents behind a consistent execution contract.

V2 formalizes this model:

```text
Capsule Template / Agent Class
  static reusable definition

Session / Agent Instance
  dynamic runtime execution
```

## 2. Non-goals

Do not implement:

- visual graph editor,
- custom autonomous scheduler,
- custom LLM tool-calling loop,
- memory system,
- RAG platform,
- cloud deployment,
- database artifact backend,
- real-time web dashboard,
- unreviewed self-modifying workflow system.

Microsoft Conductor is the intended workflow orchestrator.

## 3. Core concept

A Capsule Template is a directory containing:

```text
capsule.yaml
prompt_template.md
input_schema.json
output_schema.json
artifact_manifest.yaml
optional behavior files:
  AGENTS.md
  CLAUDE.md
  GEMINI.md
  .claude/skills/
  .agents/skills/
```

A Session is one concrete execution of a Capsule Template. It has:

```text
session_id
capsule_id
capsule_version
run_dir
workspace_dir
input.json
resolved_prompt.md
events.jsonl
output.json
artifacts/
session_manifest.json
```

## 4. Required package layout

```text
acc/
  __init__.py
  cli.py
  schemas.py
  registry.py
  runner.py
  artifact_store.py
  workspace.py
  validation.py
  prompting.py
  session.py
  graphops.py
  utils.py
  adapters/
    __init__.py
    base.py
    generic_cli.py
    codex_cli.py
    claude_sdk.py

capsules/
  echo-test.generic/
  fake-agent.generic/
  source-reality-check.codex/
  critical-review.claude/
  workflow-editor.codex/

schemas/
  capsule_template_schema.json
  session_manifest_schema.json
  graphops_patch_schema.json

tests/
  fixtures/
  unit/
  integration/

workflows/
  engine-architecture-research.v2.yaml
  meta-improve-workflow.v2.yaml
```

## 5. CLI commands

### `acc list`

Lists available Capsule Templates.

### `acc show <capsule_id>`

Prints Capsule Template metadata.

### `acc validate <capsule_id>`

Validates:

- `capsule.yaml`,
- prompt template exists,
- schema files exist,
- artifact manifest exists,
- runtime type is known,
- required fields are present,
- dangerous permissions are rejected unless explicitly allowed.

### `acc run <capsule_id>`

Required:

```bash
acc run <capsule_id> --input <input.json> --run-dir <run_dir>
```

Optional:

```bash
--input-json '<json object>'
--emit-conductor-json
```

Behavior:

1. Load Capsule Template.
2. Validate input.
3. Create a new Session.
4. Create run directory.
5. Write `input.json`.
6. Snapshot capsule config.
7. Write `session_manifest.json` with status `created`.
8. Render prompt to `resolved_prompt.md`.
9. Prepare workspace.
10. Invoke adapter.
11. Capture stdout/stderr/events.
12. Validate `output.json`.
13. Validate required artifacts.
14. Update `session_manifest.json` with final status.
15. Write `conductor_output.json`.
16. If `--emit-conductor-json`, print exactly one JSON object to stdout.

### `acc inspect <run_dir>` / `acc session inspect <run_dir>`

Prints:

- session id,
- capsule id/version,
- status,
- output path,
- artifact list,
- stderr path,
- event log path,
- workspace path.

### `acc batch-run`

Runs multiple sessions concurrently.

```bash
acc batch-run --spec batch.json --run-dir <run_dir> --max-concurrency 3
```

### `acc graphops validate-patch <patch.json>`

Validates a proposed workflow/capsule patch.

### `acc graphops apply-patch <patch.json> --dry-run`

Shows what would change. Does not mutate files.

Real apply requires:

```bash
acc graphops apply-patch <patch.json> --apply --human-approved
```

This is intentionally explicit. LLM-generated patches must not be applied silently.

## 6. Standard session directory

Every `acc run` creates:

```text
run_dir/
  input.json
  resolved_prompt.md
  capsule.yaml.snapshot
  session_manifest.json
  run_manifest.json              # backward-compatible alias if needed
  stdout.log
  stderr.log
  events.jsonl
  output.json
  conductor_output.json
  artifacts/
```

## 7. Conductor stdout contract

When `--emit-conductor-json` is used, stdout must contain exactly one JSON object:

```json
{
  "status": "success",
  "summary": "short human-readable summary",
  "session_id": "session_xxx",
  "output_path": "/absolute/path/to/output.json",
  "artifact_dir": "/absolute/path/to/artifacts",
  "event_log": "/absolute/path/to/events.jsonl",
  "session_manifest": "/absolute/path/to/session_manifest.json"
}
```

On failure:

```json
{
  "status": "failed",
  "summary": "Capsule session failed",
  "error": "short error message",
  "session_id": "session_xxx",
  "output_path": null,
  "artifact_dir": "/absolute/path/to/artifacts",
  "event_log": "/absolute/path/to/events.jsonl",
  "session_manifest": "/absolute/path/to/session_manifest.json"
}
```

All logs must go to stderr or files.

## 8. Runtime types

Required:

- `generic_cli`
- `codex_cli`
- `claude_sdk`

Optional future:

- `google_agent_cli`
- `cursor_cli`
- `hermes_cli`

## 9. Workspace modes

Required:

- `existing_dir`
- `git_worktree_readonly`
- `git_worktree_write`

Future:

- `docker`

## 10. Security rules

Default:

- sandbox is read-only,
- network false,
- write_files false,
- timeout required,
- `danger-full-access` forbidden unless explicitly allowed,
- external credentials not required by default tests,
- GraphOps apply is dry-run by default,
- LLM-generated GraphOps patch requires human approval to apply.
