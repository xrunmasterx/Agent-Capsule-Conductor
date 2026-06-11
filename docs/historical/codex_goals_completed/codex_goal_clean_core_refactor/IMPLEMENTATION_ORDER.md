# Implementation Order

## Milestone 0: Baseline audit

- Run existing tests.
- Inspect current modules.
- Write FINDINGS.md.
- Decide keep/move/rewrite/delete.

## Milestone 1: Domain models and schemas

- WorkflowTemplate
- EnvironmentBinding
- EnvironmentFrame
- NodeSpec
- PortContract
- ControlEdge
- DataEdge
- ArtifactBundle

## Milestone 2: Validation

- template validation
- binding validation
- graph validation
- path safety validation

## Milestone 3: Environment runtime

- ephemeral workspace creation
- stateful binding resolution
- environment manifest
- behavior pack snapshot

## Milestone 4: Port IO

- inbox/outbox layout
- data edge materialization
- artifact bundle

## Milestone 5: Scheduler

- topological levels
- bounded concurrency
- workspace read/write locks
- failure modes
- retry/timeout

## Milestone 6: Node runners

- fake agent node
- fake tool node
- nested workflow node
- adapter reuse if clean

## Milestone 7: CLI/API boundary

- workflow validate
- workflow bind
- workflow run
- run inspect

## Milestone 8: Tests and acceptance

- unit tests
- integration tests
- security tests
- performance tests
- acceptance commands

## Milestone 9: Documentation

- QUALITY_REPORT.md
- MIGRATION_NOTES.md
- RISK_REGISTER.md
