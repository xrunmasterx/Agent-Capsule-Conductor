"""Unit tests for ``acc.runtime.transfer_policy.materialize``.

Covers TEST_PLAN.md cases:
- test_transfer_policy_copy_actual
- test_transfer_policy_reference_falls_back_on_oserror_to_copy_with_degraded_flag
"""

from __future__ import annotations

from pathlib import Path

import pytest

from acc.runtime.transfer_policy import TransferPolicy, materialize


def test_transfer_policy_copy_actual(tmp_path: Path) -> None:
    src = tmp_path / "src.txt"
    dst = tmp_path / "out" / "dst.txt"
    src.write_bytes(b"payload-bytes")

    actual, degraded = materialize(src, dst, TransferPolicy.COPY)

    assert actual is TransferPolicy.COPY
    assert degraded is False
    assert dst.is_file()
    assert dst.read_bytes() == b"payload-bytes"
    # COPY should produce a real, independent file (not a symlink).
    assert not dst.is_symlink()


def test_transfer_policy_reference_falls_back_on_oserror_to_copy_with_degraded_flag(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    src = tmp_path / "src.txt"
    dst = tmp_path / "out" / "dst.txt"
    src.write_bytes(b"payload-bytes")

    def fail_hardlink(self: Path, target: Path) -> None:  # noqa: ARG001
        raise OSError("hardlink not supported on this filesystem")

    monkeypatch.setattr(Path, "hardlink_to", fail_hardlink)

    actual, degraded = materialize(src, dst, TransferPolicy.REFERENCE)

    assert actual is TransferPolicy.COPY
    assert degraded is True
    assert dst.is_file()
    assert dst.read_bytes() == b"payload-bytes"
