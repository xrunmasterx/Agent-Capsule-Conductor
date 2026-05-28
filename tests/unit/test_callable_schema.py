from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, ValidationError

from acc.utils import load_json

SCHEMA_FILES = [
    "schemas/agent_class_template_schema.json",
    "schemas/tool_class_template_schema.json",
    "schemas/workflow_function_template_schema.json",
    "schemas/node_invocation_spec_schema.json",
    "schemas/function_invocation_schema.json",
    "schemas/scope_frame_schema.json",
    "schemas/session_instance_schema.json",
]


def schema(path: str) -> dict[str, Any]:
    payload = load_json(Path(path))
    assert isinstance(payload, dict)
    Draft202012Validator.check_schema(payload)
    return payload


def validate(schema_path: str, payload: dict[str, Any]) -> None:
    Draft202012Validator(schema(schema_path)).validate(payload)


def test_callable_schema_files_are_valid_json_schema() -> None:
    for schema_path in SCHEMA_FILES:
        schema(schema_path)


def test_agent_class_template_schema_accepts_stateless_class() -> None:
    validate(
        "schemas/agent_class_template_schema.json",
        {
            "id": "source_analyzer.codex",
            "version": "0.1.0",
            "runtime": "codex_cli",
            "default_prompt": "Analyze source facts only.",
            "default_permissions": {
                "workspace_access": "read_only",
                "network": False,
                "shell": False,
                "dangerous": False,
            },
            "input_ports": {"brief": {"type": "artifact", "required": True}},
            "output_ports": {"report": {"type": "artifact", "required": True}},
            "artifact_contract": {},
        },
    )


def test_agent_class_template_schema_rejects_runtime_state() -> None:
    with pytest.raises(ValidationError):
        validate(
            "schemas/agent_class_template_schema.json",
            {
                "id": "source_analyzer.codex",
                "version": "0.1.0",
                "runtime": "codex_cli",
                "session_id": "session_001",
            },
        )


def test_tool_class_template_schema_accepts_runner_class() -> None:
    validate(
        "schemas/tool_class_template_schema.json",
        {
            "id": "merge_reports.local",
            "version": "0.1.0",
            "runner": "merge",
            "default_permissions": {
                "workspace_access": "writes_run_only",
                "network": False,
                "shell": False,
                "dangerous": False,
            },
            "input_ports": {"reports": {"type": "artifact", "cardinality": "many"}},
            "output_ports": {"bundle": {"type": "artifact"}},
        },
    )


def test_node_invocation_spec_schema_accepts_callable_ref_and_workflow_bindings() -> None:
    validate(
        "schemas/node_invocation_spec_schema.json",
        {
            "id": "subflow",
            "callable_ref": {
                "kind": "workflow_function",
                "id": "child_review",
                "version": "0.1.0",
            },
            "workflow_call_input_bindings": [
                {
                    "source": {"node": "plan", "port": "brief"},
                    "workflow_input": "question",
                    "materialization": "copy",
                }
            ],
            "workflow_call_output_bindings": [
                {
                    "workflow_output": "report",
                    "parent_port": "summary",
                    "materialization": "copy",
                }
            ],
        },
    )


def test_workflow_function_template_schema_rejects_workspace_path_state() -> None:
    with pytest.raises(ValidationError):
        validate(
            "schemas/workflow_function_template_schema.json",
            {
                "id": "architecture_review",
                "version": "0.1.0",
                "node_invocations": [],
                "control_edges": [],
                "data_edges": [],
                "workspace_root": "F:/Agent-Capsule-Conductor",
            },
        )


def test_function_invocation_scope_and_session_schema_accept_runtime_manifests() -> None:
    validate(
        "schemas/function_invocation_schema.json",
        {
            "invocation_id": "invocation_001",
            "workflow_function_id": "architecture_review",
            "run_id": "run_001",
            "status": "running",
            "input_payload": {},
            "root_scope_frame_id": "scope_001",
            "parent_invocation_id": None,
            "started_at": "2026-05-28T00:00:00Z",
            "ended_at": None,
        },
    )
    validate(
        "schemas/scope_frame_schema.json",
        {
            "frame_id": "scope_001",
            "invocation_id": "invocation_001",
            "parent_frame_id": None,
            "call_depth": 0,
            "workflow_id": "architecture_review",
            "workspace_root": "runs/run_001/environments/root_env/workspace",
            "environment_root": "runs/run_001/environments/root_env",
            "inbox_root": "runs/run_001/environments/root_env/.acc/inbox",
            "outbox_root": "runs/run_001/environments/root_env/.acc/outbox",
            "artifact_root": "runs/run_001/environments/root_env/.acc/artifacts",
            "behavior_snapshot_path": (
                "runs/run_001/environments/root_env/.acc/behavior_pack_snapshot.json"
            ),
            "ephemeral": True,
            "binding_path": None,
        },
    )
    validate(
        "schemas/session_instance_schema.json",
        {
            "session_id": "session_001",
            "invocation_id": "invocation_001",
            "scope_frame_id": "scope_001",
            "node_id": "source_check",
            "callable_ref": {"kind": "agent_class", "id": "source_analyzer.codex"},
            "callable_kind": "agent_class",
            "status": "success",
            "cwd": "runs/run_001/environments/root_env/workspace",
            "env_keys": ["ACC_RUN_DIR", "ACC_NODE_ID"],
            "input_path": "nodes/source_check/input.json",
            "output_path": "nodes/source_check/output.json",
            "artifact_dir": "nodes/source_check/artifacts",
            "event_log_path": "nodes/source_check/events.jsonl",
        },
    )
