# Implementation Order V2

Implement in this order.

## Milestone 1: Skeleton

Deliver:

- `pyproject.toml`
- `acc` package
- Typer CLI shell
- pytest setup
- ruff setup
- capsules/workflows/schema placeholders
- docs preserved

Tests:

```bash
uv run pytest -q
uv run ruff check .
```

## Milestone 2: Capsule Template schemas and registry

Deliver:

- Pydantic models for CapsuleTemplateSpec
- YAML loading
- capsule discovery
- `acc list`
- `acc show`
- `acc validate`

Tests:

- schema tests
- registry tests
- CLI list/show/validate tests

## Milestone 3: Session manifest and artifact store

Deliver:

- SessionManifest model
- session id generation
- run/session directory creation
- input snapshot
- prompt snapshot
- capsule snapshot
- session_manifest.json

Tests:

- session tests
- artifact store tests
- prompt rendering tests

## Milestone 4: Generic adapter and `acc run`

Deliver:

- base adapter interface
- generic CLI adapter
- echo-test capsule
- fake-agent fixture
- conductor stdout contract
- session inspect command

Tests:

- generic adapter tests
- CLI run stdout contract tests
- session inspect tests

## Milestone 5: Validation

Deliver:

- input schema validation
- output schema validation
- artifact manifest validation
- failure output contract
- session manifest final status update

Tests:

- output validation tests
- missing artifact tests
- failure mode tests

## Milestone 6: Codex adapter

Deliver:

- Codex CLI adapter
- command construction
- mocked subprocess tests
- source-reality-check.codex capsule

Tests:

- Codex adapter tests
- no real Codex required

## Milestone 7: Claude SDK adapter stub

Deliver:

- import guard
- unavailable handling
- fake SDK event capture test
- critical-review.claude capsule validates

Tests:

- Claude adapter tests skipped or mocked by default

## Milestone 8: Workspace manager

Deliver:

- existing_dir
- git_worktree_readonly
- git_worktree_write
- workspace manifest

Tests:

- workspace tests

## Milestone 9: Batch runner

Deliver:

- `acc batch-run`
- concurrency semaphore
- `bundle.json`
- fake-agent batch example
- each task creates independent session

Tests:

- batch runner tests

## Milestone 10: GraphOps dry-run control plane

Deliver:

- GraphOps patch schema
- `acc graphops validate-patch`
- `acc graphops apply-patch --dry-run`
- reject dangerous ops by default
- workflow-editor.codex capsule validates
- graph patch example

Tests:

- graphops validation tests
- dry-run no-mutation tests
- apply without human approval fails

## Milestone 11: Example workflows and docs

Deliver:

- `workflows/engine-architecture-research.v2.yaml`
- `workflows/meta-improve-workflow.v2.yaml`
- README
- acceptance commands all pass
