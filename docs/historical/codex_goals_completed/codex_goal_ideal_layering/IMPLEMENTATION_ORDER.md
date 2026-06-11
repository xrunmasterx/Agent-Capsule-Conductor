# Implementation Order

## Milestone 0: Baseline and findings

- Run current tests.
- Create FINDINGS.md.
- Identify old modules and responsibilities.

## Milestone 1: Domain and ports

- Implement domain models.
- Implement protocol interfaces.
- Add domain purity tests.

## Milestone 2: Engine

- Implement graph validation.
- Implement level computation.
- Implement scheduling state transitions.
- Implement failure/retry policy tests.

## Milestone 3: Store

- Implement filesystem store.
- Implement inbox/outbox materialization.
- Implement event logs and artifact bundle writer.
- Add path traversal and retry cleanup tests.

## Milestone 4: Runtime

- Implement FakeNodeRunner and basic ToolNodeRunner.
- Implement PermissionProfile enforcement.
- Implement env whitelist.
- Add security negative tests.

## Milestone 5: App service

- Orchestrate engine/store/runtime.
- Add serial/parallel/failure/nested integration tests.

## Milestone 6: CLI migration

- Route CLI through app service.
- Preserve or document migration of commands.
- Validate stdout contracts.

## Milestone 7: Cleanup and reports

- Remove obsolete modules or reduce them to clear facades.
- Update MIGRATION_NOTES.md.
- Update QUALITY_REPORT.md.
- Run all acceptance.
