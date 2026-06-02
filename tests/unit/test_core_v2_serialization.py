from __future__ import annotations

import json

from acc.domain import (
    CORE_V2_SCHEMA_VERSION,
    ArtifactContract,
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    ExecutionNode,
    ExecutionPlan,
    NodeInvocationSpec,
    PortContract,
    RuntimePolicy,
    TimeoutPolicy,
    WorkflowFunctionTemplate,
    execution_plan_to_dict,
    validate_core_v2_workflow_function_template,
    workflow_function_template_from_dict,
    workflow_function_template_to_dict,
)


def test_workflow_function_template_json_round_trip_is_stable() -> None:
    producer = NodeInvocationSpec(
        id="producer",
        callable_ref=CallableRef(kind="tool_class", id="producer.local"),
        output_ports={"main": PortContract(id="main", direction="output")},
        runtime_policy=RuntimePolicy(timeout=TimeoutPolicy(seconds=10)),
        artifact_contract=ArtifactContract(required_paths=("out/report.json",)),
        metadata={"label": "Producer"},
    )
    consumer = NodeInvocationSpec(
        id="consumer",
        callable_ref=CallableRef(kind="agent_class", id="consumer.codex"),
        input_ports={"main": PortContract(id="main", direction="input")},
        metadata={"label": "Consumer"},
    )
    template = WorkflowFunctionTemplate(
        id="core_v2_demo",
        version="1.0.0",
        node_invocations={producer.id: producer, consumer.id: consumer},
        control_edges=[ControlEdge(source=producer.id, target=consumer.id)],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node=producer.id, port="main"),
                target=DataEndpoint(node=consumer.id, port="main"),
            )
        ],
        exposed_inputs={"topic": PortContract(id="topic", direction="input")},
        exposed_outputs={"report": PortContract(id="report", direction="output")},
        metadata={"description": "stable serialization demo"},
    )

    payload = workflow_function_template_to_dict(template)
    encoded = json.dumps(payload, sort_keys=True)
    decoded = workflow_function_template_from_dict(json.loads(encoded))

    validate_core_v2_workflow_function_template(decoded)
    assert workflow_function_template_to_dict(decoded) == payload
    assert payload["schema_version"] == CORE_V2_SCHEMA_VERSION


def test_execution_plan_serializes_to_jsonable_payload() -> None:
    node = NodeInvocationSpec(
        id="write",
        callable_ref=CallableRef(kind="tool_class", id="writer.local"),
    )
    plan = ExecutionPlan(
        workflow_function_id="writer_flow",
        schema_version=CORE_V2_SCHEMA_VERSION,
        nodes=(ExecutionNode(node_id=node.id, invocation=node),),
        levels=((node.id,),),
    )

    payload = execution_plan_to_dict(plan)
    json.dumps(payload, sort_keys=True)

    assert payload["schema_version"] == CORE_V2_SCHEMA_VERSION
    assert payload["nodes"][0]["invocation"]["callable_ref"]["kind"] == "tool_class"

