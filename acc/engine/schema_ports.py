"""Schema-driven output port projection helpers.

This module is intentionally pure: it only derives port metadata from a node
and its output schema. It does not read files, mutate templates, or know about
Workbench UI state.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from acc.models import NodeInvocationSpec, PortContract

MAIN_OUTPUT_PORT = "main"
DEFAULT_OUTPUT_PORT = "default"
OUTPUTS_PROPERTY = "outputs"
COMPLEX_SCHEMA_KEYS = ("$ref", "$defs", "anyOf", "oneOf", "allOf")


@dataclass(frozen=True)
class OutputPortProjection:
    port_id: str
    required: bool
    type: str
    cardinality: str
    json_path: str
    description: str | None = None
    title: str | None = None
    schema_type: str | None = None
    projected: bool = True
    deprecated: bool = False
    diagnostic: str | None = None


def project_output_port_metadata(
    schema: dict[str, Any] | None,
    *,
    include_main: bool = True,
) -> dict[str, OutputPortProjection]:
    """Project output_schema.properties.outputs.properties into output ports.

    Only first-level fields under ``outputs.properties`` become data ports. The
    whole output object is always represented by ``main`` when requested.
    """

    ports: dict[str, OutputPortProjection] = {}
    diagnostics = _schema_diagnostics(schema)
    if include_main:
        ports[MAIN_OUTPUT_PORT] = OutputPortProjection(
            port_id=MAIN_OUTPUT_PORT,
            required=True,
            type="object",
            cardinality="one",
            json_path="/",
            description="Complete node output",
            schema_type="object",
            diagnostic="; ".join(diagnostics) if diagnostics else None,
        )

    output_properties = _outputs_properties(schema)
    if not output_properties:
        return ports

    required_ports = _outputs_required(schema)
    for port_id, field_schema in output_properties.items():
        if not isinstance(port_id, str) or not port_id:
            continue
        if port_id == MAIN_OUTPUT_PORT:
            if MAIN_OUTPUT_PORT in ports:
                diagnostic = _append_diagnostic(
                    ports[MAIN_OUTPUT_PORT].diagnostic,
                    "outputs.main is not projected because main means complete output",
                )
                ports[MAIN_OUTPUT_PORT] = replace(
                    ports[MAIN_OUTPUT_PORT],
                    diagnostic=diagnostic,
                )
            continue
        schema_payload = field_schema if isinstance(field_schema, dict) else {}
        schema_type = _schema_type(schema_payload)
        ports[port_id] = OutputPortProjection(
            port_id=port_id,
            required=port_id in required_ports,
            type=schema_type or "artifact",
            cardinality="many" if schema_type == "array" else "one",
            json_path=f"/outputs/{_json_pointer_token(port_id)}",
            description=_optional_string(schema_payload.get("description")),
            title=_optional_string(schema_payload.get("title")),
            schema_type=schema_type,
            deprecated=bool(schema_payload.get("deprecated", False)),
            diagnostic="; ".join(_schema_diagnostics(schema_payload)) or None,
        )
    return ports


def effective_output_ports(node: NodeInvocationSpec) -> dict[str, PortContract]:
    """Return the runtime/validation output-port contract for a node.

    Schema-derived ports win over stale compatibility snapshots. Workflow-call
    return bindings still define workflow container call-site ports.
    """

    if node.workflow_call_output_bindings:
        ports = {
            binding.parent_port: PortContract(
                id=binding.parent_port,
                direction="output",
                required=binding.required,
            )
            for binding in node.workflow_call_output_bindings
            if binding.parent_port
        }
        return _with_main_output_port(ports)

    projected = project_output_port_metadata(node.output_schema, include_main=True)
    projected_non_main = [
        port_id
        for port_id in projected
        if port_id not in {MAIN_OUTPUT_PORT, DEFAULT_OUTPUT_PORT}
    ]
    if projected_non_main:
        return project_output_port_contracts(node.output_schema, include_main=True)

    if node.output_ports:
        return _with_main_output_port(dict(node.output_ports))

    return {
        MAIN_OUTPUT_PORT: PortContract(id=MAIN_OUTPUT_PORT, direction="output"),
    }


def project_output_port_contracts(
    schema: dict[str, Any] | None,
    *,
    include_main: bool = True,
) -> dict[str, PortContract]:
    """Return ACC PortContract values derived from schema output fields.

    JSON Schema field types describe the payload shape, not ACC materialization
    semantics, so projected ACC ports keep the existing ``artifact`` port type.
    """

    return {
        port_id: PortContract(
            id=port_id,
            direction="output",
            required=projection.required,
            cardinality=projection.cardinality,
        )
        for port_id, projection in project_output_port_metadata(
            schema,
            include_main=include_main,
        ).items()
    }


def schema_declares_output_port(schema: dict[str, Any] | None, port_id: str) -> bool:
    """Return whether a schema declares a named output port.

    New schemas declare ports under ``properties.outputs.properties``. Legacy
    top-level properties remain accepted for compatibility, but are not
    projected into UI ports by ``project_output_port_metadata``.
    """

    if port_id in {MAIN_OUTPUT_PORT, DEFAULT_OUTPUT_PORT}:
        return True
    properties = _object_properties(schema)
    if properties is None:
        return False
    output_properties = _outputs_properties(schema)
    if output_properties is not None and port_id in output_properties:
        return True
    return port_id in properties


def has_projected_output_ports(schema: dict[str, Any] | None) -> bool:
    return bool(project_output_port_metadata(schema, include_main=False))


def _with_main_output_port(
    ports: dict[str, PortContract],
) -> dict[str, PortContract]:
    if MAIN_OUTPUT_PORT in ports:
        return ports
    return {
        MAIN_OUTPUT_PORT: PortContract(id=MAIN_OUTPUT_PORT, direction="output"),
        **ports,
    }


def _object_properties(schema: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(schema, dict):
        return None
    properties = schema.get("properties")
    if isinstance(properties, dict):
        return properties
    return None


def _outputs_schema(schema: dict[str, Any] | None) -> dict[str, Any] | None:
    properties = _object_properties(schema)
    if properties is None:
        return None
    outputs = properties.get(OUTPUTS_PROPERTY)
    if isinstance(outputs, dict):
        return outputs
    return None


def _outputs_properties(schema: dict[str, Any] | None) -> dict[str, Any] | None:
    outputs = _outputs_schema(schema)
    if outputs is None:
        return None
    properties = outputs.get("properties")
    if isinstance(properties, dict):
        return properties
    return None


def _outputs_required(schema: dict[str, Any] | None) -> set[str]:
    outputs = _outputs_schema(schema)
    if outputs is None:
        return set()
    required = outputs.get("required")
    if not isinstance(required, list):
        return set()
    return {item for item in required if isinstance(item, str)}


def _schema_type(schema: dict[str, Any]) -> str | None:
    raw_type = schema.get("type")
    if isinstance(raw_type, str):
        return raw_type
    if isinstance(raw_type, list):
        types = [item for item in raw_type if isinstance(item, str) and item != "null"]
        if len(types) == 1:
            return types[0]
        if types:
            return "|".join(types)
    return None


def _schema_diagnostics(schema: dict[str, Any] | None) -> list[str]:
    if not isinstance(schema, dict):
        return []
    diagnostics = [
        f"schema contains {key}; projection uses explicit first-level fields only"
        for key in COMPLEX_SCHEMA_KEYS
        if key in schema
    ]
    additional = schema.get("additionalProperties")
    if isinstance(additional, dict) or additional is True:
        diagnostics.append(
            "schema allows dynamic properties; dynamic keys are not projected as ports"
        )
    return diagnostics


def _json_pointer_token(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _append_diagnostic(existing: str | None, new_value: str) -> str:
    if existing:
        return f"{existing}; {new_value}"
    return new_value
