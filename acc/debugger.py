from __future__ import annotations

import difflib
import hashlib
import json
from pathlib import Path
from typing import Any

from acc.run_index import RunSummary, load_run_summary, write_json
from acc.utils import AccError

TEXT_EXTENSIONS = {
    ".json",
    ".jsonl",
    ".md",
    ".txt",
    ".log",
    ".yaml",
    ".yml",
}


def replay_workflow_events(run_dir: Path, node_id: str | None = None) -> dict[str, Any]:
    resolved_run_dir = resolve_run_dir(run_dir)
    events = read_events(resolved_run_dir / "events.jsonl")
    if node_id is not None:
        events = [
            event
            for event in events
            if event.get("node_id") in {None, node_id}
            or event.get("payload", {}).get("node_id") == node_id
        ]
    payload = {
        "run_dir": str(resolved_run_dir),
        "node_filter": node_id,
        "event_log": str((resolved_run_dir / "events.jsonl").resolve()),
        "timeline": sorted(events, key=lambda event: str(event.get("timestamp") or "")),
    }
    write_json(resolved_run_dir / "replay_manifest.json", payload)
    return payload


def rerun_single_node(run_dir: Path, node_id: str, out_dir: Path) -> dict[str, Any]:
    _ = run_dir, node_id, out_dir
    raise AccError(
        "Debugger rerun is disabled until it is rebuilt on RunRecord, EventLog, and ResultStore."
    )


def rerun_from_node(run_dir: Path, node_id: str, out_dir: Path) -> dict[str, Any]:
    _ = run_dir, node_id, out_dir
    raise AccError(
        "Debugger rerun-from is disabled until it is rebuilt on RunRecord, "
        "EventLog, and ResultStore."
    )


def fork_run(
    run_dir: Path,
    node_id: str,
    override_path: Path,
    out_dir: Path,
) -> dict[str, Any]:
    _ = run_dir, node_id, override_path, out_dir
    raise AccError(
        "Debugger fork is disabled until it is rebuilt on RunRecord, EventLog, and ResultStore."
    )


def diff_runs(run_a: Path, run_b: Path) -> dict[str, Any]:
    run_a_dir = resolve_run_dir(run_a)
    run_b_dir = resolve_run_dir(run_b)
    summary_a = require_run_summary(run_a_dir)
    summary_b = require_run_summary(run_b_dir)

    nodes_a = {node.node_id: node for node in summary_a.nodes}
    nodes_b = {node.node_id: node for node in summary_b.nodes}
    node_ids = sorted(set(nodes_a) | set(nodes_b))
    node_diffs = []
    for current_node_id in node_ids:
        node_a = nodes_a.get(current_node_id)
        node_b = nodes_b.get(current_node_id)
        node_diffs.append(
            {
                "node_id": current_node_id,
                "status": {
                    "a": None if node_a is None else node_a.status,
                    "b": None if node_b is None else node_b.status,
                    "changed": status_value(node_a) != status_value(node_b),
                },
                "output_diff": None
                if node_a is None or node_b is None
                else artifact_diff(node_a.output_path, node_b.output_path),
                "artifact_dir_diff": None
                if node_a is None or node_b is None
                else artifact_diff(node_a.artifact_dir, node_b.artifact_dir),
            }
        )

    return {
        "run_a": str(run_a_dir.resolve()),
        "run_b": str(run_b_dir.resolve()),
        "status": {
            "a": summary_a.status,
            "b": summary_b.status,
            "changed": summary_a.status != summary_b.status,
        },
        "workflow_id": {
            "a": summary_a.workflow_id,
            "b": summary_b.workflow_id,
            "changed": summary_a.workflow_id != summary_b.workflow_id,
        },
        "node_diffs": node_diffs,
        "changed_nodes": [diff["node_id"] for diff in node_diffs if node_changed(diff)],
    }


def artifact_diff(artifact_a: str | Path | None, artifact_b: str | Path | None) -> dict[str, Any]:
    path_a = None if artifact_a in {None, ""} else Path(str(artifact_a))
    path_b = None if artifact_b in {None, ""} else Path(str(artifact_b))
    exists_a = path_a is not None and path_a.exists()
    exists_b = path_b is not None and path_b.exists()
    payload = {
        "artifact_a": None if path_a is None else str(path_a.resolve()),
        "artifact_b": None if path_b is None else str(path_b.resolve()),
        "exists": {"a": exists_a, "b": exists_b},
    }
    if not exists_a or not exists_b:
        return {**payload, "kind": "existence", "same": exists_a and exists_b, "diff": []}
    if path_a is None or path_b is None:
        return {**payload, "kind": "existence", "same": False, "diff": []}
    if path_a.is_dir() or path_b.is_dir():
        return {
            **payload,
            "kind": "directory",
            "same": directory_fingerprint(path_a) == directory_fingerprint(path_b),
            "diff": directory_diff(path_a, path_b),
        }

    json_a = parse_json_file(path_a)
    json_b = parse_json_file(path_b)
    if json_a is not None and json_b is not None:
        same = json_a == json_b
        return {
            **payload,
            "kind": "json",
            "same": same,
            "diff": []
            if same
            else text_diff(
                json.dumps(json_a, indent=2, sort_keys=True),
                json.dumps(json_b, indent=2, sort_keys=True),
            ),
        }
    if path_a.suffix.lower() in TEXT_EXTENSIONS and path_b.suffix.lower() in TEXT_EXTENSIONS:
        text_a = path_a.read_text(encoding="utf-8", errors="replace")
        text_b = path_b.read_text(encoding="utf-8", errors="replace")
        return {
            **payload,
            "kind": "text",
            "same": text_a == text_b,
            "diff": text_diff(text_a, text_b),
        }
    return {
        **payload,
        "kind": "binary",
        "same": file_sha256(path_a) == file_sha256(path_b),
        "diff": [],
    }


def read_events(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            events.append(payload)
    return events


def resolve_run_dir(run_dir: Path) -> Path:
    resolved = run_dir.resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise AccError(f"Run directory not found: {run_dir}")
    return resolved


def require_run_summary(run_dir: Path) -> RunSummary:
    summary = load_run_summary(run_dir)
    if summary is None:
        raise AccError(f"Run summary not found: {run_dir}")
    return summary


def status_value(node: Any | None) -> str | None:
    return None if node is None else str(node.status)


def node_changed(diff: dict[str, Any]) -> bool:
    return bool(
        diff["status"]["changed"]
        or (diff.get("output_diff") or {}).get("same") is False
        or (diff.get("artifact_dir_diff") or {}).get("same") is False
    )


def parse_json_file(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def text_diff(text_a: str, text_b: str) -> list[str]:
    return list(
        difflib.unified_diff(
            text_a.splitlines(),
            text_b.splitlines(),
            fromfile="a",
            tofile="b",
            lineterm="",
        )
    )


def directory_fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    if not path.exists() or not path.is_dir():
        return ""
    for item in sorted(file for file in path.rglob("*") if file.is_file()):
        digest.update(str(item.relative_to(path)).encode())
        digest.update(file_sha256(item).encode())
    return digest.hexdigest()


def directory_diff(path_a: Path, path_b: Path) -> list[str]:
    files_a = {
        str(item.relative_to(path_a)): file_sha256(item)
        for item in path_a.rglob("*")
        if item.is_file()
    }
    files_b = {
        str(item.relative_to(path_b)): file_sha256(item)
        for item in path_b.rglob("*")
        if item.is_file()
    }
    lines: list[str] = []
    for name in sorted(set(files_a) | set(files_b)):
        if name not in files_a:
            lines.append(f"+ {name}")
        elif name not in files_b:
            lines.append(f"- {name}")
        elif files_a[name] != files_b[name]:
            lines.append(f"~ {name}")
    return lines


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
