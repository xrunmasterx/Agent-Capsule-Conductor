# Workflow As Function Spec

## Rule 1: Saved workflow functions are stateless

A `WorkflowFunctionTemplate` may contain graph structure, callable references, port contracts, default policies, and metadata. It must not contain:

- local absolute workspace paths,
- run directories,
- session ids,
- prior outputs,
- agent conversation memory,
- machine-specific credentials,
- mutable invocation state.

## Rule 2: Workspace is a function-call argument

Runtime workspace comes from:

```text
explicit --workspace
explicit binding file
inherited parent scope frame
run-scoped ephemeral workspace
```

The default is run-scoped ephemeral workspace, not the ACC install directory.

## Rule 3: Workflow node calls a workflow function

A workflow node is not a magic capsule. It is a function call:

```text
workflow_ref + input bindings + output bindings + environment policy
```

## Rule 4: Inputs and returns are explicit

Parent-to-child input:

```text
parent node input / parent inbox / parent workflow input
  -> child exposed input port
```

Child-to-parent return:

```text
child exposed output port
  -> parent workflow-node output port
  -> parent workflow-node outbox
```

## Rule 5: Child internals are private

The parent workflow may connect to the workflow node's declared output ports only. It may not connect to internal child node ids.

## Rule 6: Call depth is bounded

Default engine validation must enforce a max depth. The default recommended value is 2 unless the implementation already has a safer value. Deeper nesting requires an explicit policy and a recursion guard.

## Rule 7: Recursion is rejected by default

Any workflow function call chain that repeats the same workflow function id is rejected unless the policy explicitly allows recursion and defines a finite max depth.

