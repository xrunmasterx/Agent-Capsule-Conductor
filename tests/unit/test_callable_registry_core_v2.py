from __future__ import annotations

from pathlib import Path

from acc.app.callable_refs import discover_known_callable_refs
from acc.callable_registry import CallableRegistry
from acc.control_plane import (
    CallableAlreadyExistsError,
    list_callables_payload,
    save_agent_callable_payload,
    show_callable_payload,
)
from acc.utils import AccError


def test_callable_registry_loads_agent_ports_and_metadata(tmp_path: Path) -> None:
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
default_prompt: Collect market facts.
input_ports:
  main:
    type: artifact
    required: true
output_ports:
  report:
    type: artifact
    required: true
metadata:
  name: Stock Agent
  description: Collects stock market facts.
""".strip(),
        encoding="utf-8",
    )

    asset = CallableRegistry.from_project_root(tmp_path).resolve_class_id("stock.codex")

    assert asset.template.input_ports["main"].direction == "input"
    assert asset.template.input_ports["main"].required is True
    assert asset.template.output_ports["report"].direction == "output"
    assert asset.template.metadata["name"] == "Stock Agent"


def test_callable_registry_ref_keys_exposes_only_discovered_templates(tmp_path: Path) -> None:
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
""".strip(),
        encoding="utf-8",
    )

    refs = CallableRegistry.from_project_root(tmp_path).ref_keys()

    assert refs == {("agent_class", "stock.codex")}
    assert ("tool_class", "fake_producer") not in refs
    assert ("agent_class", "generic_fake_agent") not in refs


def test_known_callable_refs_adds_hermetic_set_without_generic_cli(tmp_path: Path) -> None:
    refs, workflow_ids = discover_known_callable_refs(CallableRegistry.from_project_root(tmp_path))

    assert workflow_ids == set()
    assert ("tool_class", "fake_producer") in refs
    assert ("tool_class", "fail") in refs
    assert ("agent_class", "generic_fake_agent") in refs
    assert ("agent_class", "fake-agent.generic") in refs
    assert ("agent_class", "generic_cli") not in refs


def test_callables_payload_exposes_display_name_and_description(tmp_path: Path) -> None:
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
metadata:
  name: Stock Agent
  description: Collects stock market facts.
""".strip(),
        encoding="utf-8",
    )

    payload = list_callables_payload(tmp_path)
    detail = show_callable_payload("stock.codex", tmp_path)["callable"]

    assert payload["callables"][0]["name"] == "Stock Agent"
    assert payload["callables"][0]["description"] == "Collects stock market facts."
    assert detail["name"] == "Stock Agent"


def test_save_agent_callable_payload_writes_valid_template(tmp_path: Path) -> None:
    result = save_agent_callable_payload(
        tmp_path,
        "stock-ui-created.codex",
        {
            "id": "stock-ui-created.codex",
            "runtime": "codex_cli",
            "name": "Stock UI Created",
            "description": "Created through control plane.",
            "default_prompt": "Use a fixed market research methodology.",
        },
        overwrite=False,
    )

    assert result["status"] == "saved"
    assert result["callable"]["name"] == "Stock UI Created"
    assert result["callable"]["artifact_contract"]["output_schema"]["properties"][
        "schema_version"
    ]["enum"] == ["acc.agent.output.v1"]
    assert (
        tmp_path / "callables" / "agents" / "stock-ui-created.codex.yaml"
    ).exists()


def test_save_agent_callable_payload_rejects_duplicate_without_overwrite(
    tmp_path: Path,
) -> None:
    payload = {"id": "stock-ui-created.codex", "runtime": "codex_cli"}
    save_agent_callable_payload(tmp_path, "stock-ui-created.codex", payload, overwrite=False)

    try:
        save_agent_callable_payload(tmp_path, "stock-ui-created.codex", payload, overwrite=False)
    except CallableAlreadyExistsError as exc:
        assert "already exists" in str(exc)
    else:
        raise AssertionError("duplicate callable creation should fail")


def test_save_agent_callable_payload_rejects_invalid_id(tmp_path: Path) -> None:
    try:
        save_agent_callable_payload(
            tmp_path,
            "../escape",
            {"id": "../escape", "runtime": "codex_cli"},
            overwrite=False,
        )
    except AccError as exc:
        assert "Callable id must match" in str(exc)
    else:
        raise AssertionError("invalid callable id should fail")

    assert not (tmp_path / "callables").exists()
