# Capsule and Node Spec

## BaseCapsule

BaseCapsule is abstract. It is not directly instantiated.

## Node kinds

Use these primary node kinds:

```text
agent
tool
workflow
```

Previous capsule kinds may exist as compatibility wrappers but should not be the core model.

## Agent node

Agent node starts an external mature agent session.

Supported concepts:

- runtime
- prompt
- effective cwd
- behavior pack policy
- permissions
- input ports
- output ports
- session manifest
- event log

## Tool node

Tool node runs deterministic logic.

Tool types:

- python_script
- shell_script
- if
- for_each
- merge
- wait

## Workflow node

Workflow node invokes a nested workflow.

A Workflow node must expose ports just like any other node.

The parent workflow must not depend on the child's internal node details.

## Deprecated flat kinds

The old flat kinds:

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

may be mapped as follows:

- atomic -> tool
- agent_session -> agent
- agent_workflow -> agent with behavior_pack/lifecycle
- acc_workflow -> workflow
- external_workflow -> workflow with external runner

If keeping them creates complexity, remove them and document migration.
