"""Freeze Phase 1 legacy_full prompt/input baselines.

Runtime write contract: this script only writes under
``tests/fixtures/baselines/phase1/``. It runs workflows from
``examples/workflows/`` into a temporary directory, canonicalizes the
per-run absolute path to ``<<RUN_DIR>>``, then stores each node's
``input.json`` and ``resolved_prompt.md`` snapshots.
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

from acc.app import WorkflowAppService, load_clean_workflow_template

REPO_ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_DIR = REPO_ROOT / "examples" / "workflows"
BASELINE_ROOT = REPO_ROOT / "tests" / "fixtures" / "baselines" / "phase1"
RUN_DIR_PLACEHOLDER = b"<<RUN_DIR>>"

REPRESENTATIVE_FIXTURES = (
    "demo_two_node.graph.json",
    "demo_serial.graph.json",
    "environment_stateful_demo.accflow.json",
)


def _canonicalize(content: bytes, run_dir: Path) -> bytes:
    run_dir_str = str(run_dir.resolve())
    variants = [
        run_dir_str.encode("utf-8"),
        run_dir_str.replace("\\", "/").encode("utf-8"),
        run_dir_str.replace("\\", "\\\\").encode("utf-8"),
        run_dir_str.replace("\\", "/").replace("/", "\\\\").encode("utf-8"),
    ]
    ordered = sorted(set(variants), key=len, reverse=True)
    out = content
    for variant in ordered:
        out = out.replace(variant, RUN_DIR_PLACEHOLDER)
    return out


def _assert_under_baseline_root(path: Path) -> None:
    resolved = path.resolve()
    baseline_root = BASELINE_ROOT.resolve()
    if resolved != baseline_root and baseline_root not in resolved.parents:
        raise RuntimeError(f"refusing to write outside baseline root: {resolved}")


def _workflow_names() -> list[str]:
    names = {path.name for path in EXAMPLES_DIR.glob("*.accflow.json")}
    names.update(REPRESENTATIVE_FIXTURES)
    return sorted(names)


def _freeze_workflow(workflow_name: str, *, clean: bool) -> tuple[int, int]:
    workflow_path = EXAMPLES_DIR / workflow_name
    if not workflow_path.exists():
        raise FileNotFoundError(workflow_path)

    baseline_dir = BASELINE_ROOT / workflow_name
    _assert_under_baseline_root(baseline_dir)
    if clean and baseline_dir.exists():
        shutil.rmtree(baseline_dir)
    baseline_nodes_dir = baseline_dir / "nodes"
    _assert_under_baseline_root(baseline_nodes_dir)
    baseline_nodes_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="acc_phase1_freeze_") as tmp:
        run_dir = Path(tmp) / "run"
        result = WorkflowAppService().run_sync(
            workflow_path,
            run_dir,
            input_payload=_default_workflow_input(workflow_path),
        )
        status = result.get("status")
        if status not in {"success", "partial"}:
            raise RuntimeError(f"{workflow_name} did not succeed: status={status!r}")

        node_count = 0
        file_count = 0
        for node_dir in sorted((run_dir / "nodes").iterdir()):
            if not node_dir.is_dir():
                continue
            target_node_dir = baseline_nodes_dir / node_dir.name
            _assert_under_baseline_root(target_node_dir)
            target_node_dir.mkdir(parents=True, exist_ok=True)
            wrote_for_node = False
            for filename in ("input.json", "resolved_prompt.md"):
                source = node_dir / filename
                if not source.exists():
                    continue
                target = target_node_dir / filename
                _assert_under_baseline_root(target)
                target.write_bytes(_canonicalize(source.read_bytes(), run_dir))
                file_count += 1
                wrote_for_node = True
            if wrote_for_node:
                node_count += 1
        return node_count, file_count


def _default_workflow_input(workflow_path: Path) -> dict[str, object]:
    if workflow_path.suffixes[-2:] != [".accflow", ".json"]:
        return {}
    template = load_clean_workflow_template(workflow_path)
    return {
        port_id: {
            "task": f"Phase 1 baseline input for {workflow_path.name}:{port_id}",
        }
        for port_id in sorted(template.exposed_inputs)
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true", help="replace existing workflow baselines")
    args = parser.parse_args()

    BASELINE_ROOT.mkdir(parents=True, exist_ok=True)
    total_nodes = 0
    total_files = 0
    for workflow_name in _workflow_names():
        nodes, files = _freeze_workflow(workflow_name, clean=args.clean)
        total_nodes += nodes
        total_files += files
        print(f"{workflow_name}: captured {files} file(s) for {nodes} node(s)")
    print(f"captured {total_files} file(s) for {total_nodes} node(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
