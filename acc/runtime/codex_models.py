from __future__ import annotations

from typing import Any

CODEX_DEFAULT_MODEL = "gpt-5.5"

CODEX_MODEL_OPTIONS: tuple[str, ...] = (
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "o3",
)

_CODEX_MODEL_ALIASES = {
    "": CODEX_DEFAULT_MODEL,
    "default": CODEX_DEFAULT_MODEL,
    "default model": CODEX_DEFAULT_MODEL,
    "默认模型": CODEX_DEFAULT_MODEL,
    "高能力模型": CODEX_DEFAULT_MODEL,
    "代码实现模型": CODEX_DEFAULT_MODEL,
    "代码审阅模型": CODEX_DEFAULT_MODEL,
    "长上下文模型": CODEX_DEFAULT_MODEL,
    "快速模型": "gpt-5.4-mini",
    "gpt5.5": "gpt-5.5",
    "gpt55": "gpt-5.5",
    "gpt5.5pro": "gpt-5.5-pro",
    "gpt5.4": "gpt-5.4",
    "gpt54": "gpt-5.4",
    "gpt5.4mini": "gpt-5.4-mini",
    "gpt54mini": "gpt-5.4-mini",
    "gpt5.4nano": "gpt-5.4-nano",
    "gpt54nano": "gpt-5.4-nano",
    "gpt5": "gpt-5",
}

_CODEX_REASONING_ALIASES = {
    "": "medium",
    "standard": "medium",
    "max": "xhigh",
    "maximum": "xhigh",
}


def normalize_codex_model(value: Any) -> str:
    raw = value.strip() if isinstance(value, str) else ""
    key = raw.lower().replace("_", "-").replace(" ", "")
    if raw in _CODEX_MODEL_ALIASES:
        return _CODEX_MODEL_ALIASES[raw]
    if key in _CODEX_MODEL_ALIASES:
        return _CODEX_MODEL_ALIASES[key]
    return raw or CODEX_DEFAULT_MODEL


def normalize_codex_reasoning_effort(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    key = raw.lower().replace("_", "-")
    return _CODEX_REASONING_ALIASES.get(key, raw or None)
