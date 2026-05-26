from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from acc.environment import EnvironmentFrame, file_artifact, write_json
from acc.utils import AccError, load_json


def node_port_ids(node: dict[str, Any], key: str, fallback: str) -> list[str]:
    ports = node.get(key)
    if not isinstance(ports, list) or not ports:
        return [fallback]
    result: list[str] = []
    for port in ports:
        if isinstance(port, dict) and isinstance(port.get("id"), str):
            result.append(port["id"])
    return result or [fallback]


def required_input_ports(node: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    for port in node.get("input_ports") or []:
        if (
            isinstance(port, dict)
            and port.get("required", False)
            and isinstance(port.get("id"), str)
        ):
            result.add(port["id"])
    return result


def write_node_outboxes(
    environment: EnvironmentFrame,
    node: dict[str, Any],
    conductor_output: dict[str, Any],
) -> dict[str, Path]:
    node_id = node["id"]
    session_id = str(conductor_output.get("session_id") or "")
    source_artifacts = collect_source_artifacts(conductor_output)
    outboxes: dict[str, Path] = {}
    for port_id in node_port_ids(node, "output_ports", "main"):
        outbox_dir = environment.outbox_root / node_id / port_id
        outbox_dir.mkdir(parents=True, exist_ok=True)
        artifacts: list[dict[str, Any]] = []
        for source in source_artifacts:
            target = outbox_dir / source.name
            copy_path(source, target)
            if target.is_file():
                artifacts.append(file_artifact(target, outbox_dir))
            else:
                artifacts.append(
                    {
                        "name": target.name,
                        "type": "directory",
                        "path": target.name,
                        "size_bytes": 0,
                    }
                )
        bundle = {
            "bundle_id": f"bundle_{node_id}_{port_id}",
            "producer_node_id": node_id,
            "producer_session_id": session_id,
            "artifacts": artifacts,
        }
        manifest = {
            "port_id": port_id,
            "node_id": node_id,
            "direction": "output",
            "session_id": session_id,
            "bundle": bundle,
            "artifacts": artifacts,
        }
        write_json(outbox_dir / "artifact_bundle.json", bundle)
        write_json(outbox_dir / "outbox_manifest.json", manifest)
        outboxes[port_id] = outbox_dir
    return outboxes


def collect_source_artifacts(conductor_output: dict[str, Any]) -> list[Path]:
    result: list[Path] = []
    output_path = conductor_output.get("output_path")
    if isinstance(output_path, str) and output_path:
        output = Path(output_path)
        if output.exists():
            result.append(output)
    artifact_dir = conductor_output.get("artifact_dir")
    if isinstance(artifact_dir, str) and artifact_dir:
        root = Path(artifact_dir)
        if root.exists():
            result.extend(sorted(path for path in root.iterdir()))
    return result


def materialize_inbox(
    environment: EnvironmentFrame,
    edge: dict[str, Any],
    source_outboxes: dict[str, dict[str, Path]],
) -> Path:
    source_node = edge["from"]["node"]
    source_port = edge["from"].get("port") or edge["from"].get("output") or "main"
    target_node = edge["to"]["node"]
    target_port = edge["to"].get("port") or edge["to"].get("input") or "main"
    materialization = str(edge.get("materialization") or "copy")
    if materialization not in {"copy", "reference", "link"}:
        raise AccError(f"Unsupported materialization mode: {materialization}")
    source_dir = source_outboxes.get(source_node, {}).get(source_port)
    if source_dir is None or not source_dir.exists():
        raise AccError(f"Missing outbox for {source_node}.{source_port}")

    source_ref = f"{source_node}_{source_port}"
    inbox_dir = environment.inbox_root / target_node / target_port / source_ref
    inbox_dir.mkdir(parents=True, exist_ok=True)
    copied_artifacts: list[dict[str, Any]] = []
    if materialization == "reference":
        manifest_path = source_dir / "outbox_manifest.json"
        write_json(
            inbox_dir / "reference_manifest.json",
            {
                "source_outbox": str(source_dir.resolve()),
                "source_manifest": str(manifest_path.resolve()),
            },
        )
    else:
        for child in source_dir.iterdir():
            if child.name in {"outbox_manifest.json", "artifact_bundle.json"}:
                continue
            target = inbox_dir / child.name
            copy_path(child, target)
            if target.is_file():
                copied_artifacts.append(file_artifact(target, inbox_dir))
            else:
                copied_artifacts.append(
                    {
                        "name": target.name,
                        "type": "directory",
                        "path": target.name,
                        "size_bytes": 0,
                    }
                )

    source_manifest = load_json(source_dir / "outbox_manifest.json")
    manifest = {
        "port_id": target_port,
        "node_id": target_node,
        "direction": "input",
        "source_refs": [source_ref],
        "source_node_id": source_node,
        "source_port_id": source_port,
        "source_session_id": source_manifest.get("session_id"),
        "source_outbox": str(source_dir.resolve()),
        "materialization": materialization,
        "artifacts": copied_artifacts or source_manifest.get("artifacts", []),
    }
    write_json(inbox_dir / "inbox_manifest.json", manifest)
    return inbox_dir


def summarize_inbox_for_input(inbox_node_root: Path) -> dict[str, Any]:
    if not inbox_node_root.exists():
        return {}
    manifests = sorted(inbox_node_root.glob("*/*/inbox_manifest.json"))
    return {
        "inbox_root": str(inbox_node_root.resolve()),
        "manifests": [str(path.resolve()) for path in manifests],
    }


def copy_path(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
        return
    if source.resolve() == target.resolve():
        return
    shutil.copy2(source, target)


def inspect_ports_run(run_dir: Path) -> dict[str, Any]:
    manifests: list[dict[str, Any]] = []
    for manifest_path in sorted((run_dir / "environments").glob("*/.acc/**/inbox_manifest.json")):
        payload = load_json(manifest_path)
        payload["manifest_path"] = str(manifest_path.resolve())
        manifests.append(payload)
    for manifest_path in sorted((run_dir / "environments").glob("*/.acc/**/outbox_manifest.json")):
        payload = load_json(manifest_path)
        payload["manifest_path"] = str(manifest_path.resolve())
        manifests.append(payload)
    return {
        "run_dir": str(run_dir.resolve()),
        "manifests": manifests,
        "inboxes": [item for item in manifests if item.get("direction") == "input"],
        "outboxes": [item for item in manifests if item.get("direction") == "output"],
    }


def port_payload_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)
