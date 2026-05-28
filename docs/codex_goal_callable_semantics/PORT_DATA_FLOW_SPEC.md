# Port And Data Flow Spec

## Core rule

All inter-node data transfer flows through:

```text
producer outbox -> store/scheduler materialization -> consumer inbox
```

Sender nodes must never write directly into receiver inboxes or workspaces.

## Port contracts

Ports define:

- id,
- direction,
- type,
- required flag,
- cardinality,
- materialization mode.

## Materialization modes

Allowed:

```text
copy
reference
symlink
```

`symlink` must be treated carefully on Windows and must never allow path traversal.

## Workflow function boundary

Workflow exposed inputs behave like function parameters.

Workflow exposed outputs behave like function returns.

Nested workflow calls must map:

```text
parent data -> child exposed input
child exposed output -> parent workflow-node outbox
```

## Validation

Engine must reject:

- data edge source not upstream in control graph,
- missing required input port,
- missing required output port,
- parent edge to child internal node,
- child dependency on unbound parent data,
- path traversal materialization target.

