# Capsule Kind Spec

## 1. Purpose

Capsule kind distinguishes what the capsule wraps.

The runtime still defines how it is executed. The kind defines the semantic category.

## 2. Required kinds

### 2.1 `atomic`

A deterministic script or local operation.

Example:

```yaml
kind: atomic
runtime:
  type: generic_cli
```

### 2.2 `agent_session`

A single mature agent session.

Example:

```yaml
kind: agent_session
runtime:
  type: codex_cli
```

### 2.3 `agent_workflow`

A pre-built agent workflow directory, such as a Codex/Claude/Hermes workflow with skills, hooks, prompts, scripts, and rules.

Example:

```yaml
kind: agent_workflow
behavior_pack:
  root: behavior/
  files:
    - AGENTS.md
    - skills/
    - hooks/
    - prompts/
runtime:
  type: generic_cli
  command: scripts/run_workflow.py
```

Minimum implementation:

- validate behavior pack paths;
- snapshot behavior pack into session;
- run via configured runtime/adapter;
- do not require real external agent in default tests.

### 2.4 `acc_workflow`

An ACC workflow graph packaged as a capsule.

Example:

```yaml
kind: acc_workflow
workflow:
  type: acc_graph
  path: workflow.graph.json
```

Minimum implementation:

- validate nested workflow exists;
- run nested workflow through ACC workflow runner;
- map nested workflow output to parent capsule output;
- write nested workflow artifacts into the parent session artifact tree.

### 2.5 `external_workflow`

A workflow owned by another system, such as Microsoft Conductor.

Example:

```yaml
kind: external_workflow
workflow:
  type: conductor
  path: workflow.conductor.yaml
runtime:
  type: generic_cli
  command: conductor
```

Minimum implementation:

- validate workflow file exists;
- support dry-run/export validation;
- real execution optional and skipped unless tool exists.

## 3. CapsuleSpec additions

Recommended new fields:

```yaml
kind: agent_workflow
behavior_pack:
  root: behavior
  files: []
workflow:
  type: acc_graph|conductor|custom
  path: workflow.graph.json
lifecycle:
  setup: []
  run: []
  teardown: []
observability:
  event_policy: standard
  capture_stdout: true
  capture_stderr: true
```

## 4. Validation rules

- `kind` must be one of the supported values.
- `acc_workflow` must have `workflow.type=acc_graph` and a valid graph path.
- `agent_workflow` must have behavior pack validation or explicit runtime command.
- `external_workflow` must not require external tool in default validation.
- Dangerous permissions must remain opt-in.
