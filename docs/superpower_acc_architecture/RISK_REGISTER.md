# ACC Superpower Architecture RISK_REGISTER

生成日期: 2026-06-21

## R1 — Breaking existing workflow runs while removing implicit dataflow

**Severity:** High  
**Risk:** Existing `.accflow.json` may rely on control edge forwarding to `main` without data edges.

**Mitigation:**

- Add warnings and migration report first。
- Provide auto-migration suggestion: add explicit data edge or input binding。
- Keep compatibility flag for one milestone only。

**Exit:** all canonical examples/tests use explicit dataflow。

## R2 — Over-abstracting runtime ports

**Severity:** Medium  
**Risk:** Introducing too many interfaces can make a lightweight system heavier.

**Mitigation:**

- Ports must be narrow and evidence-backed。
- One interface per volatility boundary: repository, recorder, invocation, event, projection。
- No DI container or framework。

**Exit:** orchestrator code becomes shorter and clearer, not more indirect.

## R3 — Adapter capability restriction breaks real agent behavior

**Severity:** High  
**Risk:** Agents may currently depend on raw paths/env vars.

**Mitigation:**

- Audit adapters and templates。
- Provide explicit workspace capability mounts。
- Offer debug mode for raw evidence only, not default runtime.

**Exit:** real adapters run with capability envelope in integration tests.

## R4 — Projection migration breaks Workbench UX

**Severity:** High  
**Risk:** UI may currently rely on raw runtime manifests for details.

**Mitigation:**

- Define projection schemas first。
- Build adapter layer mapping current raw evidence to projection。
- Migrate component-by-component with snapshot tests。

**Exit:** standard UI passes projection fixture tests; debug disclosure still available.

## R5 — Incremental storage index becomes inconsistent

**Severity:** Medium  
**Risk:** Upsert/delete journal can drift from filesystem truth.

**Mitigation:**

- Keep explicit full rebuild repair command。
- Add consistency check。
- Use object_ref as stable key。
- Batch with idempotent upserts。

**Exit:** consistency check passes after mutation test suite.

## R6 — ControlModeStrategy migration leaves supervisor/handoff half-wired

**Severity:** High  
**Risk:** supervisor/handoff become neither old nor new, causing confusing behavior.

**Mitigation:**

- Migrate fixed strategy first。
- Then human gate resume。
- Supervisor P0: produce plan/decisions only。
- Supervisor P1: dispatch through common scheduler。
- Handoff P0 remains explicit rejection for unsupported features until wired。

**Exit:** tests fail if supervisor/handoff bypass common invocation port.

## R7 — Status taxonomy consolidation changes terminal behavior

**Severity:** Medium  
**Risk:** `timeout` and `crashed` semantics may change cleanup/server/cloud behavior.

**Mitigation:**

- Document translation table。
- Add tests for each subsystem。
- Update projections and GC together。

**Exit:** one canonical helper used by runtime/server/cloud/gc.

## R8 — Removing compatibility shim breaks external imports

**Severity:** Medium  
**Risk:** Some tests or user scripts may import `acc.app.core_v2_runtime`.

**Mitigation:**

- Grep all repo imports。
- Update internal imports first。
- Optionally release one deprecation cycle if public API matters。

**Exit:** no internal import remains; deletion documented.

## R9 — Server submission consolidation changes API responses

**Severity:** Medium  
**Risk:** runner/workflow routes may have subtle response differences.

**Mitigation:**

- Snapshot current API responses。
- Consolidate internals while preserving route DTOs initially。
- Then intentionally simplify DTOs with docs/tests.

**Exit:** server tests pass and response diffs are documented.

## R10 — Performance tests become flaky

**Severity:** Low  
**Risk:** Timing-based performance tests may fail nondeterministically.

**Mitigation:**

- Prefer structural assertions: count rebuild calls, count file scans, count manifest reads。
- Use monkeypatch/fake filesystem boundaries。
- Avoid wall-clock thresholds except broad smoke checks。

**Exit:** tests are deterministic in local hermetic mode.
