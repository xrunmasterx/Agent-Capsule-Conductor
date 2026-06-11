# Acceptance Criteria

The refactor is complete only when every required criterion below is satisfied.

## 1. Required docs exist

```text
docs/codex_goal_ideal_layering/FINDINGS.md
docs/codex_goal_ideal_layering/MIGRATION_NOTES.md
docs/codex_goal_ideal_layering/DECISIONS.md
docs/codex_goal_ideal_layering/RISK_REGISTER.md
docs/codex_goal_ideal_layering/QUALITY_REPORT.md
```

## 2. Module structure exists

Required packages or equivalent clearly named modules exist:

```text
acc/domain
acc/ports
acc/engine
acc/store
acc/runtime
acc/app
acc/cli
```

If exact package names differ, QUALITY_REPORT.md must justify the difference and map each responsibility.

## 3. Dependency boundaries pass

Run:

```bash
uv run pytest -q tests/architecture/test_import_boundaries.py
```

If the test file name differs, an equivalent dependency-boundary test must exist and be listed in QUALITY_REPORT.md.

## 4. Core test suite passes

```bash
uv run pytest -q
uv run ruff check .
```

## 5. CLI JSON contract passes

At least one smoke command must prove machine-readable stdout remains clean.

Preferred if old command still exists:

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_layering_echo \
  --emit-conductor-json > /tmp/acc_layering_stdout.json 2> /tmp/acc_layering_stderr.log

python -m json.tool /tmp/acc_layering_stdout.json > /dev/null
```

If the command was intentionally migrated, MIGRATION_NOTES.md must provide the replacement command and the replacement must satisfy the same one-JSON stdout contract.

## 6. Clean Core workflow acceptance

Run equivalent commands for clean-core templates:

```bash
uv run acc workflow validate examples/workflows/ideal_layering_serial.accflow.json --json
uv run acc workflow run examples/workflows/ideal_layering_serial.accflow.json \
  --run-dir runs/acceptance_ideal_layering_serial \
  --emit-json
```

And a parallel/failure demo:

```bash
uv run acc workflow validate examples/workflows/ideal_layering_parallel.accflow.json --json
uv run acc workflow run examples/workflows/ideal_layering_parallel.accflow.json \
  --run-dir runs/acceptance_ideal_layering_parallel \
  --emit-json
```

## 7. Store contract evidence

The run directory must include or equivalently expose:

```text
workflow_run_manifest.json
workflow_events.jsonl
environments/<env_id>/environment_manifest.json
nodes/<node_id>/events.jsonl
nodes/<node_id>/output.json
nodes/<node_id>/artifact_bundle.json
nodes/<node_id>/inbox/
nodes/<node_id>/outbox/
```

## 8. Security contract tests pass

Required tests:

- env whitelist test,
- path traversal rejection,
- workspace write lock/declaration,
- dangerous permission rejection,
- no full host env inheritance.

## 9. No forbidden scope creep

The refactor must not introduce:

- database backend requirement,
- cloud service dependency,
- default real external agent dependency,
- custom LLM agent loop,
- full Conductor DSL clone.

## 10. Final report

`QUALITY_REPORT.md` must include:

- summary of old responsibilities in `acc.clean_workflow`,
- new module responsibility map,
- import boundary evidence,
- test results,
- performance sanity evidence,
- security contract evidence,
- remaining risks,
- explicit next step recommendation.
