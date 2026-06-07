# ACC Codex App-Server Runtime

## Conclusion

Core v2 agent nodes now run Codex through the streaming runtime
`codex_app_server`, which starts:

```text
codex app-server --listen stdio://
```

The old `codex_cli` / `codex exec` adapter remains as a compatibility implementation, but Core v2
agent-node execution maps Codex templates through `AgentTurnService` and records agent session/turn
evidence.

## Runtime Flow

```text
execute_core_v2_node
  -> AgentTurnService.run_workflow_node_turn
  -> CodexAppServerAdapter.run_turn
  -> initialize / initialized
  -> thread/resume or thread/start
  -> turn/start
  -> canonical ACC agent events
  -> output_draft.json
  -> schema validation
  -> node output.json
```

Provider-native JSON-RPC notifications are stored in `provider_events.jsonl`. ACC-owned timeline
events are stored in `events.jsonl` with canonical event types such as `agent_message`,
`agent_tool_use`, `agent_tool_result`, `agent_usage`, and `agent_turn_completed`.

## Session Evidence

Workflow node turns also create local-first session records under:

```text
runs/_agent_sessions/<run_id>/<node_id>/
```

These records are runtime evidence only. They must not be written back into
`AgentClassTemplate`, `WorkflowFunctionTemplate`, or `NodeInvocationSpec`.
