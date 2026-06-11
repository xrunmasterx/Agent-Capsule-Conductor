# Acceptance: Phase 2A Usability Core

Phase 2A is complete only when every criterion below is satisfied.

## 1. Previous MVP acceptance still passes

Run the existing MVP acceptance commands from:

```text
docs/codex_goal/ACCEPTANCE.md
```

At minimum:

```bash
uv run acc list
uv run acc show echo-test.generic
uv run acc validate echo-test.generic
uv run acc validate fake-agent.generic
uv run pytest -q
uv run ruff check .
```

## 2. Run index works

After a successful fake run:

```bash
uv run acc run fake-agent.generic \
  --input capsules/fake-agent.generic/examples/input.json \
  --run-dir runs/workbench_acceptance_fake \
  --emit-conductor-json
```

These commands must pass:

```bash
uv run acc runs list
uv run acc runs list --json
uv run acc runs show workbench_acceptance_fake
uv run acc runs show workbench_acceptance_fake --json
```

Acceptance:

- JSON output parses,
- run status is visible,
- output path is visible,
- artifact dir is visible,
- failed nodes are listed if any.

## 3. Inspect JSON works

```bash
uv run acc inspect runs/workbench_acceptance_fake --json
```

Acceptance:

- returns valid JSON,
- includes run_dir,
- includes status,
- includes artifacts,
- includes output path,
- includes stderr and event log paths.

## 4. Capsule authoring utilities work

```bash
uv run acc capsule doctor echo-test.generic
uv run acc capsule test echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/workbench_acceptance_capsule_test \
  --emit-conductor-json
```

Optional if clone command is implemented:

```bash
uv run acc capsule clone echo-test.generic echo-test-copy.generic
uv run acc validate echo-test-copy.generic
```

## 5. New files are generated

For relevant runs, these should exist when applicable:

```text
runs/index.json
node_summary.json
run_summary.json
```

## 6. Test suite passes

```bash
uv run pytest -q
uv run ruff check .
```

## 7. No scope creep

Phase 2A must not include:

- web UI,
- FastAPI server,
- drag-and-drop graph editor,
- database migration,
- custom LLM agent loop.
