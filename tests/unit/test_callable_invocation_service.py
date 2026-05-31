from __future__ import annotations

import pytest

from acc.app.invocation import CallableInvocationService
from acc.domain import NodeSpec
from acc.engine import normalize_node_invocation_spec
from acc.registry import CapsuleRegistry
from acc.utils import AccError

REGISTERED_CAPSULE = "echo-test.generic"


def make_service() -> CallableInvocationService:
    return CallableInvocationService(registry=CapsuleRegistry())


def callable_ref(node: NodeSpec):
    return normalize_node_invocation_spec(node).callable_ref


def test_resolve_backend_fake_vs_capsule() -> None:
    service = make_service()

    fake_node = NodeSpec(id="a", kind="agent", runtime="generic_fake_agent")
    assert service._resolve_agent_backend(callable_ref(fake_node), fake_node) == "fake"

    capsule_node = NodeSpec(
        id="b",
        kind="agent",
        runtime="capsule",
        raw={"callable_id": REGISTERED_CAPSULE, "legacy_capsule_id": REGISTERED_CAPSULE},
    )
    assert service._resolve_agent_backend(callable_ref(capsule_node), capsule_node) == "capsule"


def test_effective_capsule_id_prefers_callable_id() -> None:
    service = make_service()

    explicit_node = NodeSpec(
        id="n",
        kind="agent",
        runtime="capsule",
        raw={"callable_id": "x", "legacy_capsule_id": "y"},
    )
    assert service._effective_capsule_id(callable_ref(explicit_node), explicit_node) == "x"

    sentinel_node = NodeSpec(
        id="n2",
        kind="agent",
        runtime="capsule",
        raw={"legacy_capsule_id": "y"},
    )
    ref = callable_ref(sentinel_node)
    assert ref.id == "capsule"
    assert service._effective_capsule_id(ref, sentinel_node) == "y"


def test_unknown_agent_class_raises() -> None:
    service = make_service()

    unknown_node = NodeSpec(
        id="u",
        kind="agent",
        runtime="not-a-real-agent-class-xyz",
        raw={"callable_id": "not-a-real-agent-class-xyz"},
    )
    with pytest.raises(AccError, match="Unknown agent class"):
        service._resolve_agent_backend(callable_ref(unknown_node), unknown_node)
