# Quality Audit Risk Register

This register tracks remaining risks after the current hardening pass.

## Open risks

| ID | Severity | Area | Current state | Evidence | Next action |
|---|---|---|---|---|---|
| R1 | Medium | Workflow capsule lifecycle shell execution | `acc/runner.py` still executes lifecycle commands via `asyncio.create_subprocess_shell(...)`. This is acceptable for trusted, human-authored capsule assets, but it is still a shell-powered surface. | [runner.py](/F:/Agent-Capsule-Conductor/acc/runner.py:592) | If lifecycle authoring is expanded beyond trusted local authors, migrate to argv-form commands or add explicit review warnings/allowlists. |
| R2 | Medium | Replay payload size | Event parsing no longer bulk-loads with `Path.read_text`, but replay still returns full timeline JSON, so total memory remains proportional to response size. | [events.py](/F:/Agent-Capsule-Conductor/acc/events.py:71), [debugger.py](/F:/Agent-Capsule-Conductor/acc/debugger.py:51) | Add paginated/tail replay APIs if changing the public contract becomes acceptable. |
| R3 | Low | Browser runtime tooling | In-app browser tooling is still unavailable; Playwright is the active fallback path. | [browser_e2e_report.json](/F:/Agent-Capsule-Conductor/runs/browser_e2e/2026-05-25T15-30-48-065Z/browser_e2e_report.json), `tooling_notes.in_app_browser = unavailable` | Keep Playwright fallback. Revisit only if a stable in-app browser returns. |
| R4 | Low | Frontend bundle size | `npm run build` still emits a Vite chunk-size warning for the main JS bundle. No correctness regression was observed. | Build output from `npm run build` | Consider code-splitting only if the UI surface keeps growing or startup latency becomes measurable. |

## Closed risks from this audit

| ID | Previous severity | Area | Resolution |
|---|---|---|---|
| C1 | High | Browser E2E state pollution | Browser-created capsules are now cleaned up and stale leftovers were removed. |
| C2 | High | Workflow graph hot-path complexity | Level computation and ancestor checks were simplified and benchmarked. |
| C3 | High | Event replay bulk file loading | JSONL reading is now line-by-line. |
| C4 | Medium | Artifact diff memory amplification | Directory fingerprints now use streaming digests. |
| C5 | Medium | Registry repeated full scans | `CapsuleRegistry` now caches per instance. |

## Severity summary

- Unresolved critical: 0
- Unresolved high: 0
- Unresolved medium: 2
- Unresolved low: 2
