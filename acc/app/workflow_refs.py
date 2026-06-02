from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Any, Literal

from acc.store import is_clean_workflow_path, load_json
from acc.utils import AccError

WorkflowRefSource = Literal["overlay", "workflows_dir", "absolute_path"]
WorkflowRefMode = Literal["persistent", "runtime"]


@dataclass(frozen=True)
class ResolvedWorkflowRef:
    original_ref: str
    canonical_ref: str
    resolved_path: Path
    workflow_id: str
    source: WorkflowRefSource
    portable: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "original_ref": self.original_ref,
            "canonical_ref": self.canonical_ref,
            "resolved_path": str(self.resolved_path),
            "workflow_id": self.workflow_id,
            "source": self.source,
            "portable": self.portable,
        }


@dataclass(frozen=True)
class WorkflowCatalogEntry:
    path: Path
    workflow_id: str
    source: WorkflowRefSource


class WorkflowCatalog:
    """Resolve workflow_function refs against the final workflow catalog view.

    The catalog combines durable workflow files with transaction-local overlay
    files. Callers choose whether to emit portable persistent refs or runtime
    materialized refs, but both modes resolve through the same index.
    """

    def __init__(
        self,
        *,
        project_root: Path,
        workflows_dir: Path,
        overlay_payloads: dict[Path, dict[str, Any]] | None = None,
    ) -> None:
        self.project_root = project_root.resolve()
        self.workflows_dir = workflows_dir.resolve()
        self._entries_by_path: dict[Path, WorkflowCatalogEntry] = {}
        self._entries_by_key: dict[str, list[WorkflowCatalogEntry]] = {}
        self._load_workflows_dir()
        for path, payload in (overlay_payloads or {}).items():
            self._add_entry(path.resolve(), payload, "overlay")

    def known_workflow_ids(self) -> set[str]:
        keys: set[str] = set(self._entries_by_key)
        for entry in self._entries_by_path.values():
            keys.add(str(entry.path.resolve()))
        return keys

    def known_callable_refs(self) -> set[tuple[str, str]]:
        return {("workflow_function", key) for key in self.known_workflow_ids()}

    def resolution_preview(self) -> list[dict[str, Any]]:
        entries = sorted(self._entries_by_path.values(), key=lambda item: str(item.path))
        return [
            {
                "workflow_id": entry.workflow_id,
                "path": str(entry.path),
                "source": entry.source,
            }
            for entry in entries
        ]

    def resolve(
        self,
        ref_id: str,
        *,
        template_source_path: Path | None,
        mode: WorkflowRefMode,
    ) -> ResolvedWorkflowRef:
        ref = ref_id.strip()
        if not ref:
            raise AccError("missing_workflow_function_ref: workflow_function ref is empty")

        entry = self._resolve_entry(ref, template_source_path=template_source_path)
        canonical_ref, portable = self._canonical_ref_for_entry(
            entry,
            original_ref=ref,
            template_source_path=template_source_path,
            mode=mode,
        )
        if mode == "persistent" and not portable:
            raise AccError(
                "nonportable_workflow_function_ref: "
                f"Workflow function ref {ref!r} resolves outside the workflow catalog"
            )
        return ResolvedWorkflowRef(
            original_ref=ref,
            canonical_ref=canonical_ref,
            resolved_path=entry.path,
            workflow_id=entry.workflow_id,
            source=entry.source,
            portable=portable,
        )

    def _load_workflows_dir(self) -> None:
        if not self.workflows_dir.exists():
            return
        for path in sorted(self.workflows_dir.glob("*.accflow.json")):
            try:
                payload = load_json(path)
            except AccError:
                continue
            if isinstance(payload, dict):
                self._add_entry(path.resolve(), payload, "workflows_dir")

    def _add_entry(
        self,
        path: Path,
        payload: dict[str, Any],
        source: WorkflowRefSource,
    ) -> None:
        workflow_id = str(payload.get("id") or path.name.removesuffix(".accflow.json"))
        entry = WorkflowCatalogEntry(path=path.resolve(), workflow_id=workflow_id, source=source)
        self._entries_by_path[entry.path] = entry
        for key in self._keys_for_entry(entry):
            self._entries_by_key.setdefault(key, [])
            self._entries_by_key[key] = [
                item for item in self._entries_by_key[key] if item.path != entry.path
            ]
            self._entries_by_key[key].insert(0, entry)

    def _keys_for_entry(self, entry: WorkflowCatalogEntry) -> set[str]:
        keys = {entry.workflow_id, entry.path.name, str(entry.path)}
        keys.add(entry.path.as_posix())
        with suppress(ValueError):
            keys.add(entry.path.relative_to(self.project_root).as_posix())
        with suppress(ValueError):
            keys.add(entry.path.relative_to(self.workflows_dir).as_posix())
        return {key for key in keys if key}

    def _resolve_entry(
        self,
        ref: str,
        *,
        template_source_path: Path | None,
    ) -> WorkflowCatalogEntry:
        path = Path(ref)
        candidates: list[Path] = []
        if path.is_absolute() or PureWindowsPath(ref).is_absolute():
            candidates.append(path)
        elif is_clean_workflow_path(path):
            if template_source_path is not None:
                candidates.append(template_source_path.parent / path)
            candidates.append(self.project_root / path)
            candidates.append(self.workflows_dir / path.name)

        for candidate in candidates:
            resolved = candidate.resolve()
            entry = self._entries_by_path.get(resolved)
            if entry is not None:
                return entry
            if resolved.exists() and is_clean_workflow_path(resolved):
                payload = load_json(resolved)
                if isinstance(payload, dict):
                    source: WorkflowRefSource = (
                        "workflows_dir"
                        if _is_relative_to(resolved, self.workflows_dir)
                        else "absolute_path"
                    )
                    entry = WorkflowCatalogEntry(
                        path=resolved,
                        workflow_id=str(
                            payload.get("id") or resolved.name.removesuffix(".accflow.json")
                        ),
                        source=source,
                    )
                    return entry

        entries = self._entries_by_key.get(ref.replace("\\", "/")) or self._entries_by_key.get(ref)
        if entries:
            unique = {entry.path: entry for entry in entries}
            if len(unique) == 1:
                return next(iter(unique.values()))
            paths = ", ".join(str(item) for item in sorted(unique))
            raise AccError(
                "ambiguous_workflow_function_ref: "
                f"Workflow function ref {ref!r} matches multiple workflows: {paths}"
            )

        raise AccError(f"missing_workflow_function_ref: Workflow function not found: {ref!r}")

    def _canonical_ref_for_entry(
        self,
        entry: WorkflowCatalogEntry,
        *,
        original_ref: str,
        template_source_path: Path | None,
        mode: WorkflowRefMode,
    ) -> tuple[str, bool]:
        if template_source_path is not None:
            template_dir = template_source_path.parent.resolve()
            if _is_relative_to(entry.path, template_dir):
                return entry.path.relative_to(template_dir).as_posix(), True

        if _is_relative_to(entry.path, self.workflows_dir):
            if mode == "runtime":
                return str(entry.path.resolve()), True
            return entry.path.name, True

        if _is_relative_to(entry.path, self.project_root):
            rel = entry.path.relative_to(self.project_root).as_posix()
            return (str(entry.path.resolve()) if mode == "runtime" else rel), True

        return str(entry.path.resolve()), False


def rewrite_workflow_function_refs(
    payload: dict[str, Any],
    *,
    catalog: WorkflowCatalog,
    template_source_path: Path,
    mode: WorkflowRefMode,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rewritten = _deepcopy_json(payload)
    resolutions: list[dict[str, Any]] = []
    for node in rewritten.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        ref = node.get("callable_ref")
        if not isinstance(ref, dict) or ref.get("kind") != "workflow_function":
            continue
        resolved = catalog.resolve(
            str(ref.get("id") or ""),
            template_source_path=template_source_path,
            mode=mode,
        )
        ref["id"] = resolved.canonical_ref
        resolutions.append(
            {
                **resolved.as_dict(),
                "node_id": str(node.get("id") or ""),
                "template_source_path": str(template_source_path),
            }
        )
    return rewritten, resolutions


def _deepcopy_json(payload: dict[str, Any]) -> dict[str, Any]:
    import json

    return json.loads(json.dumps(payload))


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False
