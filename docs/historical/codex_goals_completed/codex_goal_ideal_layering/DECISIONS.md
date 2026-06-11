# DECISIONS

## D1: Delete `acc.clean_workflow` after direct new-layer adoption

Decision:

- Initially keep public clean-core function names during migration, then delete `acc.clean_workflow` once CLI and tests directly depend on `acc.app`, `acc.engine`, and `acc.store`.

Reason:

- The public behavior matters more than preserving the old module body.
- After CLI/tests no longer import `acc.clean_workflow`, the facade no longer protects public behavior; it only adds another name for the same architecture.

Consequence:

- New tests should target new layers directly.
- `.accflow.json` CLI behavior is preserved, but the old module is removed.

## D2: Keep legacy graph runner until it is migrated, not because it is ideal

Decision:

- Refactor the `.accflow.json` clean-core path first.
- Do not delete `acc.workflow_runner` until `.graph.json` CLI/server/debugger/workbench paths have equivalent new-layer coverage.
- Superseded after that coverage existed: `acc.workflow_runner` is now deleted and `.graph.json`
  execution goes through `LegacyGraphImporter` plus `WorkflowAppService`.

Reason:

- `.graph.json` runner is larger and tied to capsule sessions, run index, server routes, and debugger behavior.
- Acceptance focuses on ideal-layering `.accflow.json` examples plus existing CLI/capsule contracts.

Consequence:

- `QUALITY_REPORT.md` must explicitly list `acc.workflow_runner` as removed and record the
  replacement path.

## D3: Normalize Phase 10 aliases at parse boundary

Decision:

- Accept `type` as an alias for `kind`.
- Accept `runner: fake` as a fake tool runner for ideal-layering examples.
- Preserve existing `kind/tool/runtime/workflow_ref` fields.

Reason:

- Current examples and current parser disagree.
- Parser normalization is the smallest compatibility-preserving fix.

Consequence:

- Existing `.accflow.json` fields remain valid.
- Phase 10 `ideal_layering_*` examples pass without requiring duplicate example files.

## D4: Keep `.graph.json` runner as legacy surface in this pass

Decision:

- Do not rewrite `acc.workflow_runner` during this `.accflow.json` layering pass.
- Superseded by the later legacy-runner unification pass: `.graph.json` remains supported, but
  the standalone runner module does not.

Reason:

- It is tied to capsule sessions, run summaries, debugger, server routes, and graph UI tests.
- The acceptance target can be satisfied by refactoring clean-core `.accflow.json` execution without destabilizing that older surface.

Consequence:

- `QUALITY_REPORT.md` documents `acc.workflow_runner` removal and the canonical app-service path.
