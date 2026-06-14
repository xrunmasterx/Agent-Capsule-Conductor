"""RunManifest dataclass with atomic JSON checkpoint persistence.

DESIGN anchor: §11.2 explicit checkpoint and pause/resume — the manifest
records ``completed_nodes`` and ``binding_materializations`` so resume
relies on this run's own checkpoint instead of heuristics.
STRATEGY anchor: §6.1 PR-1.1, invariant X-7 (outbox_manifest written
before completed_nodes append).

Phase 1 ships writer/reader skeleton only. The pause/resume consumer
is wired in Phase 3 (STRATEGY §6.3).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from acc.storage import write_text_atomic

MANIFEST_FILENAME = "run_manifest.json"


class ManifestCorruptError(IOError):
    """Raised when ``run_manifest.json`` exists but cannot be parsed."""


@dataclass
class RunManifest:
    """Run-level checkpoint persisted at ``<run_dir>/run_manifest.json``.

    Fields mirror DESIGN §13 Phase 1 invariant X-1 / X-7:

    - ``completed_nodes``: per-node atomic commit record ids; appended
      AFTER the corresponding outbox_manifest is on disk.
    - ``binding_materializations``: per ``(node_id, port_id,
      materialization_mode_resolved, finalized_at, hash)`` row written in
      the same atomic step as the ProvenanceObject.
    - ``workflow_outputs``: terminal ResultStore addresses produced from
      ``WorkflowOutputBinding`` declarations. Each row carries
      ``target_field``, ``source_node_id``, ``source_port_id``,
      ``bundle_id``, ``sha256`` (Phase 2 §6.2). Empty list when the
      workflow declares no ``workflow_output_bindings`` (legacy mode).
    """

    run_id: str
    schema_version: int
    completed_nodes: list[str] = field(default_factory=list)
    binding_materializations: list[dict] = field(default_factory=list)
    workflow_outputs: list[dict] = field(default_factory=list)
    started_at: str = ""
    last_updated_at: str = ""


def write_atomic(manifest: RunManifest, run_dir: Path) -> None:
    """Atomically write ``run_manifest.json`` using ACC shared storage helpers.

    The shared helper creates the temp file in the target directory, creates
    parents as needed, and cleans up orphan temp files on write failure.
    """

    run_dir.mkdir(parents=True, exist_ok=True)
    target = run_dir / MANIFEST_FILENAME
    payload = json.dumps(
        asdict(manifest),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    write_text_atomic(target, payload)


def read(run_dir: Path) -> RunManifest | None:
    """Read ``run_manifest.json`` from ``run_dir``.

    Returns ``None`` when the file does not exist. Raises
    :class:`ManifestCorruptError` when the file is present but cannot be
    parsed or has a missing required field.
    """

    target = run_dir / MANIFEST_FILENAME
    if not target.exists():
        return None
    try:
        raw = target.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestCorruptError(f"failed to parse {target}: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestCorruptError(f"{target} is not a JSON object")
    try:
        return RunManifest(
            run_id=str(data["run_id"]),
            schema_version=int(data["schema_version"]),
            completed_nodes=list(data.get("completed_nodes", [])),
            binding_materializations=list(data.get("binding_materializations", [])),
            workflow_outputs=list(data.get("workflow_outputs", [])),
            started_at=str(data.get("started_at", "")),
            last_updated_at=str(data.get("last_updated_at", "")),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ManifestCorruptError(f"invalid run_manifest fields in {target}: {exc}") from exc
