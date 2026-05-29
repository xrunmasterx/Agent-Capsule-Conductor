from pathlib import Path

import pytest

from acc.prompting import render_prompt
from acc.utils import AccError


def test_renders_prompt_with_input_json(tmp_path: Path) -> None:
    template = tmp_path / "prompt_template.md"
    template.write_text("Message: {{ input.message }}\n{{ input_json }}", encoding="utf-8")

    rendered = render_prompt(template, {"message": "hello"})

    assert "Message: hello" in rendered
    assert '"message": "hello"' in rendered


def test_missing_variable_produces_readable_error(tmp_path: Path) -> None:
    template = tmp_path / "prompt_template.md"
    template.write_text("{{ input.missing.value }}", encoding="utf-8")

    with pytest.raises(AccError, match="Failed to render prompt"):
        render_prompt(template, {"message": "hello"})


def test_large_input_payload_does_not_crash(tmp_path: Path) -> None:
    template = tmp_path / "prompt_template.md"
    template.write_text("{{ input_json }}", encoding="utf-8")

    rendered = render_prompt(template, {"items": list(range(1000))})

    assert "999" in rendered


def test_template_without_input_json_still_receives_runtime_input(tmp_path: Path) -> None:
    template = tmp_path / "prompt_template.md"
    template.write_text("Collect market news.", encoding="utf-8")

    rendered = render_prompt(
        template,
        {"topic": "semiconductor", "upstream_context": [{"node_id": "a"}]},
    )

    assert "Collect market news." in rendered
    assert "## ACC Runtime Input" in rendered
    assert '"topic": "semiconductor"' in rendered
    assert '"upstream_context"' in rendered
