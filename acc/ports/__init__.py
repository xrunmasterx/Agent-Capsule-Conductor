from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from acc.domain import DataEdge, EnvironmentFrame, NodeSpec, RuntimeResult


class ClockProtocol(Protocol):
    def now_iso(self) -> str:
        ...


class IdGeneratorProtocol(Protocol):
    def new_id(self, prefix: str) -> str:
        ...


class EventSinkProtocol(Protocol):
    def write_workflow_event(
        self,
        event_type: str,
        *,
        status: str,
        node_id: str | None = None,
        level: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        ...

    def write_node_event(
        self,
        node_id: str,
        event_type: str,
        *,
        status: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        ...


class RunStoreProtocol(Protocol):
    def create_environment(self) -> EnvironmentFrame:
        ...

    def create_node_attempt(self, node_id: str) -> Path:
        ...

    def cleanup_node_attempt(self, node_dir: Path) -> None:
        ...

    def materialize_data_edge(
        self,
        edge: DataEdge,
        node_dir: Path,
        source_outboxes: dict[str, dict[str, Path]],
    ) -> dict[str, Any]:
        ...

    def write_artifact_bundle(
        self,
        node: NodeSpec,
        node_dir: Path,
        output: dict[str, Any],
    ) -> dict[str, Path]:
        ...


class NodeRunnerProtocol(Protocol):
    async def run_node(
        self,
        node: NodeSpec,
        node_dir: Path,
        frame: EnvironmentFrame,
    ) -> RuntimeResult:
        ...


class PathResolverProtocol(Protocol):
    def resolve_under_root(self, root: Path, relative_path: str) -> Path:
        ...
