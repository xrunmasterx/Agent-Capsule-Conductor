from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.runner import CapsuleRunner
from acc.scaffold import scaffold_capsule
from acc.utils import AccError, load_json
from acc.validation import validate_payload


def test_valid_blueprint_generates_required_files(tmp_path: Path) -> None:
    capsules_dir = tmp_path / "capsules"

    result = scaffold_capsule(
        blueprint_path=Path("examples/blueprints/simple_research_capsule.json"),
        capsules_dir=capsules_dir,
        force=False,
    )

    capsule_dir = capsules_dir / "demo-research.generic"
    assert result["status"] == "scaffolded"
    for relative_path in [
        "capsule.yaml",
        "prompt_template.md",
        "input_schema.json",
        "output_schema.json",
        "artifact_manifest.yaml",
        "examples/input.json",
    ]:
        assert (capsule_dir / relative_path).exists()
    capsule = CapsuleRegistry(capsules_dir).get("demo-research.generic")
    assert validate_capsule_files(capsule) == []


def test_generated_example_input_matches_input_schema(tmp_path: Path) -> None:
    capsules_dir = tmp_path / "capsules"
    scaffold_capsule(
        blueprint_path=Path("examples/blueprints/simple_research_capsule.json"),
        capsules_dir=capsules_dir,
    )
    capsule_dir = capsules_dir / "demo-research.generic"

    validate_payload(
        load_json(capsule_dir / "examples" / "input.json"),
        capsule_dir / "input_schema.json",
    )


def test_generated_output_schema_includes_required_fields(tmp_path: Path) -> None:
    capsules_dir = tmp_path / "capsules"
    scaffold_capsule(
        blueprint_path=Path("examples/blueprints/simple_research_capsule.json"),
        capsules_dir=capsules_dir,
    )

    output_schema = load_json(capsules_dir / "demo-research.generic" / "output_schema.json")

    assert output_schema["required"] == ["status", "summary", "recommendation"]
    assert "recommendation" in output_schema["properties"]


def test_duplicate_capsule_id_fails_without_force(tmp_path: Path) -> None:
    capsules_dir = tmp_path / "capsules"
    scaffold_capsule(
        blueprint_path=Path("examples/blueprints/simple_research_capsule.json"),
        capsules_dir=capsules_dir,
    )

    with pytest.raises(AccError, match="already exists"):
        scaffold_capsule(
            blueprint_path=Path("examples/blueprints/simple_research_capsule.json"),
            capsules_dir=capsules_dir,
        )


def test_invalid_runtime_fails(tmp_path: Path) -> None:
    blueprint = tmp_path / "bad.json"
    data = load_json(Path("examples/blueprints/simple_research_capsule.json"))
    data["runtime"] = "bad_runtime"
    blueprint.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(JsonSchemaValidationError, match="bad_runtime"):
        scaffold_capsule(blueprint_path=blueprint, capsules_dir=tmp_path / "capsules")


def test_path_traversal_in_capsule_id_fails(tmp_path: Path) -> None:
    blueprint = tmp_path / "bad.json"
    data = load_json(Path("examples/blueprints/simple_research_capsule.json"))
    data["id"] = "../bad.generic"
    blueprint.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(JsonSchemaValidationError, match="does not match"):
        scaffold_capsule(blueprint_path=blueprint, capsules_dir=tmp_path / "capsules")


def test_scaffolded_generic_capsule_runs_hermetically(tmp_path: Path) -> None:
    capsules_dir = tmp_path / "capsules"
    scaffold_capsule(
        blueprint_path=Path("examples/blueprints/simple_research_capsule.json"),
        capsules_dir=capsules_dir,
    )
    runner = CapsuleRunner(registry=CapsuleRegistry(capsules_dir))

    output = asyncio.run(
        runner.run(
            "demo-research.generic",
            load_json(capsules_dir / "demo-research.generic" / "examples" / "input.json"),
            tmp_path / "run",
        )
    )

    assert output["status"] == "success"
    payload = load_json(Path(output["output_path"]))
    assert payload["status"] == "success"
    assert payload["recommendation"]
    assert (Path(output["artifact_dir"]) / "report.md").exists()
