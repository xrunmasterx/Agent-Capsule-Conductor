# ACC Architecture Proof Obligations

## Status

Architecture claims are requirements only when they have proof obligations. This document maps ACC target invariants to tests, static checks, runtime checks, and accepted deviations.

## SPEC

Every target invariant must have at least one proof:

- documentation reference check;
- static import/code check;
- schema validation;
- unit test;
- integration test;
- projection snapshot test;
- migration/rejection fixture;
- performance regression test.

Accepted deviations must be listed in `docs/architecture/07-compatibility-and-migration.md` with deletion conditions.

## Proof Matrix

| Invariant | Proof obligation |
| --- | --- |
| ACC does not implement LLM loop | adapter tests show external runtime boundary; no scheduler-owned tool-calling loop |
| definitions are stateless | schema/unit tests reject run/session/workspace/provider/conversation/UI keys |
| invocations are run-scoped | integration tests verify invocation/scope/session manifests are run-local evidence |
| control != data | tests reject control-only payload forwarding; binding manifest covers every payload key |
| one substrate for control modes | fixed/supervisor/handoff/human gate tests dispatch through common invocation port |
| agent nodes are workflow-unaware | adapter envelope tests exclude raw topology by default |
| low coupling through explicit context | static check forbids runtime `Path.cwd()` fallback where context is required |
| scheduler owns aggregation | tests ensure node execution returns immutable result; no shared output mutation |
| runtime evidence is truth | projection tests derive from evidence; UI state cannot mutate run truth |
| Workbench projection boundary | TS/tests use projection fixtures; raw evidence only through debug APIs |
| incremental projections | performance tests prevent full rebuild/polling in ordinary mutation/idle paths |
| single status taxonomy | static check blocks duplicate status sets; unit tests verify translations |
| single invocation path | tests ensure agent/tool/workflow/hermetic execution routes through `CallableInvocationPort` |
| bounded compatibility | migration/rejection tests cover legacy formats; deletion candidates tracked |

## Static Checks

Recommended checks:

- no new imports from `acc.app.core_v2_runtime`;
- no duplicate `TERMINAL_RUN_STATUSES` definitions outside canonical status module;
- no route-level runtime graph preparation helpers in HTTP route modules;
- no active loader accepts runtime/session/workspace metadata keys;
- no runtime/nested workflow/registry project-root lookup via `Path.cwd()` when context exists;
- no Workbench standard component props include raw runtime manifest-only fields;
- no supervisor/handoff code directly invokes adapters outside invocation port.

## Runtime Checks

- binding manifest completeness;
- adapter capability envelope sanitization;
- explicit result refs for downstream data;
- event stream monotonic ids;
- projection schema validation;
- run summary/index update scope;
- status transition legality.

## Test Families

| Family | Purpose |
| --- | --- |
| unit | schema, status, binder, control strategy, adapter envelope |
| integration | fixed workflow, nested workflow, human gate, supervisor, handoff |
| server | submission service, projection endpoints, route boundaries |
| web | projection fixture rendering, live event hooks, debug disclosure |
| performance | storage refresh, event tails, stream idle scans, result projection |
| migration | legacy graph/callable conversion and rejection |

## IMPLEMENTATION_ORDER

1. Add documentation reference checker.
2. Add tests for currently healthy invariants.
3. Add failing/xfail-marked tests for known deviations.
4. Resolve deviations in migration order.
5. Remove xfail/deviation entries after implementation.
6. Generate proof-obligation report in quality gate.

## ACCEPTANCE / TEST_PLAN

- CI/local quality gate can report pass/fail per invariant.
- Every accepted deviation appears in compatibility doc with deletion condition.
- Any new control mode, evidence schema, or compatibility exception adds or updates proof obligations.
- Documentation-only architecture changes update this proof matrix when they create or modify invariants.
