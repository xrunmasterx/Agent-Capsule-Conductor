# Acceptance Criteria V2

The MVP is complete only when every required criterion below is satisfied.

## 1. Repository structure

Required files/directories exist:

```text
acc/
acc/adapters/
capsules/
workflows/
schemas/
tests/
docs/codex_goal/
docs/concepts/
pyproject.toml
AGENTS.md
```

## 2. CLI works

These commands must pass:

```bash
uv run acc list
uv run acc show echo-test.generic
uv run acc validate echo-test.generic
uv run acc validate fake-agent.generic
uv run acc validate workflow-editor.codex
```

## 3. Echo run creates a Session

This command must pass:

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_echo \
  --emit-conductor-json
```

Acceptance:

- stdout is exactly one JSON object,
- JSON parses with `python -m json.tool`,
- status is `success`,
- session_id exists,
- output_path exists,
- artifact_dir exists,
- event_log exists,
- session_manifest exists,
- `runs/acceptance_echo/session_manifest.json` exists,
- `runs/acceptance_echo/conductor_output.json` exists,
- no log text appears in stdout.

## 4. Session inspection works

This command must pass after echo run:

```bash
uv run acc session inspect runs/acceptance_echo
```

Acceptance:

- output includes capsule id,
- output includes session id,
- output includes status,
- output includes artifact directory.

## 5. Fake agent run works

This command must pass:

```bash
uv run acc run fake-agent.generic \
  --input capsules/fake-agent.generic/examples/input.json \
  --run-dir runs/acceptance_fake \
  --emit-conductor-json
```

Acceptance:

- output schema validates,
- required artifacts exist,
- stdout contract is respected,
- session manifest is written.

## 6. Batch run works

This command must pass:

```bash
uv run acc batch-run \
  --spec capsules/fake-agent.generic/examples/batch.json \
  --run-dir runs/acceptance_batch \
  --max-concurrency 2 \
  --emit-conductor-json
```

Acceptance:

- three task session dirs created,
- `bundle.json` exists,
- stdout is exactly one JSON object,
- batch status is `success`.

## 7. GraphOps dry-run works

These commands must pass:

```bash
uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json
uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run
```

Acceptance:

- validation exits 0,
- dry-run exits 0,
- dry-run reports target files and operations,
- dry-run does not mutate files,
- real apply is rejected unless `--apply --human-approved` is provided.

## 8. Test suite passes

Required:

```bash
uv run pytest -q
uv run ruff check .
```

Optional if configured:

```bash
uv run mypy acc
```

## 9. Default tests are hermetic

Default tests must not require:

- Codex login,
- Claude credentials,
- network,
- Conductor installation,
- real GitHub/Cursor/Gemini tools.

## 10. Codex adapter is test-covered

The Codex adapter must be tested with mocked subprocess execution.

Required checks:

- builds `codex exec`,
- includes `--json`,
- includes `--output-schema`,
- includes `-o <output.json>`,
- writes stdout to `events.jsonl`,
- writes stderr to `stderr.log`,
- handles non-zero exit,
- handles timeout,
- handles missing output.

## 11. Template/session separation is test-covered

Required checks:

- one template can create multiple sessions,
- sessions have different ids,
- sessions have isolated directories,
- Session A artifacts do not overwrite Session B artifacts,
- session manifest references the template id and version.

## 12. Conductor compatibility

`--emit-conductor-json` must satisfy Conductor strict script step requirements:

- stdout is a single JSON object,
- logs go to stderr,
- status fields are stable,
- downstream workflow can route on `status`,
- session manifest path is included.

## 13. Documentation

Required docs:

- README explains how to install, run, test,
- SPEC.md matches implementation,
- DESIGN.md matches implementation,
- TEST_PLAN.md matches test suite,
- ACCEPTANCE.md commands pass,
- concept docs explain Template/Session and GraphOps.

## 14. No scope creep

The project must not include:

- visual canvas,
- custom LLM agent loop,
- database-backed artifact system,
- cloud deployment,
- autonomous graph scheduler,
- unreviewed self-modifying workflow system.
