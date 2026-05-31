# Template and Session Model

## 1. Current Definition

The old phrase "Capsule Template and Session" is still useful, but the current architecture is more
precise:

```text
AgentClassTemplate / ToolClassTemplate = reusable class
WorkflowFunctionTemplate               = reusable function
NodeInvocationSpec                      = call site
FunctionInvocation                      = one workflow call
ScopeFrame                              = runtime scope for the call
SessionInstance                         = one agent/tool execution
```

A template answers:

```text
What behavior is reusable?
Which runtime/tool is used?
Which default prompt, permissions, ports, and output contract apply?
```

A runtime instance answers:

```text
Which invocation is running?
Which scope frame owns cwd/inbox/outbox/artifacts?
Which concrete node/session produced which evidence?
What was the final status?
```

## 2. C++ Analogy

```cpp
class SemiconductorNewsCollector {
public:
    Runtime runtime = CodexCLI;
    Prompt systemPrompt = "...";
    PermissionPolicy permissions = ReadOnlyNetworkOptional;
    OutputSchema schema = NewsDossier;
};

WorkflowFunctionTemplate semiconductorPipeline(...);

FunctionInvocation runA = semiconductorPipeline.call(inputA);
FunctionInvocation runB = semiconductorPipeline.call(inputB);
```

The definitions are shared. The invocations and sessions are independent.

## 3. Isolation Rule

Two sessions created from the same class must not implicitly share:

- conversation memory;
- temporary files;
- cwd mutations;
- inbox/outbox contents;
- event logs;
- artifacts;
- error state.

They may share only reusable class assets and explicitly bound input artifacts.

## 4. Runtime Evidence

Clean workflow runs should emit additive evidence such as:

```text
function_invocation_manifest.json
scope_frame_manifest.json
nodes/<node_id>/session_instance_manifest.json
nodes/<workflow_node>/workflow_call_manifest.json
events.jsonl
workflow_summary.json
```

Legacy `acc run` still emits `session_manifest.json` and `run_manifest.json`; these remain supported
compatibility artifacts.

## 5. Workbench Boundary

In the Workbench:

- resource-library Agent/Tool definitions are classes;
- task canvas nodes are invocation instances;
- system prompts belong to classes;
- user prompts, static input, and bindings belong to invocation nodes;
- node inspectors should read real run evidence, not placeholder UI state.

## 6. Testing Principle

The test suite must prove:

```text
same class/template -> multiple invocations/sessions -> isolated run directories -> no state overwrite
```
