# Review Checklist

## Architecture

- [ ] Core boundaries are respected.
- [ ] UI/server does not duplicate core runtime logic.
- [ ] Workflow kernel does not implement agent reasoning/tool loop.
- [ ] Adapters do not print to stdout directly.
- [ ] GraphOps cannot apply unsafe changes without validation/approval.
- [ ] Conductor bridge is optional and does not become mandatory dependency.
- [ ] No unnecessary database/cloud dependency was introduced.
- [ ] Dependencies are minimal and justified.

## Capsule runtime

- [ ] Capsule registry handles duplicates deterministically.
- [ ] Capsule validate catches missing files.
- [ ] Input schema validation is enforced.
- [ ] Output schema validation is enforced.
- [ ] Required artifacts are enforced.
- [ ] Session/run directories are deterministic and inspectable.
- [ ] Failure runs still produce useful manifests/logs.

## Workflow kernel

- [ ] Cycle detection exists.
- [ ] Topological levels are correct.
- [ ] Parallel execution actually runs ready nodes concurrently where intended.
- [ ] Failure modes behave as documented.
- [ ] Node retry/timeout works.
- [ ] Data mappings are explicit and test-covered.
- [ ] Nested workflow capsule works or is clearly documented if deferred.
- [ ] Workflow events are emitted consistently.

## CLI contracts

- [ ] Machine-readable commands have clean stdout.
- [ ] Human-readable logs go stderr.
- [ ] `--json` and `--emit-json` outputs are valid JSON.
- [ ] Error outputs are stable and parseable.

## Browser UX

- [ ] UI is Chinese-first for main actions.
- [ ] User can see graph dependencies, not only button order.
- [ ] User can inspect node input/output/artifacts/logs.
- [ ] User can see serial vs parallel structure.
- [ ] Validation errors are understandable.
- [ ] Browser E2E captures screenshots and logs.

## Security

- [ ] No path traversal in file APIs.
- [ ] Subprocess commands avoid shell=True unless justified.
- [ ] Dangerous permissions are opt-in.
- [ ] Secrets are not logged.
- [ ] GraphOps privilege escalation is blocked.
- [ ] Artifacts API cannot read arbitrary host files.

## Performance

- [ ] Graph algorithms are O(V+E) where possible.
- [ ] Large files/events are streamed or bounded.
- [ ] Registry scans are not repeated unnecessarily in hot paths.
- [ ] Browser handles demo graphs smoothly.
- [ ] Benchmarks or complexity notes exist for critical paths.
