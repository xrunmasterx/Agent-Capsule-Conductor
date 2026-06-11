# Quality Audit Spec

## 1. Scope

This spec defines the required quality-audit scope for the ACC repository.

The audit must cover:

1. Architecture boundaries.
2. Capsule runtime correctness.
3. Workflow kernel correctness.
4. Workflow graph validation.
5. GraphOps safety.
6. Artifact/session/run data integrity.
7. CLI machine-readable contracts.
8. Browser UI usability if UI exists.
9. Security and permission boundaries.
10. Performance and algorithmic complexity.
11. Test quality and hermeticity.
12. Documentation accuracy.

## 2. Preserved invariants

The following must remain true:

- `acc run ... --emit-conductor-json` emits exactly one JSON object to stdout.
- Logs go to stderr or files.
- Default tests do not call real external agents or network.
- Existing capsules keep working unless explicitly migrated.
- Existing workflow examples keep working unless explicitly migrated.
- Artifact directories remain inspectable.
- `output.json` remains schema-validated.
- Required artifacts remain validated.
- Dangerous permissions remain opt-in.
- The system does not implement its own LLM reasoning/tool loop.

## 3. Required deliverables

Codex must produce or update:

```text
docs/codex_goal_quality_audit/FINDINGS.md
docs/codex_goal_quality_audit/FIXLOG.md
docs/codex_goal_quality_audit/RISK_REGISTER.md
docs/codex_goal_quality_audit/QUALITY_AUDIT_REPORT.md
runs/quality_audit/<timestamp>/baseline_report.json
runs/quality_audit/<timestamp>/final_report.json
runs/browser_e2e/<timestamp>/browser_e2e_report.json   if UI exists
```

## 4. Severity model

Use this severity model:

### Critical

Breaks core functionality, data integrity, stdout machine contract, sandbox boundaries, or allows dangerous file/command access by default.

### High

Makes common workflows unreliable, prevents debugging, breaks browser workflow creation/run/inspect, or creates serious maintainability risk.

### Medium

Causes friction, ambiguity, moderate performance issue, weak test coverage, or unclear UX.

### Low

Cosmetic issue, doc mismatch, naming inconsistency, minor refactor opportunity.

## 5. Fix policy

- Critical/high issues must be fixed before completion unless documented as externally blocked.
- Medium issues should be fixed if cheap, otherwise recorded with a rationale.
- Low issues may be batched.
- Every critical/high fix must have a regression test or browser E2E evidence.

## 6. Performance policy

Performance fixes must not be speculative. Codex must provide:

- complexity analysis, or
- benchmark evidence, or
- measurable before/after observation.

Required performance-sensitive paths:

- graph validation;
- topological level computation;
- parallel execution scheduling;
- event replay;
- run/artifact listing;
- browser graph rendering for demo-sized graphs.

## 7. Security policy

Security audit must cover:

- path traversal;
- shell injection;
- arbitrary file write;
- secret leakage in logs/artifacts;
- dangerous sandbox defaults;
- GraphOps permission escalation;
- browser API unsafe file reads/writes;
- untrusted workflow/capsule input validation.

## 8. Browser UX policy

If a browser workbench exists, Codex must perform actual browser-driven journeys rather than only `npm run build`.

Evidence must include:

- browser report JSON;
- screenshots;
- console log;
- network log or summary;
- detected issues and fixes.
