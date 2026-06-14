"""Filesystem-backed ResultStore implementation.

Phase 1 skeleton per docs/codex_goal_workflow_message_routing/
IMPLEMENTATION_STRATEGY.md §6.1 PR-1.3 and DESIGN.md §13 (AUDIT C-012:
ResultStore (run_id, node_id, port_id) addressable).

Layout::

    runs/<run_id>/result_store/<node_id>/<port_id>.json   (manifest)
    runs/<run_id>/result_store/<node_id>/<port_id>.bin    (inline value)
    runs/<run_id>/result_store/<node_id>/<port_id>/       (reference dir)

All writes are atomic via tempfile + ``os.replace`` (AUDIT E-004 atomic
write invariant). ``ArtifactBundle.relative_path`` MUST be relative to
``runs/<run_id>/``; absolute paths are rejected.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path, PurePosixPath, PureWindowsPath

from acc.storage import write_bytes_atomic, write_text_atomic
from acc.result_store.types import (
    ArtifactBundle,
    NodeId,
    NodeResult,
    PortId,
    RunId,
)

__all__ = ["FilesystemResultStore"]


class FilesystemResultStore:
    """On-disk ResultStore rooted at ``runs/``.

    The store is intentionally minimal (Phase 1 skeleton):
    only ``get``/``put``/``exists`` are exposed. Selector / list / cache
    behavior arrives in Phase 3 alongside the BindingResolver upgrade.
    """

    def __init__(self, runs_root: Path) -> None:
        self._root = runs_root

    def get(
        self,
        run_id: RunId,
        node_id: NodeId,
        port_id: PortId,
    ) -> NodeResult | None:
        manifest_path = self._manifest_path(run_id, node_id, port_id)
        if not manifest_path.exists():
            return None
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        bundle = ArtifactBundle(**payload["bundle"])
        inline_value = self._read_inline(run_id, node_id, port_id, bundle)
        return NodeResult(
            run_id=RunId(payload["run_id"]),
            node_id=NodeId(payload["node_id"]),
            port_id=PortId(payload["port_id"]),
            bundle=bundle,
            inline_value=inline_value,
            produced_at=payload["produced_at"],
        )

    def put(self, result: NodeResult) -> None:
        rel = result.bundle.relative_path
        if (
            Path(rel).is_absolute()
            or PurePosixPath(rel).is_absolute()
            or PureWindowsPath(rel).is_absolute()
        ):
            raise ValueError(
                "ArtifactBundle.relative_path must be relative to runs/<run_id>/"
            )
        node_dir = self._node_dir(result.run_id, result.node_id)
        node_dir.mkdir(parents=True, exist_ok=True)
        if result.inline_value is not None:
            self._atomic_write_bytes(
                self._inline_path(result.run_id, result.node_id, result.port_id),
                result.inline_value,
            )
        manifest = {
            "run_id": str(result.run_id),
            "node_id": str(result.node_id),
            "port_id": str(result.port_id),
            "bundle": asdict(result.bundle),
            "produced_at": result.produced_at,
        }
        self._atomic_write_text(
            self._manifest_path(result.run_id, result.node_id, result.port_id),
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        )

    def exists(
        self,
        run_id: RunId,
        node_id: NodeId,
        port_id: PortId,
    ) -> bool:
        return self._manifest_path(run_id, node_id, port_id).exists()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _node_dir(self, run_id: RunId, node_id: NodeId) -> Path:
        return self._root / str(run_id) / "result_store" / str(node_id)

    def _manifest_path(
        self,
        run_id: RunId,
        node_id: NodeId,
        port_id: PortId,
    ) -> Path:
        return self._node_dir(run_id, node_id) / f"{port_id}.json"

    def _inline_path(
        self,
        run_id: RunId,
        node_id: NodeId,
        port_id: PortId,
    ) -> Path:
        return self._node_dir(run_id, node_id) / f"{port_id}.bin"

    def _read_inline(
        self,
        run_id: RunId,
        node_id: NodeId,
        port_id: PortId,
        bundle: ArtifactBundle,
    ) -> bytes | None:
        if bundle.materialization_mode != "inline":
            return None
        inline_path = self._inline_path(run_id, node_id, port_id)
        if not inline_path.exists():
            return None
        return inline_path.read_bytes()

    @staticmethod
    def _atomic_write_text(path: Path, text: str) -> None:
        write_text_atomic(path, text)

    @staticmethod
    def _atomic_write_bytes(path: Path, data: bytes) -> None:
        write_bytes_atomic(path, data)
