# Visual Workbench UX Refactor Spec

## 1. Product model

The Workbench must expose ACC's real concepts instead of mixing them in UI state.

```text
Resource Library
  AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate
  reusable, saved, mostly stateless

Task
  user-owned graph editing session
  persistent workbench authoring state

Canvas Node
  NodeInvocationSpec / agent instance
  task-local invocation configuration

Run Evidence
  FunctionInvocation / ScopeFrame / SessionInstance output
  read from manifests, artifacts, logs, events
```

## 2. Data ownership

### 2.1 Resource library owns class configuration

Editable in resource library:

- display name;
- capsule id;
- harness/runtime;
- model/default runtime settings if supported by capsule metadata;
- system prompt;
- input schema;
- output schema;
- artifact manifest;
- permissions.

The task node inspector must not edit these class-level fields directly.

### 2.2 Task owns invocation configuration

Persistent task state must include:

- task id;
- title;
- graph/canvas model;
- saved workflow ref if present;
- status;
- active run id;
- node positions;
- edges;
- workflow binding values;
- node user prompt/static input/input mapping.

Implementation may use a local JSON file through the server API or browser `localStorage` for the first hardening pass, but it must be explicit and tested. If `localStorage` is used, document it as local-browser persistence, not multi-user/shared persistence.

### 2.3 Runtime owns real evidence

The inspector must prefer runtime evidence over UI defaults:

- `input.json` for real resolved node input;
- `resolved_prompt.md` for prompt evidence;
- `output.json` for real node output;
- artifact manifest/list for artifacts;
- event and log files for timeline/debugging.

If evidence is absent, show an explicit empty/not-run state.

## 3. Input propagation semantics

Default control-edge mode must be understandable in plain language:

```text
control edge A -> B
  means B runs after A
  and B receives A's real output as default upstream context
```

The saved graph should express this as an explicit mapping/context rather than hidden UI behavior. Existing `context: upstream_output` is acceptable if the runner already supports it.

Boundary cases:

- No upstream: effective input/prompt context is empty.
- Multiple upstreams: show a clearly ordered list or keyed object.
- Failed upstream: downstream input must indicate unavailable/failed upstream unless the graph's failure policy allows continuation.

## 4. UI requirements

### 4.1 Navigation

The desktop sidebar is icon + label. Icon-only may be used only on narrow screens.

Required labels:

- 任务
- 资源
- 运行
- 产物
- 决策
- 控制面

All core visible labels must be valid Simplified Chinese, not mojibake.

### 4.2 Task list

The task list must support:

- create task;
- select task;
- persist task;
- delete task with trash button;
- show status;
- show saved workflow ref or unsaved marker;
- retain task state across navigation changes.

### 4.3 Resource/class editor

The resource library must support creating the three semiconductor agents. The class editor is the only default place to edit system prompt.

### 4.4 Node inspector

The node inspector must use progressive disclosure:

- default tab: human configuration and latest evidence;
- input tab: full effective input;
- output tab: full output;
- artifacts/logs tabs: evidence links;
- raw tab: raw graph/run JSON for advanced debugging.

Raw JSON/YAML must not be the default reading experience.

## 5. Cleanup rules

Allowed cleanup:

- remove UI default demo canvas from startup;
- remove generated run directories created only for manual demos;
- remove stale test-created duplicate capsules if no test references them;
- remove screenshots/evidence from prior failed manual runs if not referenced by docs.

Forbidden cleanup:

- deleting capsules/examples used by hermetic tests;
- deleting acceptance demo graphs required by existing goal docs;
- deleting schemas required by tests;
- deleting run fixtures referenced by UI tests unless tests are updated to use supported fixtures.

## 6. Test mode

Default acceptance must be hermetic:

- fake/local semiconductor data is allowed;
- no network required;
- no real market data required;
- no real Codex/Claude login required.

Optional real-agent test may be enabled by environment flag only.

## 7. Success criteria

The implementation succeeds only if a user can complete both semiconductor journeys from an empty Workbench without manual file editing, and the inspector shows real node input/output for every selected node.
