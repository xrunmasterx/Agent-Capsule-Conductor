# Agent Capsule Conductor V2 Design

## 1. Architecture

```text
Microsoft Conductor
  script step
      |
      v
acc run <capsule_id>
      |
      v
Capsule Template Registry
      |
      v
Session Factory
      |
      v
Capsule Runner
      |
      +--> Session / Artifact Store
      +--> Workspace Manager
      +--> Prompt Renderer
      +--> Adapter Layer
                |
                +--> Generic CLI
                +--> Codex CLI
                +--> Claude SDK
      |
      v
session_manifest.json + output.json + artifacts + conductor_output.json
```

Conductor owns deterministic workflow topology.

`acc` owns template instantiation and session execution boundary.

External agents own their internal reasoning/tool loop.

## 2. First-principles model

The key separation is:

```text
Capsule Template = who I am
Session          = what I am doing now
```

C++ analogy:

```cpp
class AgentTemplate {
  Runtime runtime;
  BehaviorPack behavior;
  PermissionPolicy permissions;
  Schema inputSchema;
  Schema outputSchema;
};

class AgentSession {
  AgentTemplate* templateRef;
  SessionId id;
  Workspace workspace;
  EventLog events;
  ArtifactBundle artifacts;
};
```

The same template can create many independent sessions:

```text
source-reality-check.codex
  -> session A: analyze GPU-driven visibility
  -> session B: analyze async compute
  -> session C: analyze streaming system
```

Each session has isolated run directory and workspace. It must not leak runtime state into another session unless explicit shared artifacts are passed.

## 3. Component responsibilities

### 3.1 Capsule Template Registry

Loads templates from:

```text
capsules/*/capsule.yaml
```

Responsibilities:

- discover templates,
- load YAML,
- validate Pydantic schema,
- resolve paths,
- expose template metadata,
- reject invalid dangerous permissions.

### 3.2 Session Factory

Responsibilities:

- generate `session_id`,
- create session directory,
- snapshot template,
- bind input payload,
- prepare initial `session_manifest.json`,
- ensure session isolation.

### 3.3 Capsule Runner

Responsibilities:

- validate input,
- render prompt,
- prepare workspace,
- choose adapter,
- run adapter,
- validate output,
- validate artifacts,
- finalize session manifest,
- emit Conductor JSON.

### 3.4 Artifact Store

Responsibilities:

- create run/session directory,
- write input snapshot,
- write prompt snapshot,
- write capsule snapshot,
- write stdout/stderr/events,
- write session manifest,
- write conductor output.

### 3.5 Workspace Manager

Modes:

- `existing_dir`: use provided path.
- `git_worktree_readonly`: create git worktree and avoid writes where possible.
- `git_worktree_write`: create git worktree branch for modifications.

### 3.6 Adapter Layer

Common interface:

```python
class AgentAdapter(Protocol):
    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        ...
```

Adapters must not print to stdout directly.

### 3.7 GraphOps Control Plane

GraphOps is the controlled interface that lets a higher-level LLM assist workflow/capsule editing.

Important boundary:

```text
LLM can propose patches.
Human approves patches.
acc validates and applies patches.
```

GraphOps does not replace Conductor. It edits workflow/template assets that Conductor later runs.

Supported patch targets:

```text
workflow
capsule_template
prompt_template
artifact_manifest
schema
```

Supported operations:

```text
add_node
remove_node
connect_nodes
update_node_input
update_capsule_prompt
update_capsule_permission
add_artifact_requirement
replace_schema
```

Forbidden by default:

```text
enable_danger_full_access
remove_human_gate
disable_tests
write_secret_files
change_git_remote
```

## 4. Brain-Hand Decoupling Pattern

Do not force one session to plan, execute, remember, review, and mutate the workflow.

Prefer role separation:

```text
Planner Capsule
  creates task plan / graph patch proposal

Executor Capsule
  runs in sandbox / worktree

Reviewer Capsule
  checks output and risks

Human Gate
  approves/rejects
```

This reduces:

- memory bloat,
- environment pollution,
- config drift,
- hard-to-debug session state,
- accidental workflow self-corruption.

## 5. Data model

### CapsuleTemplateSpec

Fields:

- id
- version
- name
- description
- runtime
- behavior_pack
- workspace
- permissions
- prompt
- schema
- artifacts
- session_policy
- graphops_policy

### SessionManifest

Fields:

- session_id
- capsule_id
- capsule_version
- status
- created_at
- updated_at
- run_dir
- workspace_dir
- input_path
- prompt_path
- output_path
- artifact_dir
- event_log_path
- conductor_output_path
- parent_workflow_run_id
- parent_node_id

### AgentRunRequest

Fields:

- capsule_id
- session_id
- run_dir
- workspace_dir
- prompt_path
- input_payload
- output_schema_path
- timeout_seconds
- env

### AgentRunResult

Fields:

- status
- summary
- output_json_path
- event_log_path
- artifacts_dir
- exit_code
- error

## 6. Adapter designs

### GenericCliAdapter

Runs an arbitrary command.

Expected behavior:

- writes stdout to `stdout.log`,
- writes stderr to `stderr.log`,
- if command produces JSON stdout, it may become `output.json`,
- if `output.json` already exists, use that,
- otherwise fail.

### CodexCliAdapter

Builds command roughly equivalent to:

```bash
codex exec \
  --cd <workspace> \
  --sandbox <sandbox> \
  --json \
  --output-schema <output_schema.json> \
  -o <run_dir>/output.json \
  -
```

Capture:

- stdout -> `events.jsonl`,
- stderr -> `stderr.log`,
- `-o` output -> `output.json`.

Default tests must mock subprocess execution.

### ClaudeSdkAdapter

Required MVP behavior:

- import guard,
- if `claude-agent-sdk` is unavailable, report clear unavailable error,
- tests must not require real Claude credentials.

Future behavior:

- call Claude Agent SDK,
- support allowed tools,
- support disallowed tools,
- support permission mode,
- support structured output,
- capture SDK messages to `events.jsonl`.

## 7. Conductor integration

Conductor script steps capture stdout/stderr/exit code and can parse JSON stdout into downstream fields. In strict output mode, stdout must be a single JSON object and logs must go to stderr.

Therefore `acc run --emit-conductor-json` must reserve stdout exclusively for one JSON object.

## 8. Error model

Possible statuses:

- `created`
- `running`
- `success`
- `failed`
- `timeout`
- `schema_error`
- `artifact_error`
- `unavailable`

Failures must still produce:

- `session_manifest.json`,
- `stderr.log`,
- `conductor_output.json`.

## 9. Batch runner

`batch-run` accepts:

```json
{
  "tasks": [
    {
      "capsule_id": "fake-agent.generic",
      "input": "examples/input1.json"
    }
  ],
  "max_concurrency": 3
}
```

It produces:

```text
batch_run_dir/
  bundle.json
  tasks/
    task_001/
    task_002/
```

Each task is a separate session.

## 10. MVP boundaries

The MVP is complete without real Claude/Gemini/Cursor integration as long as:

- adapters exist as extension points,
- default tests are hermetic,
- Codex adapter command construction and mocked execution are tested,
- Generic adapter can run real local fake-agent scripts,
- Template/session separation is implemented and tested,
- GraphOps validate/dry-run is implemented and tested.
