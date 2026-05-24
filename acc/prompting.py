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
        return template.render(
            input=input_payload,
            input_json=json.dumps(input_payload, indent=2, sort_keys=True),
            **input_payload,
        )
    except TemplateError as exc:
        raise AccError(f"Failed to render prompt {template_path}: {exc}") from exc
