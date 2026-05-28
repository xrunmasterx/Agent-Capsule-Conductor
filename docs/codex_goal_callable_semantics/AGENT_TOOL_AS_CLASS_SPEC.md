# Agent And Tool As Class Spec

## Agent class

An agent class is a reusable behavior definition. It may describe:

- runtime adapter,
- prompt template,
- rules,
- skills,
- behavior pack,
- default permissions,
- input/output schemas,
- artifact contract.

It must not store:

- session id,
- conversation memory from a prior run,
- run dir,
- output artifact paths from a prior run,
- local absolute workspace path.

## Tool class

A tool class is a reusable deterministic/local execution definition. It may describe:

- runner,
- command template if applicable,
- input/output ports,
- default permissions,
- artifact contract.

It must not store invocation state.

## Node invocation

A workflow uses a class by creating a `NodeInvocationSpec`.

Node invocation may provide:

- callable ref,
- static input,
- local prompt override,
- permission override within policy,
- retry policy,
- timeout policy,
- port binding.

Node invocation must not become a session.

## Session instance

Runtime creates a session instance when an agent/tool node runs.

The session owns:

- session id,
- cwd,
- env,
- input snapshot,
- output,
- artifacts,
- events,
- status,
- errors.

## Compatibility with capsules

Existing capsules remain valid. The compatibility layer maps them to class semantics. This goal must not break `acc run <capsule_id>`.

