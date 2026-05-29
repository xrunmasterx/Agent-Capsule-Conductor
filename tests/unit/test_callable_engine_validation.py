from __future__ import annotations

import time
from pathlib import Path

import pytest

from acc.domain import (
    CallableRef,
    CallDepthPolicy,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    NodeInvocationSpec,
    PortContract,
    WorkflowCallInputBinding,
    WorkflowCallOutputBinding,
    WorkflowFunctionTemplate,
)
from acc.engine import validate_callable_workflow_function, validate_workflow_call_contract
from acc.utils import AccError


def tool_node(node_id: str) -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id=node_id,
        callable_ref=CallableRef(kind="tool_class", id=f"{node_id}.tool"),
        output_ports={"main": PortContract(id="main", direction="output")},
    )


def workflow_node(node_id: str, workflow_id: str = "child") -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id=node_id,
        callable_ref=CallableRef(kind="workflow_function", id=workflow_id),
        input_ports={"brief": PortContract(id="brief", direction="input")},
        output_ports={"summary": PortContract(id="summary", direction="output")},
        workflow_call_input_bindings=[
            WorkflowCallInputBinding(
                source=DataEndpoint(node="producer", port="main"),
                workflow_input="brief",
            )
        ],
        workflow_call_output_bindings=[
            WorkflowCallOutputBinding(
                workflow_output="report",
                parent_port="summary",
            )
        ],
    )


def valid_callable_template() -> WorkflowFunctionTemplate:
    return WorkflowFunctionTemplate(
        id="parent",
        version="0.1.0",
        node_invocations={
            "producer": tool_node("producer"),
            "subflow": workflow_node("subflow"),
        },
        control_edges=[ControlEdge(source="producer", target="subflow")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="producer", port="main"),
                target=DataEndpoint(node="subflow", port="brief"),
            )
        ],
        source_path=Path("parent.accflow.json"),
    )


def test_callable_workflow_validation_accepts_explicit_function_call_boundary() -> None:
    validate_callable_workflow_function(valid_callable_template())


def test_callable_workflow_validation_rejects_unknown_callable_ref() -> None:
    template = valid_callable_template()

    with pytest.raises(AccError, match="Unknown callable reference"):
        validate_callable_workflow_function(
            template,
            known_callable_refs={
                ("tool_class", "producer.tool"),
                ("workflow_function", "other_child"),
            },
        )


def test_callable_workflow_validation_rejects_unbound_parent_data() -> None:
    template = WorkflowFunctionTemplate(
        id="parent",
        version="0.1.0",
        node_invocations={
            "producer": tool_node("producer"),
            "subflow": workflow_node("subflow"),
        },
        control_edges=[ControlEdge(source="producer", target="subflow")],
        data_edges=[],
    )

    with pytest.raises(AccError, match="parent workflow-node inbox"):
        validate_callable_workflow_function(template)


def test_callable_workflow_validation_rejects_parent_output_port_mismatch() -> None:
    node = workflow_node("subflow")
    template = WorkflowFunctionTemplate(
        id="parent",
        version="0.1.0",
        node_invocations={
            "producer": tool_node("producer"),
            "subflow": NodeInvocationSpec(
                id=node.id,
                callable_ref=node.callable_ref,
                input_ports=node.input_ports,
                output_ports={"other": PortContract(id="other", direction="output")},
                workflow_call_input_bindings=node.workflow_call_input_bindings,
                workflow_call_output_bindings=node.workflow_call_output_bindings,
            ),
        },
        control_edges=[ControlEdge(source="producer", target="subflow")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="producer", port="main"),
                target=DataEndpoint(node="subflow", port="brief"),
            )
        ],
    )

    with pytest.raises(AccError, match="missing parent output port"):
        validate_callable_workflow_function(template)


def test_workflow_call_contract_rejects_missing_child_input_port() -> None:
    child_template = WorkflowFunctionTemplate(
        id="child",
        version="0.1.0",
        exposed_inputs={
            "brief": PortContract(id="brief", direction="input", required=False)
        },
        exposed_outputs={
            "report": PortContract(id="report", direction="output", required=True)
        },
        node_invocations={"child_tool": tool_node("child_tool")},
        control_edges=[],
        data_edges=[],
    )

    node = workflow_node("subflow")
    bad_node = NodeInvocationSpec(
        id=node.id,
        callable_ref=node.callable_ref,
        input_ports=node.input_ports,
        output_ports=node.output_ports,
        workflow_call_input_bindings=[
            WorkflowCallInputBinding(
                source=DataEndpoint(node="producer", port="main"),
                workflow_input="missing",
            )
        ],
        workflow_call_output_bindings=node.workflow_call_output_bindings,
    )

    with pytest.raises(AccError, match="missing child workflow input port"):
        validate_workflow_call_contract(bad_node, child_template)


def test_workflow_call_contract_rejects_missing_child_output_port() -> None:
    child_template = WorkflowFunctionTemplate(
        id="child",
        version="0.1.0",
        exposed_inputs={
            "brief": PortContract(id="brief", direction="input", required=True)
        },
        exposed_outputs={
            "other": PortContract(id="other", direction="output", required=True)
        },
        node_invocations={"child_tool": tool_node("child_tool")},
        control_edges=[],
        data_edges=[],
    )

    with pytest.raises(AccError, match="missing child workflow output port"):
        validate_workflow_call_contract(workflow_node("subflow"), child_template)


def test_callable_workflow_validation_rejects_recursive_call_by_default() -> None:
    template = WorkflowFunctionTemplate(
        id="parent",
        version="0.1.0",
        node_invocations={
            "producer": tool_node("producer"),
            "subflow": workflow_node("subflow", workflow_id="parent"),
        },
        control_edges=[ControlEdge(source="producer", target="subflow")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="producer", port="main"),
                target=DataEndpoint(node="subflow", port="brief"),
            )
        ],
    )

    with pytest.raises(AccError, match="recursive workflow call"):
        validate_callable_workflow_function(template)


def test_callable_workflow_validation_rejects_call_depth_above_policy() -> None:
    with pytest.raises(AccError, match="call depth exceeds policy"):
        validate_callable_workflow_function(
            valid_callable_template(),
            call_depth=3,
            call_depth_policy=CallDepthPolicy(default_max_depth=2),
        )


def test_callable_workflow_validation_rejects_stateful_in_stateful_by_default() -> None:
    node = workflow_node("subflow")
    template = WorkflowFunctionTemplate(
        id="parent",
        version="0.1.0",
        node_invocations={
            "producer": tool_node("producer"),
            "subflow": NodeInvocationSpec(
                id=node.id,
                callable_ref=node.callable_ref,
                input_ports=node.input_ports,
                output_ports=node.output_ports,
                workflow_call_input_bindings=node.workflow_call_input_bindings,
                workflow_call_output_bindings=node.workflow_call_output_bindings,
                environment_policy="binding_required",
            ),
        },
        control_edges=[ControlEdge(source="producer", target="subflow")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="producer", port="main"),
                target=DataEndpoint(node="subflow", port="brief"),
            )
        ],
    )

    with pytest.raises(AccError, match="stateful-in-stateful"):
        validate_callable_workflow_function(template, parent_stateful=True)


def test_callable_workflow_validation_rejects_data_edge_without_control_upstream() -> None:
    template = WorkflowFunctionTemplate(
        id="parent",
        version="0.1.0",
        node_invocations={
            "producer": tool_node("producer"),
            "subflow": workflow_node("subflow"),
        },
        control_edges=[],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="producer", port="main"),
                target=DataEndpoint(node="subflow", port="brief"),
            )
        ],
    )

    with pytest.raises(AccError, match="upstream control dependency"):
        validate_callable_workflow_function(template)


def test_large_dag_validation_sanity() -> None:
    nodes = {
        f"n_{index}": NodeInvocationSpec(
            id=f"n_{index}",
            callable_ref=CallableRef(kind="tool_class", id="noop"),
        )
        for index in range(1000)
    }
    template = WorkflowFunctionTemplate(
        id="large",
        version="0.1.0",
        node_invocations=nodes,
        control_edges=[
            ControlEdge(source=f"n_{index}", target=f"n_{index + 1}")
            for index in range(999)
        ],
        data_edges=[],
    )

    started = time.perf_counter()
    validate_callable_workflow_function(template)
    elapsed = time.perf_counter() - started

    assert elapsed < 1.0
