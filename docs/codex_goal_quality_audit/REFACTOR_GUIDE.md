# Refactor Guide

## Refactor only with a reason

Allowed reasons:

- remove duplication;
- isolate unsafe code;
- preserve public contract while simplifying internals;
- improve testability;
- improve algorithmic complexity;
- fix a bug or race;
- reduce dependency coupling.

Disallowed reasons:

- style-only large rewrite;
- personal preference;
- chasing perfect architecture;
- replacing working modules with a new framework;
- making UI prettier without QA finding.

## Preferred refactors

### Extract pure functions

Good for:

- graph validation;
- path validation;
- event parsing;
- output contract validation;
- risk classification.

### Separate IO from logic

Good pattern:

```text
load file -> pure validate -> write report
```

Bad pattern:

```text
validator reads/writes files, mutates graph, prints logs, and returns partial state
```

### Preserve adapter boundary

Adapters should call external tools and capture output. They should not own workflow logic.

### Preserve workflow/capsule boundary

Workflow Kernel schedules nodes. Capsule Runtime runs one node/session.

### Avoid god objects

If a class does registry + workflow + artifact + UI + subprocess, split it.

## Refactor reporting

Every nontrivial refactor must be recorded in `FIXLOG.md` with:

- files changed;
- reason;
- behavior preserved;
- tests run.
