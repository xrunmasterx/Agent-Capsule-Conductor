from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError

from acc.domain import PromptAppendixPolicy
from acc.utils import AccError


def render_prompt(
    template_path: Path,
    input_payload: dict[str, Any],
    *,
    appendix_policy: PromptAppendixPolicy,
) -> str:
    try:
        template_text = template_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise AccError(f"Prompt template not found: {template_path}") from exc

    return render_prompt_text(
        template_text,
        input_payload,
        appendix_policy=appendix_policy,
        source=str(template_path),
    )


def render_prompt_text(
    template_text: str,
    input_payload: dict[str, Any],
    *,
    appendix_policy: PromptAppendixPolicy,
    source: str = "<inline prompt>",
) -> str:
    environment = Environment(undefined=StrictUndefined, autoescape=False)
    try:
        template = environment.from_string(template_text)
        input_json = json.dumps(input_payload, ensure_ascii=False, indent=2, sort_keys=True)
        context = dict(input_payload)
        context["input"] = input_payload
        context["input_json"] = input_json
        rendered = template.render(**context)
        if appendix_policy is PromptAppendixPolicy.TASK_ONLY:
            task_value = input_payload.get("task")
            if task_value is None:
                return rendered
            return rendered.rstrip() + "\n\n## Task\n" + str(task_value) + "\n"
        if appendix_policy is PromptAppendixPolicy.NONE:
            return rendered
        raise AccError(f"Unsupported PromptAppendixPolicy: {appendix_policy!r}")
    except TemplateError as exc:
        raise AccError(f"Failed to render prompt {source}: {exc}") from exc
