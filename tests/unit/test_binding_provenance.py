"""Unit tests for ``acc.binding.provenance`` (TEST_PLAN T-006..T-007).

Exercises ``ProvenanceObject`` construction invariants — most importantly the
hash mutual-exclusion invariant X-4 / AUDIT C-016 — plus the JSON round-trip
helpers.
"""

from __future__ import annotations

import pytest

from acc.binding import ProvenanceObject


def _kwargs(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "producer_session_id": "session-1",
        "bundle_id": "bundle-1",
        "binding_applied": "selector",
        "call_depth": 0,
        "materialization_mode_resolved": "copy",
        "parent_frame_id": None,
        "invoking_workflow_call_id": None,
        "inline_value_sha256": "a" * 64,
        "source_artifact_sha256": None,
    }
    base.update(overrides)
    return base


def test_provenance_object_construction_valid() -> None:
    prov = ProvenanceObject(**_kwargs())

    assert prov.binding_applied == "selector"
    assert prov.materialization_mode_resolved == "copy"
    assert prov.schema_version == 1


def test_provenance_object_hash_mutex_inline_only() -> None:
    prov = ProvenanceObject(
        **_kwargs(inline_value_sha256="a" * 64, source_artifact_sha256=None)
    )

    assert prov.inline_value_sha256 == "a" * 64
    assert prov.source_artifact_sha256 is None


def test_provenance_object_hash_mutex_artifact_only() -> None:
    prov = ProvenanceObject(
        **_kwargs(inline_value_sha256=None, source_artifact_sha256="b" * 64)
    )

    assert prov.inline_value_sha256 is None
    assert prov.source_artifact_sha256 == "b" * 64


def test_provenance_object_hash_mutex_both_set_raises() -> None:
    """T-007: enforcing X-4 / AUDIT C-016 mutual exclusion."""
    with pytest.raises(ValueError, match="exactly one"):
        ProvenanceObject(
            **_kwargs(
                inline_value_sha256="a" * 64,
                source_artifact_sha256="b" * 64,
            )
        )


def test_provenance_object_hash_mutex_neither_set_raises() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        ProvenanceObject(
            **_kwargs(inline_value_sha256=None, source_artifact_sha256=None)
        )


def test_provenance_object_invalid_materialization_mode_raises() -> None:
    with pytest.raises(ValueError, match="materialization_mode_resolved"):
        ProvenanceObject(**_kwargs(materialization_mode_resolved="bogus"))


def test_provenance_object_negative_call_depth_raises() -> None:
    with pytest.raises(ValueError, match="call_depth"):
        ProvenanceObject(**_kwargs(call_depth=-1))


def test_provenance_object_jsonable_roundtrip() -> None:
    original = ProvenanceObject(
        **_kwargs(
            producer_session_id="sess-42",
            bundle_id="bundle-42",
            call_depth=3,
            materialization_mode_resolved="reference",
            parent_frame_id="frame-1",
            invoking_workflow_call_id="call-1",
            inline_value_sha256=None,
            source_artifact_sha256="c" * 64,
        )
    )

    data = original.to_jsonable()
    restored = ProvenanceObject.from_jsonable(data)

    assert restored == original
    assert data["schema_version"] == 1


def test_provenance_object_from_jsonable_rejects_unknown_keys() -> None:
    payload = ProvenanceObject(**_kwargs()).to_jsonable()
    payload["unexpected_field"] = "nope"

    with pytest.raises(ValueError, match="unknown"):
        ProvenanceObject.from_jsonable(payload)


def test_provenance_object_from_jsonable_rejects_non_dict() -> None:
    with pytest.raises(TypeError):
        ProvenanceObject.from_jsonable(["not", "a", "dict"])  # type: ignore[arg-type]
