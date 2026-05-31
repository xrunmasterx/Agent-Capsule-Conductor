from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError

from acc.utils import AccError


def render_prompt(template_path: Path, input_payload: dict[str, Any]) -> str:
    try:
        template_text = template_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise AccError(f"Prompt template not found: {template_path}") from exc

    environment = Environment(undefined=StrictUndefined, autoescape=False)
    try:
        template = environment.from_string(template_text)
        input_json = json.dumps(input_payload, ensure_ascii=False, indent=2, sort_keys=True)
        rendered = template.render(
            input=input_payload,
            input_json=input_json,
            **input_payload,
        )
        if "input_json" in template_text:
            return rendered
        return (
            rendered.rstrip() + "\n\n## ACC Runtime Input\n" + "```json\n" + input_json + "\n```\n"
        )
    except TemplateError as exc:
        raise AccError(f"Failed to render prompt {template_path}: {exc}") from exc
