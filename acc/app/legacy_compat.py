from __future__ import annotations

from acc.domain import (
    AgentClassTemplate,
    CallableRef,
    PermissionProfile,
    ToolClassTemplate,
    WorkflowFunctionTemplate,
)
from acc.schemas import CapsuleSpec


def capsule_spec_to_callable_ref(capsule: CapsuleSpec) -> CallableRef:
    kind = capsule.kind or "agent_session"
    if kind in {"agent_session", "agent_workflow"}:
        return CallableRef(kind="agent_class", id=capsule.id, version=capsule.version)
    if kind == "atomic":
        return CallableRef(kind="tool_class", id=capsule.id, version=capsule.version)
    if kind == "acc_workflow":
        return CallableRef(kind="workflow_function", id=capsule.id, version=capsule.version)
    return CallableRef(kind="legacy_capsule", id=capsule.id, version=capsule.version)


def capsule_spec_to_class_template(
    capsule: CapsuleSpec,
) -> AgentClassTemplate | ToolClassTemplate | WorkflowFunctionTemplate:
    kind = capsule.kind or "agent_session"
    permissions = permission_profile_from_capsule(capsule)
    if kind in {"agent_session", "agent_workflow"}:
        return AgentClassTemplate(
            id=capsule.id,
            version=capsule.version,
            runtime=capsule.runtime.type,
            default_prompt=capsule.prompt.template if capsule.prompt is not None else None,
            default_permissions=permissions,
            metadata={
                "legacy_capsule_kind": kind,
                "legacy_runtime": capsule.runtime.type,
            },
        )
    if kind == "atomic":
        return ToolClassTemplate(
            id=capsule.id,
            version=capsule.version,
            runner=capsule.runtime.type,
            default_permissions=permissions,
            metadata={
                "legacy_capsule_kind": kind,
                "legacy_runtime": capsule.runtime.type,
            },
        )
    if kind == "acc_workflow":
        return WorkflowFunctionTemplate(
            id=capsule.id,
            version=capsule.version,
            node_invocations={},
            control_edges=[],
            data_edges=[],
            metadata={
                "legacy_capsule_kind": kind,
                "legacy_workflow_type": capsule.workflow.type if capsule.workflow else None,
                "legacy_workflow_path": capsule.workflow.path if capsule.workflow else None,
            },
        )
    return ToolClassTemplate(
        id=capsule.id,
        version=capsule.version,
        runner=capsule.runtime.type,
        default_permissions=permissions,
        metadata={
            "legacy_capsule_kind": kind,
            "legacy_runtime": capsule.runtime.type,
        },
    )


def permission_profile_from_capsule(capsule: CapsuleSpec) -> PermissionProfile:
    workspace_access = "writes_workspace" if capsule.permissions.write_files else "read_only"
    return PermissionProfile(
        workspace_access=workspace_access,
        network=capsule.permissions.network,
        shell=False,
        dangerous=capsule.permissions.allow_dangerous
        or capsule.permissions.sandbox == "danger-full-access",
        timeout_seconds=capsule.permissions.timeout_seconds,
    )
