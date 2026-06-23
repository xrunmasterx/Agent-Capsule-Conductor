from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any

from acc.models import ResultStoreAddress


@dataclass(frozen=True)
class NodeExecutionResult:
    node_id: str
    status: str
    outputs: Mapping[str, Any] = field(default_factory=dict)
    result_addresses: Mapping[str, ResultStoreAddress] = field(default_factory=dict)
    artifact_bundle_path: Path | None = None
    binding_manifest_path: Path | None = None
    failure_id: str | None = None
    error: str | None = None
    started_at: str | None = None
    ended_at: str | None = None

    @classmethod
    def success(
        cls,
        *,
        node_id: str,
        outputs: Mapping[str, Any],
        result_addresses: Mapping[str, ResultStoreAddress],
        artifact_bundle_path: Path,
        binding_manifest_path: Path,
        started_at: str | None,
        ended_at: str | None,
    ) -> NodeExecutionResult:
        return cls(
            node_id=node_id,
            status="success",
            outputs=MappingProxyType(dict(outputs)),
            result_addresses=MappingProxyType(dict(result_addresses)),
            artifact_bundle_path=artifact_bundle_path,
            binding_manifest_path=binding_manifest_path,
            started_at=started_at,
            ended_at=ended_at,
        )

    @classmethod
    def waiting_interaction(cls, *, node_id: str) -> NodeExecutionResult:
        return cls(node_id=node_id, status="waiting_interaction")

    @classmethod
    def failed(
        cls,
        *,
        node_id: str,
        failure_id: str | None = None,
        error: str | None = None,
        started_at: str | None = None,
        ended_at: str | None = None,
    ) -> NodeExecutionResult:
        return cls(
            node_id=node_id,
            status="failed",
            failure_id=failure_id,
            error=error,
            started_at=started_at,
            ended_at=ended_at,
        )

    @classmethod
    def cancelled(
        cls,
        *,
        node_id: str,
        error: str | None = None,
        started_at: str | None = None,
        ended_at: str | None = None,
    ) -> NodeExecutionResult:
        return cls(
            node_id=node_id,
            status="cancelled",
            error=error,
            started_at=started_at,
            ended_at=ended_at,
        )

    @classmethod
    def timeout(
        cls,
        *,
        node_id: str,
        error: str | None = "timeout",
        started_at: str | None = None,
        ended_at: str | None = None,
    ) -> NodeExecutionResult:
        return cls(
            node_id=node_id,
            status="timeout",
            error=error,
            started_at=started_at,
            ended_at=ended_at,
        )

    @classmethod
    def waiting_handoff(cls, *, node_id: str) -> NodeExecutionResult:
        return cls(node_id=node_id, status="waiting_handoff")

    @classmethod
    def waiting_timer(cls, *, node_id: str) -> NodeExecutionResult:
        return cls(node_id=node_id, status="waiting_timer")


@dataclass(frozen=True)
class WorkflowExecutionResult:
    status: str
    outputs: Mapping[tuple[str, str], Any] = field(default_factory=dict)
    node_results: Mapping[str, NodeExecutionResult] = field(default_factory=dict)

    @classmethod
    def from_parts(
        cls,
        *,
        status: str,
        outputs: Mapping[tuple[str, str], Any],
        node_results: Mapping[str, NodeExecutionResult],
    ) -> WorkflowExecutionResult:
        return cls(
            status=status,
            outputs=MappingProxyType(dict(outputs)),
            node_results=MappingProxyType(dict(node_results)),
        )
