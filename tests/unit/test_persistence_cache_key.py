"""Unit tests for ``acc.persistence.cache_key.compute_cache_key``.

Covers TEST_PLAN.md cases:
- test_cache_key_deterministic_same_inputs_same_hash
- test_cache_key_different_callable_version_different_hash
"""

from __future__ import annotations

from acc.persistence.cache_key import compute_cache_key


def test_cache_key_deterministic_same_inputs_same_hash() -> None:
    inputs = ["sha-a", "sha-b", "sha-c"]

    first = compute_cache_key("callable-1", "v1", inputs)
    second = compute_cache_key("callable-1", "v1", inputs)

    assert first == second
    # SHA-256 hex digest length == 64.
    assert len(first) == 64
    assert all(ch in "0123456789abcdef" for ch in first)


def test_cache_key_different_callable_version_different_hash() -> None:
    inputs = ["sha-a", "sha-b"]

    v1_key = compute_cache_key("callable-1", "v1", inputs)
    v2_key = compute_cache_key("callable-1", "v2", inputs)

    assert v1_key != v2_key

    # And changing callable_id alone must also change the hash.
    other_id_key = compute_cache_key("callable-2", "v1", inputs)
    assert v1_key != other_id_key

    # Reordering inputs must change the hash (caller owns ordering).
    reordered_key = compute_cache_key("callable-1", "v1", ["sha-b", "sha-a"])
    assert v1_key != reordered_key

