# Implementation Order for Quality Audit

## Milestone 1: Baseline and inventory

Deliver:

- baseline test run;
- repository architecture map;
- list of old acceptance docs found;
- initial `FINDINGS.md`.

Do not change code yet except to add missing quality-audit docs.

## Milestone 2: Critical contract regression check

Verify and fix:

- stdout JSON contract;
- hermetic default tests;
- `acc run` core behavior;
- artifact/run directory integrity.

## Milestone 3: Security hardening

Verify and fix:

- path traversal;
- dangerous default permissions;
- subprocess command safety;
- secret leakage;
- GraphOps escalation.

## Milestone 4: Workflow/kernel correctness

Verify and fix:

- graph validation;
- cycle detection;
- topological level computation;
- failure_mode;
- parallel scheduling;
- data/control edge mapping;
- nested workflow behavior.

## Milestone 5: Debugger/replay/control-plane correctness

Verify and fix if these features exist:

- event replay;
- rerun/fork/diff;
- stable JSON control-plane commands;
- graphops dry-run/apply safety.

## Milestone 6: Performance and simplification

Analyze and optimize:

- graph algorithms;
- event replay;
- artifact preview;
- registry scan;
- browser graph rendering.

Remove needless complexity where safe.

## Milestone 7: Browser E2E QA

If UI exists:

- run browser journeys;
- capture screenshots/logs/report;
- fix critical/high UX blockers;
- re-run journeys.

## Milestone 8: Final acceptance and reporting

Run all acceptance commands.

Write:

- `FIXLOG.md`;
- `RISK_REGISTER.md`;
- `QUALITY_AUDIT_REPORT.md`.
