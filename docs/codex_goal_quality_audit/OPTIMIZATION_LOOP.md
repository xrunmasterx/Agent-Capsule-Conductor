# Optimization Loop

Codex must use this loop for quality hardening.

## Step 1: Observe

Run tests, inspect code, run browser journeys if available, and capture baseline evidence.

## Step 2: Diagnose

For each issue, identify:

- symptom;
- root cause;
- violated design principle;
- severity;
- affected commands or UI journeys;
- smallest safe fix.

## Step 3: Fix

Implement focused fixes.

Rules:

- Do not refactor broadly without evidence.
- Do not change public behavior unless necessary.
- Preserve old acceptance contracts.
- Add tests for fixes.

## Step 4: Verify

Run targeted tests first, then full tests.

For UI issues, run browser journey again and capture evidence.

## Step 5: Simplify

After fixes, look for:

- duplicated code introduced during fixes;
- overly complex branching;
- unused helpers;
- inconsistent naming;
- avoidable dependencies.

Simplify only when safe.

## Step 6: Document

Update:

```text
FINDINGS.md
FIXLOG.md
RISK_REGISTER.md
QUALITY_AUDIT_REPORT.md
```

## Step 7: Repeat until done

Do not mark complete while acceptance fails or critical/high issues remain unresolved.
