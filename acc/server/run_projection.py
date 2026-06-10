"""Workbench-facing projection over ResultStore + ProvenanceObject.

Phase 2 surface (DESIGN §15 RunInspector / STRATEGY §6.2). Surfaces:

- ``NodeProjectionView``: a frozen, JSON-friendly view that exposes only
  the safe-for-Workbench fields (bundle summary, provenance, the
  per-binding materialization list). Runtime-only payload fields stay
  filtered out.
- ``RunProjection``: a per-run helper that READS from
  :class:`FilesystemResultStore` + the per-run ``runtime.json`` /
  ``run_manifest.json`` side-channels written by Phase 2 and returns
  ``NodeProjectionView`` instances.

Layering: imports ``acc.result_store`` and
``acc.persistence`` only — must NOT import ``acc.app`` or ``acc.cli``
(R1/R2 layering contract). The default port id (``"default"``) and
terminal node id (``"__workflow__"``) are duplicated as module
constants here rather than imported from :mod:`acc.app.binding_runtime`
to keep the layering boundary clean; both values are defined alongside
the production writer in ``acc/app/binding_runtime.py``.

The projection layer ONLY reads — it never writes. Existing
``/api/runs/...`` routes are not affected; new routes layered on top
of this module add additional read endpoints for the Workbench UI.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from acc.persistence.manifest import ManifestCorruptError
from acc.persistence.manifest import read as read_run_manifest
from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import NodeId, NodeResult, PortId, RunId

# Mirrors acc.app.binding_runtime.DEFAULT_RESULT_STORE_PORT_ID /
# TERMINAL_WORKFLOW_NODE_ID. Duplicated to keep the import boundary clean
# (this module must not import acc.app).
DEFAULT_RESULT_STORE_PORT_ID = "default"
TERMINAL_WORKFLOW_NODE_ID = "__workflow__"


@dataclass(frozen=True)
class NodeProjectionView:
    """Workbench-safe view of a single node's ResultStore record."""

    node_id: str
    status: str
    bundle_summary: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    binding_resolved: list[dict[str, Any]] = field(default_factory=list)

    def to_jsonable(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "status": self.status,
            "bundle_summary": dict(self.bundle_summary),
            "provenance": dict(self.provenance),
            "binding_resolved": [dict(row) for row in self.binding_resolved],
        }


class RunProjection:
    """Read-only projection over ResultStore + runtime side-channels.

    Constructed once per run (``run_dir`` points at
    ``runs/<run_id>/``). All methods are pure reads — no caller-visible
    side effects on disk. Missing artifacts are reported as ``None`` /
    empty rather than raising, so the Workbench can render in-flight
    Core v2 runs.
    """

    def __init__(
        self,
        result_store: FilesystemResultStore,
        run_dir: Path,
    ) -> None:
        self._result_store = result_store
        self._run_dir = run_dir

    def list_nodes(self, run_id: RunId) -> list[NodeProjectionView]:
        """Return one view per node present in ResultStore.

        The terminal ``__workflow__`` synthetic node is excluded; surface
        it via :meth:`get_workflow_output` instead.
        """
        result_store_dir = self._run_dir / "result_store"
        if not result_store_dir.exists() or not result_store_dir.is_dir():
            return []
        views: list[NodeProjectionView] = []
        for node_dir in sorted(
            entry for entry in result_store_dir.iterdir() if entry.is_dir()
        ):
            node_id_str = node_dir.name
            if node_id_str == TERMINAL_WORKFLOW_NODE_ID:
                continue
            view = self.get_node(run_id, NodeId(node_id_str))
            if view is not None:
                views.append(view)
        return views

    def get_node(
        self,
        run_id: RunId,
        node_id: NodeId,
    ) -> NodeProjectionView | None:
        """Return a single ``NodeProjectionView`` or ``None`` if absent."""
        port_id = self._preferred_port_id(run_id, node_id)
        if port_id is None:
            return None
        node_result = self._result_store.get(run_id, node_id, port_id)
        if node_result is None:
            return None
        runtime = self._read_runtime_json(str(node_id))
        provenance = _safe_provenance(runtime.get("provenance"))
        binding_resolved = _safe_binding_resolved(
            runtime.get("binding_materializations")
        )
        return NodeProjectionView(
            node_id=str(node_id),
            status="produced",
            bundle_summary=_bundle_summary(node_result),
            provenance=provenance,
            binding_resolved=binding_resolved,
        )

    def get_workflow_output(
        self,
        run_id: RunId,
        target_field: str,
    ) -> NodeProjectionView | None:
        """Return the terminal projection for a declared workflow output."""
        node_result = self._result_store.get(
            run_id,
            NodeId(TERMINAL_WORKFLOW_NODE_ID),
            PortId(target_field),
        )
        if node_result is None:
            return None
        provenance = _workflow_output_provenance(self._run_dir, target_field)
        return NodeProjectionView(
            node_id=TERMINAL_WORKFLOW_NODE_ID,
            status="produced",
            bundle_summary=_bundle_summary(node_result),
            provenance=provenance,
            binding_resolved=[],
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _read_runtime_json(self, node_id: str) -> dict[str, Any]:
        runtime_path = self._run_dir / "nodes" / node_id / "runtime.json"
        if not runtime_path.exists() or not runtime_path.is_file():
            return {}
        try:
            data = json.loads(runtime_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _preferred_port_id(self, run_id: RunId, node_id: NodeId) -> PortId | None:
        for port_id in (DEFAULT_RESULT_STORE_PORT_ID, "main"):
            if self._result_store.get(run_id, node_id, PortId(port_id)) is not None:
                return PortId(port_id)
        node_dir = self._run_dir / "result_store" / str(node_id)
        if not node_dir.exists() or not node_dir.is_dir():
            return None
        for manifest_path in sorted(node_dir.glob("*.json")):
            return PortId(manifest_path.stem)
        return None


def _bundle_summary(result: NodeResult) -> dict[str, Any]:
    bundle = result.bundle
    return {
        "bundle_id": bundle.bundle_id,
        "sha256": bundle.sha256,
        "size_bytes": bundle.size_bytes,
        "materialization_mode": bundle.materialization_mode,
    }


def _safe_provenance(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    # Return a sanitized copy with only known provenance fields.
    _PROVENANCE_KEYS = frozenset({
        "producer_session_id", "bundle_id", "binding_applied",
        "call_depth", "materialization_mode_resolved",
        "parent_frame_id", "invoking_workflow_call_id",
        "inline_value_sha256", "source_artifact_sha256", "schema_version",
    })
    return {k: v for k, v in raw.items() if k in _PROVENANCE_KEYS}


def _safe_binding_resolved(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    rows: list[dict[str, Any]] = []
    for record in raw:
        if not isinstance(record, dict):
            continue
        rows.append(
            {
                "target_field": record.get("target_field", ""),
                "source": record.get("source", ""),
                "materialization_mode": record.get("materialization_mode", ""),
            }
        )
    return rows


def _workflow_output_provenance(run_dir: Path, target_field: str) -> dict[str, Any]:
    try:
        manifest = read_run_manifest(run_dir)
    except ManifestCorruptError:
        return {}
    if manifest is None:
        return {}
    for row in manifest.workflow_outputs:
        if not isinstance(row, dict):
            continue
        if row.get("target_field") == target_field:
            return {
                "source_node_id": row.get("source_node_id", ""),
                "source_port_id": row.get("source_port_id", ""),
                "bundle_id": row.get("bundle_id", ""),
                "sha256": row.get("sha256", ""),
            }
    return {}


__all__ = [
    "DEFAULT_RESULT_STORE_PORT_ID",
    "TERMINAL_WORKFLOW_NODE_ID",
    "NodeProjectionView",
    "RunProjection",
]
