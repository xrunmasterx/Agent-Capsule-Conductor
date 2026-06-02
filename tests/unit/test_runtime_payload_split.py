"""Unit tests for ``acc.runtime.payload.split_payloads``."""

from __future__ import annotations

from acc.runtime.payload import RUNTIME_ONLY_KEYS, split_payloads


def test_payload_split_extracts_runtime_only_keys_from_minimal_payload() -> None:
    merged = {
        "input": {"foo": 1},
        "__acc_runtime_metadata__": {"frame_id": "f-1"},
        "__acc_provenance__": [{"node_id": "n-1"}],
    }

    agent, runtime = split_payloads(merged)

    assert agent == {"input": {"foo": 1}}
    assert runtime == {
        "__acc_runtime_metadata__": {"frame_id": "f-1"},
        "__acc_provenance__": [{"node_id": "n-1"}],
    }


def test_payload_split_extracts_runtime_only_keys() -> None:
    merged = {
        "user_input": "hello",
        "context": [1, 2, 3],
        "__acc_runtime_metadata__": {"frame_id": "f-1"},
        "__acc_provenance__": [{"node_id": "n-1"}],
        "__acc_frame_id__": "f-1",
        "__acc_call_depth__": 2,
    }

    agent, runtime = split_payloads(merged)

    # All runtime-only keys must move to the runtime payload.
    for key in RUNTIME_ONLY_KEYS:
        assert key not in agent
        assert key in runtime

    # Non-runtime keys remain on the agent side.
    assert agent == {"user_input": "hello", "context": [1, 2, 3]}
    assert runtime == {
        "__acc_runtime_metadata__": {"frame_id": "f-1"},
        "__acc_provenance__": [{"node_id": "n-1"}],
        "__acc_frame_id__": "f-1",
        "__acc_call_depth__": 2,
    }
