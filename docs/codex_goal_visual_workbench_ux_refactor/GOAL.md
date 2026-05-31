# Goal: Visual Workbench UX Refactor and Semiconductor Workflow Acceptance

## Objective

Refactor the existing ACC Workbench into a practical Chinese-first graph workbench that preserves the clean ACC runtime contracts while fixing the current usability defects reported by the user.

The core user outcome is:

```text
Create reusable Agent classes in the resource library
  -> instantiate them as nodes inside persistent tasks
  -> connect nodes visually
  -> run the graph
  -> click each node and inspect the real resolved input and full real output
  -> create a nested workflow bound to F:\ACCTest\1
  -> pass nested workflow output into an outer analysis agent
```

This goal is a quality/UX refactor, not a new runtime or a demo expansion.

## First-principles diagnosis

The current problem is not one UI bug. It is a mismatch between the product concepts and the UI state model:

1. **Resource library state is class state.**
   Agent system prompt, harness/model defaults, schemas, and artifact contracts belong to saved reusable classes: `AgentClassTemplate` / capsule templates.

2. **Task canvas state is invocation state.**
   A node dragged into a task is a `NodeInvocationSpec` / agent instance. It may configure user prompt, static input, input mapping, cwd/workflow binding, and run evidence, but it must not mutate the class system prompt by accident.

3. **Run evidence is runtime state.**
   Node input, prompt, output, artifacts, logs, status, runtime, and errors must come from real run manifests and artifact files, not from decorative UI placeholders.

4. **Tasks need a source of truth.**
   A task list stored only in React component memory is not persistent. Switching UI tabs unmounts the workbench and loses newly created tasks. Task state must be persisted unless the user explicitly deletes it.

5. **Examples and acceptance fixtures are not the same as UI demo clutter.**
   UI startup should not force old demo nodes onto the canvas, but hermetic examples required by tests must not be deleted blindly.

## Must deliver

### 1. Clean default workbench state

- Remove default loaded demo/instance nodes from the task canvas.
- Remove stale intermediate run artifacts generated only by prior manual demos when they are not required by tests.
- Keep hermetic fixtures and examples that existing tests/acceptance commands depend on.
- The first screen should show an empty or user-owned task, not `Workspace Canvas Demo`.

### 2. Left navigation labels and style

- The left navigation must show icon + readable Chinese label beside each icon.
- Use a calm, dark, high-end engineering-tool style inspired by the provided Hiveward screenshot, adapted to ACC.
- Avoid icon-only navigation as the default desktop layout.
- Keep labels concise:
  - 任务
  - 资源
  - 运行
  - 产物
  - 决策
  - 控制面

### 3. Persistent tasks

- Creating a new task must persist it across:
  - switching between left navigation views;
  - reopening the Workbench component;
  - browser refresh if local persistence is used.
- Each task row must include a delete/trash action.
- Deleting a task must require an explicit click on the trash button.
- Runtime status, active run id, graph nodes, edges, workflow bindings, and selected saved workflow reference must survive task switching.
- Do not hide failed/running/success state when switching tasks.

### 4. Resource library vs task instance separation

- The resource library is where reusable Agent classes are created and edited.
- System prompt is editable only in the resource/class editor.
- A task node instance must not expose system prompt editing by default.
- A task node instance may expose:
  - user prompt;
  - static input;
  - input mapping;
  - inherited capsule id;
  - runtime/harness/model readout;
  - workspace/workflow binding where applicable;
  - run evidence.

### 5. Useful node property panel

When a user clicks an agent node, the right panel must focus on human-configurable and runtime-relevant fields:

- Agent name and capsule id.
- Harness/runtime.
- Model if present in capsule metadata.
- User prompt for this invocation.
- Static input.
- Input mapping.
- Effective resolved input:
  - in default control-edge mode, upstream node real output is passed as prompt/input context;
  - if there is no upstream, show empty input clearly.
- Full real output:
  - read from `output.json` or equivalent node output artifact;
  - do not truncate silently;
  - large output may be styled and scrollable, but must remain fully accessible.
- Artifact/log links.
- Status, duration, session/run paths.

### 6. Semiconductor acceptance workflow

Create or support creating these saved reusable agents:

1. `半导体股市信息收集`
   - Purpose: collect at least 20 semiconductor-related stock market news items.

2. `半导体股市信息清洗`
   - Purpose: clean upstream semiconductor stock news and select the 5 highest-value items.

3. `半导体股市分析和建议`
   - Purpose: analyze the current semiconductor market based on upstream high-value information and provide operation suggestions.

The default acceptance run may use hermetic fake/local data unless an explicit external-agent smoke flag is enabled. The UI must still show the same input/output contracts and run evidence.

### 7. End-to-end task journey

Journey A:

```text
Create new task
  -> add the three semiconductor agents to the canvas
  -> connect: collect -> clean -> analyze
  -> run
  -> click each node
  -> verify the right panel shows correct real input and full real output
```

Journey B:

```text
Create new task
  -> create a nested workflow bound to F:\ACCTest\1
  -> inside it add collect -> clean
  -> connect nested workflow output to outer analyze agent
  -> run
  -> click internal and external nodes
  -> verify real input/output display for every node
```

### 8. Browser usability hardening

Use browser automation or Playwright to run the two journeys from zero. If the mouse/keyboard flow exposes friction, fix the UX rather than documenting workarounds.

Each browser run must record:

- journey name;
- exact steps;
- pass/fail;
- screenshot or evidence path;
- console errors;
- network errors;
- usability issues found;
- fixes made and rerun result.

## Non-goals

Do not implement:

- a new LLM agent loop;
- a new autonomous scheduler;
- Dify/LangGraph-style low-level agent builder;
- a database/cloud/SaaS backend;
- AI auto-apply graph mutations;
- real external Codex/Claude/network dependency in default tests.

## Completion condition

This goal is complete only when:

- every command in `ACCEPTANCE.md` passes;
- browser journeys A and B pass or a concrete blocker is recorded;
- task persistence is verified;
- UI default Chinese text is readable and not mojibake;
- no critical/high finding in `FINDINGS.md` remains unresolved;
- `QUALITY_REPORT.md` documents changes, deleted demo artifacts, test evidence, browser evidence, and remaining risks.
