# ACC Callable Semantics Design

## 1. Architecture

The target dependency flow remains:

```text
acc.cli / acc.server / web
        |
        v
acc.app
        |
        +--> acc.engine  ----> acc.domain
        |
        +--> acc.runtime ----> acc.domain / acc.ports
        |
        +--> acc.store   ----> acc.domain / acc.ports
        |
        +--> acc.ports
```

## 2. Responsibility split

### domain

Owns pure concepts and invariants:

- class templates,
- workflow function templates,
- node invocation specs,
- function invocations,
- scope frames,
- session instances,
- ports,
- artifact bundles,
- permission profiles,
- policies.

No IO, no process execution, no CLI/server/UI imports.

### engine

Owns semantic validation and planning:

- graph DAG validation,
- callable reference validation,
- data/control edge consistency,
- workflow input/output contract validation,
- nested workflow call boundary validation,
- recursion guard and max-depth validation,
- stateful nesting validation,
- materialization plan calculation.

No filesystem IO, no subprocess, no env reads.

### store

Owns filesystem persistence:

- function invocation manifests,
- scope frame manifests,
- session instance manifests,
- workflow/node events,
- inbox/outbox materialization,
- artifact bundles,
- path traversal protection.

Store does not run agents and does not decide graph semantics.

### runtime

Owns execution of one node instance:

- agent/tool execution,
- cwd enforcement,
- env whitelist,
- workspace write policy,
- timeout,
- retry attempt execution support,
- output/artifact validation hooks.

Runtime does not mutate workflow graph semantics and does not orchestrate nested workflow calls.

### app

Coordinates:

```text
load/normalize template
validate with engine
create FunctionInvocation and ScopeFrame via store
ask store to materialize input/inbox
ask runtime to execute sessions
ask store to persist output/artifacts/events
ask engine/apply policy to advance state
handle nested workflow calls through workflow_call service
```

## 3. Main execution flow

```text
1. app loads workflow file.
2. app normalizes legacy fields into WorkflowFunctionTemplate + NodeInvocationSpec.
3. engine validates callable semantics and graph semantics.
4. store creates function_invocation_manifest.json.
5. store creates root scope_frame_manifest.json.
6. engine/app computes ready levels.
7. for each ready node:
   a. store creates node attempt dirs,
   b. store materializes inbound data,
   c. app creates SessionInstance or WorkflowCall evidence,
   d. runtime runs agent/tool, or app invokes child workflow function,
   e. store writes outputs, outboxes, artifacts, events,
   f. engine/app applies result/failure policy.
8. store writes final workflow summary and manifests.
```

## 4. Nested workflow flow

```text
parent scope frame
  node invocation: kind=workflow
    create child FunctionInvocation
    create child ScopeFrame
    bind parent data to child exposed inputs
    run child workflow function
    bind child exposed outputs to parent workflow-node outbox
  downstream nodes consume parent workflow-node outbox
```

`upstream_context` may still be provided for control context, but data dependencies must flow through port bindings and artifacts.

## 5. App module split

If `acc.app.__init__` grows or remains too broad, split into:

```text
acc/app/workflow_service.py
acc/app/execution_loop.py
acc/app/node_invocation.py
acc/app/workflow_call.py
acc/app/legacy_compat.py
```

Preserve public imports through compatibility exports if needed.

