"""Selector ADT for binding resolution.

See DESIGN.md §7 (Binding Model) and IMPLEMENTATION_STRATEGY.md §4.4 / §6.1
PR-1.4. Phase 1 skeleton only: parse-time validation; resolution layer is
filled in by later phases (Phase 2 explicit_only, Phase 3 ResultStore-backed).
"""
from __future__ import annotations

from dataclasses import dataclass


class SelectorParseError(ValueError):
    """Raised when a selector string fails to parse."""


@dataclass(frozen=True)
class FieldSelector:
    """Field-level selector against an AgentPayload dict (dotted path)."""

    path: str


@dataclass(frozen=True)
class OutboxSelector:
    """Selector against a producer node's outbox record."""

    path: str


@dataclass(frozen=True)
class ArtifactSelector:
    """Selector against an artifact bundle entry."""

    path: str


@dataclass(frozen=True)
class EachOfSelector:
    """Fan-in selector wrapping an inner leaf selector with a target port id."""

    inner: Selector
    fan_in_port_id: str


Selector = FieldSelector | OutboxSelector | ArtifactSelector | EachOfSelector


_LEAF_NAMESPACES: dict[str, type] = {
    "field": FieldSelector,
    "outbox": OutboxSelector,
    "artifact": ArtifactSelector,
}


def parse_selector(raw: str) -> Selector:
    """Parse a selector string of form ``namespace:<path>``.

    Supported namespaces:
    - ``field:<dotted.path>``       -> :class:`FieldSelector`
    - ``outbox:<path>``             -> :class:`OutboxSelector`
    - ``artifact:<path>``           -> :class:`ArtifactSelector`
    - ``each_of:<fan_in_port_id>:<leaf-selector>`` -> :class:`EachOfSelector`

    ``each_of`` selectors may not be nested. Any other shape raises
    :class:`SelectorParseError`.
    """
    if not isinstance(raw, str):
        raise SelectorParseError(
            f"selector must be a string, got {type(raw).__name__}"
        )
    stripped = raw.strip()
    if not stripped:
        raise SelectorParseError("selector string is empty")
    if ":" not in stripped:
        raise SelectorParseError(
            f"selector missing namespace separator ':' (got {raw!r})"
        )

    namespace, _, rest = stripped.partition(":")
    namespace = namespace.strip()

    if namespace in _LEAF_NAMESPACES:
        path = rest.strip()
        if not path:
            raise SelectorParseError(
                f"selector path is empty for namespace {namespace!r}"
            )
        return _LEAF_NAMESPACES[namespace](path=path)

    if namespace == "each_of":
        if ":" not in rest:
            raise SelectorParseError(
                "each_of selector requires format "
                "'each_of:<fan_in_port_id>:<inner-selector>'"
            )
        port_id, _, inner_raw = rest.partition(":")
        port_id = port_id.strip()
        if not port_id:
            raise SelectorParseError("each_of fan_in_port_id is empty")
        inner = parse_selector(inner_raw)
        if isinstance(inner, EachOfSelector):
            raise SelectorParseError("each_of selectors may not be nested")
        return EachOfSelector(inner=inner, fan_in_port_id=port_id)

    raise SelectorParseError(
        f"unknown selector namespace {namespace!r}; expected one of "
        f"{sorted({*_LEAF_NAMESPACES, 'each_of'})}"
    )


__all__ = [
    "ArtifactSelector",
    "EachOfSelector",
    "FieldSelector",
    "OutboxSelector",
    "Selector",
    "SelectorParseError",
    "parse_selector",
]
