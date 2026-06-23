from __future__ import annotations

import pytest

from acc.models import (
    CORE_V2_SCHEMA_VERSION,
    AccError,
    ArtifactContract,
    CallableRef,
    ControlEdge,
    DataEndpoint,
    ExecutionNode,
    ExecutionPlan,
    NodeInputBinding,
    NodeInvocationSpec,
    PermissionProfile,
    RuntimePolicy,
    WorkflowFunctionTemplate,
    WorkflowOutputBinding,
)
from acc.validation import (
    validate_core_v2_execution_plan,
    validate_core_v2_workflow_function_template,
)


def valid_template() -> WorkflowFunctionTemplate:
    return WorkflowFunctionTemplate(
        id="valid",
        version="1.0.0",
        node_invocations={
            "producer": NodeInvocationSpec(
                id="producer",
                callable_ref=CallableRef(kind="tool_class", id="producer.local"),
            ),
            "consumer": NodeInvocationSpec(
                id="consumer",
                callable_ref=CallableRef(kind="agent_class", id="consumer.codex"),
                input_bindings=[
                    NodeInputBinding(source=DataEndpoint(node="producer", port="main"))
                ],
            ),
        },
        control_edges=[ControlEdge(source="producer", target="consumer")],
        data_edges=[],
        metadata={"label": "Valid"},
    )


def test_core_v2_validation_accepts_valid_workflow_function() -> None:
    validate_core_v2_workflow_function_template(valid_template())


def test_core_v2_validation_rejects_duplicate_execution_plan_node_id() -> None:
    node = NodeInvocationSpec(
        id="same",
        callable_ref=CallableRef(kind="tool_class", id="tool.local"),
    )
    plan = ExecutionPlan(
        workflow_function_id="dupe",
        schema_version=CORE_V2_SCHEMA_VERSION,
        nodes=(
            ExecutionNode(node_id="same", invocation=node),
            ExecutionNode(node_id="same", invocation=node),
        ),
        levels=(("same",),),
    )

    with pytest.raises(AccError, match="duplicate node id"):
        validate_core_v2_execution_plan(plan)


def test_core_v2_validation_rejects_missing_callable_ref_id() -> None:
    template = WorkflowFunctionTemplate(
        id="missing_ref",
        version="1.0.0",
        node_invocations={
            "node": NodeInvocationSpec(
                id="node",
                callable_ref=CallableRef(kind="tool_class", id=""),
            )
        },
        control_edges=[],
        data_edges=[],
    )

    with pytest.raises(AccError, match="CallableRef.id"):
        validate_core_v2_workflow_function_template(template)


def test_core_v2_validation_rejects_legacy_callable_kind() -> None:
    template = WorkflowFunctionTemplate(
        id="legacy_ref",
        version="1.0.0",
        node_invocations={
            "node": NodeInvocationSpec(
                id="node",
                callable_ref=CallableRef(kind="legacy_capsule", id="old"),
            )
        },
        control_edges=[],
        data_edges=[],
    )

    with pytest.raises(AccError, match="Unsupported Core v2 callable kind"):
        validate_core_v2_workflow_function_template(template)


def test_core_v2_validation_rejects_invalid_binding_source() -> None:
    template = WorkflowFunctionTemplate(
        id="bad_binding",
        version="1.0.0",
        node_invocations={
            "consumer": NodeInvocationSpec(
                id="consumer",
                callable_ref=CallableRef(kind="agent_class", id="consumer.codex"),
                input_bindings=[
                    NodeInputBinding(source=DataEndpoint(node="missing", port="main"))
                ],
            )
        },
        control_edges=[],
        data_edges=[],
    )

    with pytest.raises(AccError, match="missing source node"):
        validate_core_v2_workflow_function_template(template)


def test_core_v2_validation_rejects_invalid_artifact_path() -> None:
    template = WorkflowFunctionTemplate(
        id="bad_artifact",
        version="1.0.0",
        node_invocations={
            "node": NodeInvocationSpec(
                id="node",
                callable_ref=CallableRef(kind="tool_class", id="tool.local"),
                artifact_contract=ArtifactContract(required_paths=("../escape.txt",)),
            )
        },
        control_edges=[],
        data_edges=[],
    )

    with pytest.raises(AccError, match="unsafe artifact path"):
        validate_core_v2_workflow_function_template(template)


def test_core_v2_validation_rejects_invalid_permission_profile() -> None:
    template = WorkflowFunctionTemplate(
        id="bad_permission",
        version="1.0.0",
        node_invocations={
            "node": NodeInvocationSpec(
                id="node",
                callable_ref=CallableRef(kind="tool_class", id="tool.local"),
                runtime_policy=RuntimePolicy(
                    permission_profile=PermissionProfile(
                        workspace_access="root",  # type: ignore[arg-type]
                    )
                ),
            )
        },
        control_edges=[],
        data_edges=[],
    )

    with pytest.raises(AccError, match="invalid workspace_access"):
        validate_core_v2_workflow_function_template(template)


def test_core_v2_validation_rejects_invalid_workflow_output_binding() -> None:
    template = valid_template()
    bad = WorkflowFunctionTemplate(
        id=template.id,
        version=template.version,
        node_invocations=template.node_invocations,
        control_edges=template.control_edges,
        data_edges=template.data_edges,
        workflow_output_bindings=[
            WorkflowOutputBinding(
                source=DataEndpoint(node="missing", port="main"),
                target_port="report",
            )
        ],
    )

    with pytest.raises(AccError, match="Workflow output binding"):
        validate_core_v2_workflow_function_template(bad)


def test_core_v2_validation_rejects_executable_metadata_and_control_data() -> None:
    template = valid_template()
    bad = WorkflowFunctionTemplate(
        id=template.id,
        version=template.version,
        node_invocations=template.node_invocations,
        control_edges=[
            ControlEdge(source="producer", target="consumer", context="upstream_output")
        ],
        data_edges=template.data_edges,
        metadata={"run_dir": "runs/not-template-state"},
    )

    with pytest.raises(AccError, match="executable metadata"):
        validate_core_v2_workflow_function_template(bad)
