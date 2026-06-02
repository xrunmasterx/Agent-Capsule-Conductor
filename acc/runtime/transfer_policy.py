"""Phase 1 skeleton for TransferPolicy + materialize() helper.

See DESIGN.md §7.5 for the binding ``materialization`` contract. Phase 1 ships
the enum and a thin filesystem helper with Windows symlink/reference fallback
(degraded -> COPY). Full Windows fallback E2E coverage and the
``materialization_degraded`` event emission land in Phase 3
(IMPLEMENTATION_STRATEGY.md §6.3, AUDIT X-6).
"""

from __future__ import annotations

import enum
import shutil
from pathlib import Path


class TransferPolicy(enum.StrEnum):
    """How a binding moves bytes from producer to consumer.

    Mirrors :data:`acc.domain.MaterializationMode` literals. See DESIGN §7.5.
    """

    COPY = "copy"
    REFERENCE = "reference"
    SYMLINK = "symlink"


def materialize(
    src: Path,
    dst: Path,
    policy: TransferPolicy,
) -> tuple[TransferPolicy, bool]:
    """Materialize ``src`` at ``dst`` according to ``policy``.

    Returns ``(actual_policy_used, degraded_flag)``.

    On platforms where SYMLINK or REFERENCE cannot be honored (e.g. Windows
    without privileges), falls back to COPY and sets ``degraded_flag=True``.
    See DESIGN §7.5 for the contract.
    """

    dst.parent.mkdir(parents=True, exist_ok=True)

    if policy is TransferPolicy.COPY:
        _copy(src, dst)
        return TransferPolicy.COPY, False

    if policy is TransferPolicy.SYMLINK:
        try:
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            dst.symlink_to(src)
            return TransferPolicy.SYMLINK, False
        except OSError:
            _copy(src, dst)
            return TransferPolicy.COPY, True

    if policy is TransferPolicy.REFERENCE:
        try:
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            dst.hardlink_to(src)
            return TransferPolicy.REFERENCE, False
        except OSError:
            _copy(src, dst)
            return TransferPolicy.COPY, True

    raise ValueError(f"Unsupported TransferPolicy: {policy!r}")


def _copy(src: Path, dst: Path) -> None:
    if src.is_dir():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


__all__ = ["TransferPolicy", "materialize"]
