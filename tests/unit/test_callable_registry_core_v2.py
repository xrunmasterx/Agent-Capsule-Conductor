from __future__ import annotations

from pathlib import Path

from acc.callable_registry import CallableRegistry
from acc.control_plane import list_callables_payload, show_callable_payload


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
