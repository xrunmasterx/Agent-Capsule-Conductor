from pathlib import Path

import pytest

from acc.artifact_manifest import load_artifact_manifest_v2
from acc.utils import AccError
from acc.validation import validate_artifacts


def test_v1_artifact_manifest_remains_compatible(tmp_path: Path) -> None:
    manifest_path = tmp_path / "artifact_manifest.yaml"
    manifest_path.write_text("required:\n  - report.md\noptional: []\n", encoding="utf-8")

    manifest = load_artifact_manifest_v2(manifest_path)

    assert manifest.required[0].path == "report.md"
    assert manifest.required[0].viewer == "markdown"


def test_v2_display_fields_parse(tmp_path: Path) -> None:
    manifest_path = tmp_path / "artifact_manifest.yaml"
    manifest_path.write_text(
        "\n".join(
            [
                'version: "2.0"',
                "required:",
                "  - name: Report",
                "    path: report.md",
                "    type: markdown",
                "    display: primary",
                "    viewer: markdown",
                "optional: []",
            ]
        ),
        encoding="utf-8",
    )

    manifest = load_artifact_manifest_v2(manifest_path)

    assert manifest.required[0].name == "Report"
    assert manifest.required[0].display == "primary"


def test_unknown_viewer_type_fails(tmp_path: Path) -> None:
    manifest_path = tmp_path / "artifact_manifest.yaml"
    manifest_path.write_text(
        "required:\n  - name: Report\n    path: report.md\n    type: markdown\n    viewer: html\n",
        encoding="utf-8",
    )

    with pytest.raises(AccError, match="Invalid artifact manifest"):
        load_artifact_manifest_v2(manifest_path)


def test_required_artifacts_are_still_validated(tmp_path: Path) -> None:
    manifest_path = tmp_path / "artifact_manifest.yaml"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    manifest_path.write_text(
        "required:\n  - name: Report\n    path: report.md\n    type: markdown\n",
        encoding="utf-8",
    )

    assert validate_artifacts(artifact_dir, manifest_path) == [
        "Missing required artifact: report.md"
    ]


def test_path_traversal_is_rejected(tmp_path: Path) -> None:
    manifest_path = tmp_path / "artifact_manifest.yaml"
    manifest_path.write_text("required:\n  - path: ../outside.md\n", encoding="utf-8")

    with pytest.raises(AccError, match="escapes artifact directory"):
        load_artifact_manifest_v2(manifest_path)
