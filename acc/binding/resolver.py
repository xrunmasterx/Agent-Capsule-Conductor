"""BindingResolver dispatch for explicit selector bindings."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from acc.binding.provenance import ProvenanceObject
from acc.binding.selector import OutboxSelector
from acc.domain import NodeInputBindingV2
from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import MissingNodeResultError, NodeId, PortId, RunId


class BindingResolutionError(RuntimeError):
    pass


class CrossRunReferenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class BindingMaterializationRecord:
    target_field: str
    source: str
    inline_value_sha256: str | None
    source_artifact_sha256: str | None
    materialization_mode: str


@dataclass
class BindingResolverResult:
    agent_payload: dict[str, Any]
    runtime_payload: dict[str, Any]
    materializations: list[BindingMaterializationRecord]
    provenance: ProvenanceObject


class BindingResolver:
    def __init__(self, result_store: FilesystemResultStore) -> None:
        self._result_store = result_store

    def resolve(
        self,
        node_id: NodeId,
        run_id: RunId,
        bindings: list[NodeInputBindingV2],
    ) -> BindingResolverResult:
        agent_payload: dict[str, Any] = {}
        materializations: list[BindingMaterializationRecord] = []
        for binding in bindings:
            if binding.kind != "selector":
                raise BindingResolutionError(f"unsupported binding kind {binding.kind!r}")
            if not isinstance(binding.selector, OutboxSelector):
                raise BindingResolutionError("only outbox selectors are supported")
            result = self._result_store.get(
                run_id,
                NodeId(binding.selector.node_id),
                PortId(binding.selector.port_id),
            )
            if result is None:
                raise MissingNodeResultError(
                    f"Missing ResultStore record: {run_id}/{binding.selector.node_id}/"
                    f"{binding.selector.port_id}"
                )
            if result.run_id != run_id:
                raise CrossRunReferenceError(
                    f"selector resolved run {result.run_id!r}, expected {run_id!r}"
                )
            value = _decode_inline_value(result.inline_value or b"null")
            agent_payload[binding.target_field] = value
            materializations.append(
                BindingMaterializationRecord(
                    target_field=binding.target_field,
                    source=f"{result.node_id}:{result.port_id}",
                    inline_value_sha256=(
                        hashlib.sha256(result.inline_value).hexdigest()
                        if result.inline_value is not None
                        else None
                    ),
                    source_artifact_sha256=result.bundle.sha256,
                    materialization_mode=result.bundle.materialization_mode,
                )
            )
        provenance = ProvenanceObject(
            kind="aggregate",
            source_id=str(node_id),
            run_id=str(run_id),
            materialization_mode="inline",
            inline_value_sha256=_hash_json(agent_payload),
        )
        return BindingResolverResult(
            agent_payload=agent_payload,
            runtime_payload={},
            materializations=materializations,
            provenance=provenance,
        )


def _decode_inline_value(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw.decode("utf-8", errors="replace")


def _hash_json(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
