# Usage With Goal

## How to start

1. Read `AGENTS.md`.
2. Read all files in `docs/codex_goal_callable_semantics/`.
3. Run baseline tests.
4. Update `FINDINGS.md`.
5. Implement milestone by milestone.

## Baseline commands

```bash
uv run pytest -q
uv run ruff check .
uv run pytest -q tests/architecture/test_import_boundaries.py
```

## Working rules

- Preserve public behavior first.
- Add compatibility before migration.
- Do not remove legacy fields until tests and migration notes prove safety.
- Keep default tests hermetic.
- Run relevant tests after every meaningful milestone.
- Update `PROGRESS.md` and `QUALITY_REPORT.md` as work proceeds.

## Suggested implementation loop

```text
read current implementation
write/update findings
add focused tests
implement smallest semantic slice
run focused tests
run regression tests
update docs
repeat
```

