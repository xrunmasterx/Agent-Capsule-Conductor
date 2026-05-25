# Quality Audit Acceptance Criteria

The quality audit is complete only when every required item below is satisfied.

## 1. Required reports exist

These files must exist:

```text
docs/codex_goal_quality_audit/FINDINGS.md
docs/codex_goal_quality_audit/FIXLOG.md
docs/codex_goal_quality_audit/RISK_REGISTER.md
docs/codex_goal_quality_audit/QUALITY_AUDIT_REPORT.md
```

If UI exists, this must also exist:

```text
runs/browser_e2e/<timestamp>/browser_e2e_report.json
```

## 2. Baseline tests pass

```bash
uv run pytest -q
uv run ruff check .
uv run acc list
uv run acc validate echo-test.generic
uv run acc validate fake-agent.generic
```

## 3. Core stdout contract still passes

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/quality_acceptance_echo \
  --emit-conductor-json > /tmp/acc_quality_echo_stdout.json 2> /tmp/acc_quality_echo_stderr.log

python -m json.tool /tmp/acc_quality_echo_stdout.json > /dev/null
```

Acceptance:

- stdout is exactly one JSON object;
- stdout contains no log lines;
- parsed JSON has `status`, `summary`, `output_path`, `artifact_dir`, `event_log`;
- `status` is `success`;
- referenced paths exist;
- `runs/quality_acceptance_echo/conductor_output.json` exists.

## 4. Fake agent regression still passes

```bash
uv run acc run fake-agent.generic \
  --input capsules/fake-agent.generic/examples/input.json \
  --run-dir runs/quality_acceptance_fake \
  --emit-conductor-json > /tmp/acc_quality_fake_stdout.json 2> /tmp/acc_quality_fake_stderr.log

python -m json.tool /tmp/acc_quality_fake_stdout.json > /dev/null
```

Acceptance:

- schema validates;
- required artifacts exist;
- stdout contract is respected.

## 5. Workflow regression passes if workflow commands exist

If `acc workflow` exists, these must pass for available example graphs:

```bash
uv run acc workflow validate examples/workflows/demo_serial.graph.json
uv run acc workflow validate examples/workflows/demo_parallel.graph.json
uv run acc workflow run examples/workflows/demo_serial.graph.json --run-dir runs/quality_acceptance_serial --emit-json
uv run acc workflow run examples/workflows/demo_parallel.graph.json --run-dir runs/quality_acceptance_parallel --emit-json
```

If filenames differ, Codex must use equivalent existing examples and document substitutions in `QUALITY_AUDIT_REPORT.md`.

## 6. Browser E2E evidence exists if UI exists

If a browser UI exists, Codex must run browser-driven journeys and produce:

```text
runs/browser_e2e/<timestamp>/browser_e2e_report.json
runs/browser_e2e/<timestamp>/screenshots/
runs/browser_e2e/<timestamp>/console.log
```

The report must include:

- journeys executed;
- pass/fail status;
- screenshots captured;
- issues found;
- fixes applied;
- retest results.

## 7. No unresolved critical/high issues

`FINDINGS.md` and `RISK_REGISTER.md` must show:

- zero unresolved critical issues;
- zero unresolved high issues, unless blocked by external limitation and clearly documented;
- all blocked issues must include reproduction, reason, risk, and next action.

## 8. Performance and algorithmic review completed

`QUALITY_AUDIT_REPORT.md` must include:

- graph validation complexity;
- topological scheduling complexity;
- event replay memory behavior;
- artifact preview/listing memory behavior;
- any benchmarks or reasons benchmarks were not applicable.

Required minimum:

- graph validation and topological scheduling should be O(V+E), or deviations must be justified.

## 9. Security checklist completed

`QUALITY_AUDIT_REPORT.md` must include security findings for:

- path traversal;
- subprocess command safety;
- secret leakage;
- dangerous permission defaults;
- GraphOps privilege escalation;
- browser artifact API reads/writes if applicable.

## 10. Documentation alignment

Docs must not claim unsupported functionality.

At minimum:

- README or equivalent usage docs reflect actual commands;
- goal/acceptance docs mention any changed command names;
- known limitations are recorded in `RISK_REGISTER.md` or `INTEGRATION_GAPS.md`.

## 11. No scope creep

The audit must not introduce unrelated major features.

Disallowed without explicit justification:

- database migration;
- cloud deployment;
- new LLM agent framework;
- new model integration;
- marketplace;
- enterprise auth;
- large UI redesign unrelated to QA findings.
