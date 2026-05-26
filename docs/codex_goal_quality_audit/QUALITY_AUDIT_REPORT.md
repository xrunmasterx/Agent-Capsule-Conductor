# ACC Quality Audit Report

## Conclusion

This quality-audit pass did not find a baseline functional regression in ACC’s public contracts. The repository was already green on baseline tests, CLI regressions, and browser journeys. The hardening work focused on structural defects that would have made the system noisier, heavier, or less repeatable over time.

The important outcome is:

- `acc run --emit-conductor-json` still emits exactly one JSON object on stdout.
- Default tests remain hermetic.
- Old acceptance regressions and next-stage acceptance commands passed.
- Browser E2E still passes, and it no longer leaves behind generated demo capsules.
- High-severity audit findings are resolved.

## Scope and method

The audit followed the required sequence:

1. Read `AGENTS.md` and the quality-audit docs.
2. Capture baseline evidence before code changes.
3. Produce [FINDINGS.md](/F:/Agent-Capsule-Conductor/docs/codex_goal_quality_audit/FINDINGS.md) before editing code.
4. Fix high-severity defects first.
5. Add regression coverage.
6. Re-run tests, acceptance commands, and browser journeys.
7. Record residual risks in [RISK_REGISTER.md](/F:/Agent-Capsule-Conductor/docs/codex_goal_quality_audit/RISK_REGISTER.md).

## Baseline summary

Baseline evidence was written under:

- [baseline_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/baseline_report.json)
- [regression_baseline_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/regression_baseline_report.json)

Baseline facts:

- `uv run pytest -q` passed
- `uv run ruff check .` passed
- `uv run acc list` passed
- `uv run acc validate echo-test.generic` passed
- `uv run acc validate fake-agent.generic` passed
- Browser journeys A-F already passed in the pre-fix baseline report

The baseline did reveal one concrete testability problem even though the commands were green: repeated browser E2E runs polluted the capsule registry with stale `browser-e2e-*` capsules.

## Fixes applied

Detailed change log:

- [FIXLOG.md](/F:/Agent-Capsule-Conductor/docs/codex_goal_quality_audit/FIXLOG.md)

High-severity fixes:

1. Browser E2E cleanup was added and stale generated capsules were removed.
2. Workflow graph hot-path helpers were simplified to stop rescanning nodes/edges unnecessarily.
3. Event replay JSONL reading now streams line-by-line instead of bulk `read_text(...).splitlines()`.

Additional medium fixes closed during the same pass:

1. Artifact directory diff now uses streaming digests instead of hex-encoding full file contents.
2. `CapsuleRegistry` now caches discovery within one instance.

## Verification summary

### Python and CLI

- `uv run pytest -q` -> `180 passed`
- `uv run ruff check .` -> pass
- Full acceptance command chain report:
  - [final_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/final_report.json)
- Contract/content assertions:
  - [acceptance_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/acceptance_assertions.json)
  - [json_output_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/json_output_assertions.json)

Important verified facts:

- `acceptance_echo_stdout.status == success`
- `output_path`, `artifact_dir`, `event_log`, `session_manifest` exist
- `runs/acceptance_echo/conductor_output.json` exists
- stdout and `conductor_output.json` match semantically
- `session inspect` output includes `capsule_id`, `session_id`, `status`, `artifact_dir`
- batch run created `3` task session directories and `bundle.json`
- all machine-readable stdout logs from the acceptance chain parsed as JSON successfully

### Browser and UX

- `npm test` -> pass
- `npm run build` -> pass
- `npm run test:e2e` -> pass
- Latest browser evidence:
  - [browser_e2e_report.json](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/browser_e2e_report.json)
  - [console.log](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/console.log)
  - [network.log](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/network.log)
  - [screenshots](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/screenshots)

Verified browser outcomes:

- Chinese-first labels are present for main workflow actions.
- Capsule creation/test journey passes.
- Two-node graph creation and edge drag connection pass.
- Parallel workflow inspection pass.
- Debugger/replay browser journey pass.
- GraphOps safety browser journey pass.
- Browser QA no longer leaves generated `browser-e2e-*` capsules behind; see [acceptance_assertions.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/acceptance_assertions.json).

## Performance review

Performance evidence:

- [performance_report.json](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54/performance_report.json)

Measured observations on this machine:

- 100-node synthetic linear graph:
  - `validate_workflow_graph` ≈ `47.6 ms`
  - `topological_levels` ≈ `0.337 ms`
- 1000-node synthetic linear graph:
  - `validate_workflow_graph` ≈ `274.247 ms`
  - `topological_levels` ≈ `10.175 ms`
- 10000-line JSONL read through the replay reader:
  - `read_jsonl_events` ≈ `12.885 ms`

Complexity assessment:

- Cycle detection: implemented via queue-based topological order, O(V+E) in the control-edge traversal.
- Topological levels: now queue/in-degree based, O(V+E).
- Graph validation:
  - Structural traversal is now adjacency-based instead of repeated rescans.
  - Upstream reachability checks use propagated bitmasks. This is materially simpler and faster than the previous repeated edge scans, but worst-case memory/time still scales with reachable-state size, not only raw edge count.
- Event replay parser:
  - no longer bulk-loads via `Path.read_text`
  - still returns a full timeline JSON payload, so total memory remains proportional to response size
- Artifact preview/listing:
  - server artifact reads remain bounded by the `1_000_000` byte limit in [server/context.py](/F:/Agent-Capsule-Conductor/acc/server/context.py:25)
- Registry lookup:
  - repeated within-instance full scans were removed via local caching

## Security review

File path safety:

- Artifact read API resolves paths inside project root and rejects traversal:
  - implementation: [server/context.py](/F:/Agent-Capsule-Conductor/acc/server/context.py:39)
  - tests: [test_artifacts_api.py](/F:/Agent-Capsule-Conductor/tests/server/test_artifacts_api.py)
- Capsule file edit API only allows whitelisted files:
  - implementation: [capsules.py](/F:/Agent-Capsule-Conductor/acc/server/routes/capsules.py:280)
- Workflow save path is restricted to `*.graph.json` under the workflows root:
  - implementation: [workflows.py](/F:/Agent-Capsule-Conductor/acc/server/routes/workflows.py:170)

Subprocess safety:

- Generic and Codex adapters use `asyncio.create_subprocess_exec(...)` with argument lists:
  - [generic_cli.py](/F:/Agent-Capsule-Conductor/acc/adapters/generic_cli.py:30)
  - [codex_cli.py](/F:/Agent-Capsule-Conductor/acc/adapters/codex_cli.py:21)
- Timeouts are enforced in adapter paths and lifecycle shell paths.
- Residual note:
  - workflow capsule lifecycle commands still use shell strings in [runner.py](/F:/Agent-Capsule-Conductor/acc/runner.py:592); this remains an accepted medium risk for trusted, authored capsule assets and is tracked in [RISK_REGISTER.md](/F:/Agent-Capsule-Conductor/docs/codex_goal_quality_audit/RISK_REGISTER.md).

Permission safety:

- `danger-full-access` remains opt-in and validated:
  - adapter checks: [codex_cli.py](/F:/Agent-Capsule-Conductor/acc/adapters/codex_cli.py:12)
  - schema checks are covered in unit tests
- GraphOps permission escalation remains blocked by default:
  - [graphops.py](/F:/Agent-Capsule-Conductor/acc/graphops.py:52)
  - tests: [test_graphops_patch_validation.py](/F:/Agent-Capsule-Conductor/tests/unit/test_graphops_patch_validation.py)
- Real GraphOps apply without the human gate was actually rejected:
  - `uv run acc graphops apply-patch ... --apply` -> exit code `1`

Secret safety:

- Secret-like filenames are blocked from artifact read exposure:
  - implementation: [server/context.py](/F:/Agent-Capsule-Conductor/acc/server/context.py:58)
  - tests: [test_artifacts_api.py](/F:/Agent-Capsule-Conductor/tests/server/test_artifacts_api.py)
- No redaction system was added in this audit because the current default hermetic test path does not emit credential-bearing payloads by design. This remains acceptable, but if external integrations expand, redact-on-write should be revisited.

## Documentation alignment

Docs used for this audit are present and aligned with the current command surface.

One environment-specific note was required:

- The quality-acceptance doc shows `/tmp/...` redirection examples.
- This audit was executed on Windows, so equivalent stdout/stderr captures were written under:
  - [runs/quality_audit/2026-05-25T22-45-54](/F:/Agent-Capsule-Conductor/runs/quality_audit/2026-05-25T22-45-54)
- The contract being verified stayed the same: one JSON object on stdout, no extra log lines.

## Remaining risks

Open residual risks are tracked in:

- [RISK_REGISTER.md](/F:/Agent-Capsule-Conductor/docs/codex_goal_quality_audit/RISK_REGISTER.md)

Summary:

- unresolved critical: `0`
- unresolved high: `0`
- unresolved medium: `2`
- unresolved low: `2`

## Final judgment

The repository now satisfies the requested quality-audit hardening goals based on current evidence:

- baseline tests pass
- old acceptance regressions pass
- quality acceptance commands pass
- browser E2E evidence exists and passes
- no unresolved critical/high issues remain
- performance and security review evidence exists
- unresolved lower-priority risks are documented explicitly
