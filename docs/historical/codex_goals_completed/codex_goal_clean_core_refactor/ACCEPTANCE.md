# Acceptance Criteria

The clean core refactor is complete only when every required criterion passes.

## 1. Quality report exists

Required files:

```text
docs/codex_goal_clean_core_refactor/FINDINGS.md
docs/codex_goal_clean_core_refactor/QUALITY_REPORT.md
docs/codex_goal_clean_core_refactor/MIGRATION_NOTES.md
```

`QUALITY_REPORT.md` must state:

- modules kept,
- modules moved,
- modules rewritten,
- modules deleted,
- reasons for deletion/rewrite,
- remaining risks.

## 2. Tests pass

```bash
uv run pytest -q
uv run ruff check .
```

If typing is configured:

```bash
uv run mypy acc
```

## 3. WorkflowTemplate validation

```bash
uv run acc workflow validate examples/workflows/stateless_template_demo.accflow.json --json
uv run acc workflow validate examples/workflows/environment_stateful_demo.accflow.json --json
uv run acc workflow validate examples/workflows/nested_environment_demo.accflow.json --json
```

Each command must output valid JSON.

## 4. Stateless workflow run uses ephemeral workspace

```bash
uv run acc workflow run examples/workflows/stateless_template_demo.accflow.json \
  --run-dir runs/acceptance_clean_stateless \
  --emit-json > /tmp/acc_clean_stateless_stdout.json

python -m json.tool /tmp/acc_clean_stateless_stdout.json > /dev/null
```

Acceptance:

- output is valid JSON,
- run manifest exists,
- environment manifest exists,
- workspace path is under `runs/acceptance_clean_stateless/`,
- workspace path is not ACC install directory.

## 5. Stateful binding works

```bash
uv run acc workflow bind examples/workflows/environment_stateful_demo.accflow.json \
  --workspace . \
  --out runs/acceptance_clean_binding/binding.local.json \
  --json

uv run acc workflow run examples/workflows/environment_stateful_demo.accflow.json \
  --binding runs/acceptance_clean_binding/binding.local.json \
  --run-dir runs/acceptance_clean_bound \
  --emit-json > /tmp/acc_clean_bound_stdout.json

python -m json.tool /tmp/acc_clean_bound_stdout.json > /dev/null
```

Acceptance:

- environment effective cwd is the bound workspace,
- run metadata remains under run dir,
- behavior pack snapshot exists.

## 6. Inbox / Outbox data transfer works

```bash
uv run acc workflow run examples/workflows/stateless_template_demo.accflow.json \
  --run-dir runs/acceptance_clean_ports \
  --emit-json
```

Acceptance:

- upstream outbox exists,
- downstream inbox exists,
- data edge materialization is recorded,
- downstream output proves it read from inbox.

## 7. Nested environment policy works

```bash
uv run acc workflow run examples/workflows/nested_environment_demo.accflow.json \
  --run-dir runs/acceptance_clean_nested \
  --emit-json
```

Acceptance:

- stateless child workflow can inherit parent environment,
- invalid nested stateful workflow case is covered by tests and rejected unless explicitly allowed.

## 8. Scheduler correctness

Tests must cover:

- topological levels,
- bounded concurrency,
- workspace write locks,
- failure modes,
- retry,
- timeout.

## 9. No unsafe defaults

Tests must verify:

- no default workflow writes to ACC install directory,
- path traversal in ports/artifacts is rejected,
- direct upstream write into downstream workspace is impossible or rejected,
- external agent tests are skipped by default.

## 10. Optional old command regression

If old `acc run echo-test.generic --emit-conductor-json` remains supported:

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_clean_old_echo \
  --emit-conductor-json > /tmp/acc_clean_old_echo_stdout.json

python -m json.tool /tmp/acc_clean_old_echo_stdout.json > /dev/null
```

If it is intentionally removed or deprecated, `MIGRATION_NOTES.md` must document the replacement and tests must cover the replacement.
