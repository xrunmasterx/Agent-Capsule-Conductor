# Capsule Template and Session Model

## 1. Definition

A **Capsule Template** is a static reusable Agent definition.

It answers:

```text
Who am I?
What can I do?
Which mature agent runtime do I use?
Which skills/rules/prompts/tools do I have?
What input/output contract do I obey?
```

A **Session** is one concrete execution of a Capsule Template.

It answers:

```text
What am I doing now?
Which workspace am I using?
What events happened?
What artifacts did I produce?
What was my final status?
```

## 2. C++ analogy

```cpp
class SourceRealityCheckAgent {
public:
    Runtime runtime = CodexCLI;
    Skills skills = {"source-reality-check"};
    PermissionPolicy permissions = ReadOnly;
    OutputSchema schema = SourceRealityCheckOutput;
};

SourceRealityCheckAgentSession sessionA(questionA);
SourceRealityCheckAgentSession sessionB(questionB);
```

The class is shared. The sessions are independent.

## 3. Why sessions must be isolated

If Session A analyzes GPU-driven rendering and Session B analyzes async compute, they should not share:

- conversation memory,
- temporary files,
- workspace mutations,
- event logs,
- output artifacts,
- error state.

They may share only explicit template assets and explicit input artifacts.

## 4. Required session manifest

Every session must write:

```json
{
  "session_id": "session_xxx",
  "capsule_id": "source-reality-check.codex",
  "capsule_version": "0.2.0",
  "status": "success",
  "run_dir": "runs/run_001/source_check",
  "workspace_dir": "runs/run_001/workspaces/source_check",
  "input_path": "input.json",
  "prompt_path": "resolved_prompt.md",
  "output_path": "output.json",
  "artifact_dir": "artifacts",
  "event_log_path": "events.jsonl"
}
```

## 5. Testing principle

The test suite must prove:

```text
same template -> multiple sessions -> isolated directories -> no state overwrite
```
