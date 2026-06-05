from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.graphops import graphops_governance_payload
from acc.run_index import load_or_rebuild_run_index
from acc.session import utc_now_iso
from acc.store import load_json
from acc.utils import AccError


def decision_inbox_payload(
    project_root: Path,
    *,
    limit: int,
    include_graphops: bool = True,
    include_events: bool = True,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    if include_events:
        items.extend(run_decision_items(project_root, limit=limit))
    if include_graphops and len(items) < limit:
        items.extend(graphops_decision_items(project_root, limit=limit - len(items)))
    items = items[:limit]
    return {
        "version": "1.0",
        "generated_at": utc_now_iso(),
        "counts": decision_counts(items),
        "items": items,
    }


def run_decision_items(project_root: Path, *, limit: int) -> list[dict[str, Any]]:
    index = load_or_rebuild_run_index(project_root / "runs")
    items: list[dict[str, Any]] = []
    for run in index.runs:
        if len(items) >= limit:
            break
        if run.status == "manual_review":
            items.append(
                base_run_item(
                    project_root,
                    kind="manual_review",
                    severity="medium",
                    title=f"运行需要人工确认: {run.run_id}",
                    summary=f"Workflow {run.workflow_id or 'unknown'} 进入 manual_review。",
                    run=run.model_dump(),
                )
            )
        elif run.status not in {"success", "running", "created", "skipped"}:
            items.append(
                base_run_item(
                    project_root,
                    kind="run_failed",
                    severity="high",
                    title=f"运行失败: {run.run_id}",
                    summary=f"Workflow {run.workflow_id or 'unknown'} 状态为 {run.status}。",
                    run=run.model_dump(),
                )
            )
        for node in run.nodes:
            if len(items) >= limit:
                break
            if node.status in {"success", "skipped"}:
                continue
            item = base_run_item(
                project_root,
                kind="node_failed",
                severity="high",
                title=f"节点失败: {node.node_id}",
                summary=node.summary or f"节点状态为 {node.status}。",
                run=run.model_dump(),
            )
            item["node"] = {
                "node_id": node.node_id,
                "callable_id": node.callable_id,
                "status": node.status,
                "summary": node.summary,
            }
            item["evidence"].extend(node_evidence(project_root, node.model_dump()))
            item["actions"].append(
                {
                    "id": "view_node",
                    "label": "查看节点",
                    "kind": "view_node",
                    "method": "GET",
                    "url": f"/api/runs/{run.run_id}/nodes/{node.node_id}",
                    "destructive": False,
                }
            )
            items.append(item)
    return items


def graphops_decision_items(project_root: Path, *, limit: int) -> list[dict[str, Any]]:
    graphops_root = project_root / "examples" / "graphops"
    if not graphops_root.exists():
        return []
    items: list[dict[str, Any]] = []
    for patch_path in sorted(graphops_root.glob("*.json")):
        if len(items) >= limit:
            break
        try:
            patch = load_json(patch_path)
        except AccError:
            continue
        if not isinstance(patch, dict):
            continue
        operations = patch.get("operations") if isinstance(patch.get("operations"), list) else []
        rel_path = relative_project_path(project_root, patch_path)
        patch_id = str(patch.get("patch_id") or patch_path.stem)
        items.append(
            {
                "id": f"graphops:{patch_id}",
                "kind": "graphops_proposal",
                "status": "open",
                "severity": "medium",
                "title": f"GraphOps 提案: {patch_id}",
                "summary": str(patch.get("rationale") or "待验证的 workflow/callable patch。"),
                "graphops": {
                    "patch_id": patch_id,
                    "patch_path": rel_path,
                    "target_type": str(patch.get("target_type") or ""),
                    "target_path": str(patch.get("target_path") or ""),
                    "operation_count": len(operations),
                    **graphops_governance_payload(),
                },
                "evidence": [
                    {
                        "label": "Patch",
                        "kind": "graphops_dry_run",
                        "path": rel_path,
                        "url": "/api/graphops/dry-run",
                    }
                ],
                "actions": [
                    {
                        "id": "validate_patch",
                        "label": "Validate",
                        "kind": "validate_patch",
                        "method": "POST",
                        "url": "/api/graphops/validate",
                        "destructive": False,
                    },
                    {
                        "id": "dry_run_patch",
                        "label": "Dry-run",
                        "kind": "dry_run_patch",
                        "method": "POST",
                        "url": "/api/graphops/dry-run",
                        "destructive": False,
                    },
                ],
            }
        )
    return items


def base_run_item(
    project_root: Path,
    *,
    kind: str,
    severity: str,
    title: str,
    summary: str,
    run: dict[str, Any],
) -> dict[str, Any]:
    run_id = str(run.get("run_id") or "")
    run_dir = str(run.get("run_dir") or "")
    return {
        "id": f"{kind}:{run_id}",
        "kind": kind,
        "status": "open",
        "severity": severity,
        "title": title,
        "summary": summary,
        "run": {
            "run_id": run_id,
            "workflow_id": run.get("workflow_id"),
            "status": str(run.get("status") or ""),
            "run_dir": run_dir,
        },
        "evidence": run_evidence(project_root, run),
        "actions": [
            {
                "id": "view_run",
                "label": "查看运行",
                "kind": "view_run",
                "method": "GET",
                "url": f"/api/runs/{run_id}",
                "destructive": False,
            }
        ],
    }


def run_evidence(project_root: Path, run: dict[str, Any]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    run_dir = Path(str(run.get("run_dir") or ""))
    for label, kind, raw_path in (
        ("Run Summary", "run", run_dir / "run_summary.json"),
        ("Workflow Events", "event_log", run_dir / "workflow_events.jsonl"),
    ):
        if raw_path.exists():
            rel = relative_project_path(project_root, raw_path)
            evidence.append({"label": label, "kind": kind, "path": rel, "url": artifact_url(rel)})
    return evidence


def node_evidence(project_root: Path, node: dict[str, Any]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for label, kind, key in (
        ("Input", "artifact", "input_path"),
        ("Output", "output", "output_path"),
        ("Events", "event_log", "event_log"),
        ("Stdout", "stdout", "stdout_log"),
        ("Stderr", "stderr", "stderr_log"),
    ):
        raw_path = node.get(key)
        if not raw_path:
            continue
        path = Path(str(raw_path))
        if not path.exists():
            continue
        rel = relative_project_path(project_root, path)
        evidence.append({"label": label, "kind": kind, "path": rel, "url": artifact_url(rel)})
    return evidence


def decision_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "open": len(items),
        "manual_review": sum(1 for item in items if item["kind"] == "manual_review"),
        "failed_runs": sum(1 for item in items if item["kind"] == "run_failed"),
        "failed_nodes": sum(1 for item in items if item["kind"] == "node_failed"),
        "graphops_proposals": sum(1 for item in items if item["kind"] == "graphops_proposal"),
    }


def artifact_url(path: str) -> str:
    return f"/api/artifacts/read?path={path}"


def relative_project_path(project_root: Path, path: Path) -> str:
    root = project_root.resolve()
    candidate = path if path.is_absolute() else root / path
    try:
        relative = candidate.resolve().relative_to(root)
    except ValueError:
        try:
            relative = candidate.relative_to(root)
        except ValueError as exc:
            raise AccError("Path is outside project root") from exc
    return str(relative).replace("\\", "/")
