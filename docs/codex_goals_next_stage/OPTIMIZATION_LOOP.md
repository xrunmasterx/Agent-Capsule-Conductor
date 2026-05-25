# Optimization Loop for Codex

## Purpose

Codex should not only implement features. It should test the system, observe failures, fix issues, and retest.

## Loop

For every major feature or browser journey:

```text
1. Establish expected behavior.
2. Run test or browser journey.
3. Capture evidence.
4. Classify issue.
5. Fix root cause.
6. Rerun same test/journey.
7. Record result in PROGRESS.md.
```

## Issue categories

```text
runtime_bug
schema_bug
ui_bug
i18n_bug
graph_layout_bug
artifact_visibility_bug
workflow_semantic_bug
browser_automation_gap
external_tool_gap
```

## Evidence to record

For CLI/API:

```text
command
exit code
stdout
stderr
created files
```

For browser:

```text
journey id
step failed
screenshot
console errors
network errors
observed behavior
expected behavior
fix applied
retest status
```

## Completion rule

A goal is not complete just because code was written.

A goal is complete only when:

```text
acceptance commands pass
browser journeys pass or blockers are documented
issues found during testing are fixed or recorded with reason
```
