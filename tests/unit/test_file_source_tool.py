from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc import file_source_tool


def test_file_source_tool_writes_manifest_for_workspace_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "paper.md"
    source.write_text("# Paper\n", encoding="utf-8")
    input_path = tmp_path / "input.json"
    artifact_dir = tmp_path / "artifacts"
    output_path = tmp_path / "output.json"
    input_path.write_text(json.dumps({"path": "paper.md"}), encoding="utf-8")
    monkeypatch.setenv("ACC_INPUT_PATH", str(input_path))
    monkeypatch.setenv("ACC_ARTIFACT_DIR", str(artifact_dir))
    monkeypatch.setenv("ACC_OUTPUT_JSON", str(output_path))
    monkeypatch.setenv("ACC_ENVIRONMENT_WORKSPACE", str(workspace))

    file_source_tool.main()

    output = json.loads(output_path.read_text(encoding="utf-8"))
    manifest = json.loads((artifact_dir / "source_manifest.json").read_text(encoding="utf-8"))
    assert output["status"] == "success"
    assert output["source_type"] == "file"
    assert manifest["files"][0]["relative_path"] == "paper.md"
    assert manifest["files"][0]["sha256"]


def test_file_source_tool_rejects_path_outside_workspace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("outside\n", encoding="utf-8")
    input_path = tmp_path / "input.json"
    input_path.write_text(json.dumps({"path": str(outside)}), encoding="utf-8")
    monkeypatch.setenv("ACC_INPUT_PATH", str(input_path))
    monkeypatch.setenv("ACC_ARTIFACT_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setenv("ACC_OUTPUT_JSON", str(tmp_path / "output.json"))
    monkeypatch.setenv("ACC_ENVIRONMENT_WORKSPACE", str(workspace))

    with pytest.raises(SystemExit, match="escapes workflow workspace"):
        file_source_tool.main()
