"""Unit tests for ``acc.binding.selector`` (TEST_PLAN T-001..T-005).

Covers ``parse_selector`` for the four supported namespaces (field / outbox /
artifact / each_of) and the malformed-input rejection paths that map to
``SelectorParseError``.
"""

from __future__ import annotations

import pytest

from acc.binding import (
    ArtifactSelector,
    EachOfSelector,
    FieldSelector,
    OutboxSelector,
    SelectorParseError,
    parse_selector,
)


def test_parse_selector_field_namespace() -> None:
    selector = parse_selector("field:payload.title")

    assert isinstance(selector, FieldSelector)
    assert selector.path == "payload.title"


def test_parse_selector_outbox_namespace() -> None:
    selector = parse_selector("outbox:producer.main")

    assert isinstance(selector, OutboxSelector)
    assert selector.path == "producer.main"


def test_parse_selector_artifact_namespace() -> None:
    selector = parse_selector("artifact:bundle/result.json")

    assert isinstance(selector, ArtifactSelector)
    assert selector.path == "bundle/result.json"


def test_parse_selector_each_of_namespace() -> None:
    selector = parse_selector("each_of:fan_in_port:outbox:producer.main")

    assert isinstance(selector, EachOfSelector)
    assert selector.fan_in_port_id == "fan_in_port"
    assert isinstance(selector.inner, OutboxSelector)
    assert selector.inner.path == "producer.main"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "no_separator",
        "unknown_ns:foo",
        "field:",
        "each_of:only_port",
        "each_of::outbox:producer.main",
        "each_of:port:each_of:other:outbox:producer.main",
    ],
)
def test_parse_selector_invalid_raises(raw: str) -> None:
    with pytest.raises(SelectorParseError):
        parse_selector(raw)


def test_parse_selector_non_string_raises() -> None:
    with pytest.raises(SelectorParseError):
        parse_selector(123)  # type: ignore[arg-type]
