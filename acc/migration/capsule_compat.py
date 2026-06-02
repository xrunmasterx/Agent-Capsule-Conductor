from __future__ import annotations

from acc.domain import (
    AgentClassTemplate,
    CallableRef,
    PermissionProfile,
    ToolClassTemplate,
    WorkflowFunctionTemplate,
)


def capsule_spec_to_callable_ref(capsule: dict) -> CallableRef:
    kind = str(capsule.get("kind") or "agent_session")
    capsule_id = str(capsule.get("id") or "")
    version = str(capsule.get("version") or "")
    if kind in {"agent_session", "agent_workflow", "external_workflow"}:
        return CallableRef(kind="agent_class", id=capsule_id, version=version)
    if kind == "atomic":
        return CallableRef(kind="tool_class", id=capsule_id, version=version)
    if kind == "acc_workflow":
        return CallableRef(kind="workflow_function", id=capsule_id, version=version)
    return CallableRef(kind="agent_class", id=capsule_id, version=version)


def capsule_spec_to_class_template(
    capsule: dict,
) -> AgentClassTemplate | ToolClassTemplate | WorkflowFunctionTemplate:
    kind = str(capsule.get("kind") or "agent_session")
    capsule_id = str(capsule.get("id") or "")
    version = str(capsule.get("version") or "")
    runtime = _mapping(capsule.get("runtime"))
    prompt = _mapping(capsule.get("prompt"))
    workflow = _mapping(capsule.get("workflow"))
    permissions = permission_profile_from_capsule(capsule)
    if kind in {"agent_session", "agent_workflow", "external_workflow"}:
        return AgentClassTemplate(
            id=capsule_id,
            version=version,
            runtime=str(runtime.get("type") or ""),
            default_prompt=_optional_string(prompt.get("template")),
            default_permissions=permissions,
            metadata={
                "legacy_capsule_kind": kind,
                "legacy_runtime": str(runtime.get("type") or ""),
            },
        )
    if kind == "atomic":
        return ToolClassTemplate(
            id=capsule_id,
            version=version,
            runner=str(runtime.get("type") or ""),
            default_permissions=permissions,
            metadata={
                "legacy_capsule_kind": kind,
                "legacy_runtime": str(runtime.get("type") or ""),
            },
        )
    if kind == "acc_workflow":
        return WorkflowFunctionTemplate(
            id=capsule_id,
            version=version,
            node_invocations={},
            control_edges=[],
            data_edges=[],
            metadata={
                "legacy_capsule_kind": kind,
                "legacy_workflow_type": workflow.get("type"),
                "legacy_workflow_path": workflow.get("path"),
            },
        )
    return AgentClassTemplate(
        id=capsule_id,
        version=version,
        runtime=str(runtime.get("type") or ""),
        default_prompt=_optional_string(prompt.get("template")),
        default_permissions=permissions,
        metadata={
            "legacy_capsule_kind": kind,
            "legacy_runtime": str(runtime.get("type") or ""),
        },
    )


def permission_profile_from_capsule(capsule: dict) -> PermissionProfile:
    permissions = _mapping(capsule.get("permissions"))
    workspace_access = "writes_workspace" if permissions.get("write_files") else "read_only"
    return PermissionProfile(
        workspace_access=workspace_access,
        network=bool(permissions.get("network")),
        shell=False,
        dangerous=bool(permissions.get("allow_dangerous"))
        or permissions.get("sandbox") == "danger-full-access",
        timeout_seconds=int(permissions.get("timeout_seconds") or 60),
    )


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None
