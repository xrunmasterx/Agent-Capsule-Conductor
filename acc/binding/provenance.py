"""ProvenanceObject: structured per-artifact lineage record.

Canonical home for :class:`ProvenanceObject`. See DESIGN.md §7.2 and
IMPLEMENTATION_STRATEGY.md §6.1 PR-1.2. Phase 3 freezes schema_version ``1``
as a public schema; bumping it requires a migration plan.

Invariants enforced here:
- X-4: exactly one of ``inline_value_sha256`` / ``source_artifact_sha256`` is
  non-None (hash mutual exclusion, AUDIT C-016).
"""
from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Any


@dataclass(frozen=True)
class ProvenanceObject:
    """Per-artifact provenance record stamped by BindingResolver."""

    producer_session_id: str
    bundle_id: str
    binding_applied: str
    call_depth: int
    materialization_mode_resolved: str  # "copy" | "reference" | "symlink"
    parent_frame_id: str | None
    invoking_workflow_call_id: str | None
    inline_value_sha256: str | None
    source_artifact_sha256: str | None
    schema_version: int = 1  # FROZEN PUBLIC SCHEMA — bumping requires migration plan

    def __post_init__(self) -> None:
        inline = self.inline_value_sha256
        source = self.source_artifact_sha256
        if (inline is None) == (source is None):
            raise ValueError(
                "ProvenanceObject requires exactly one of "
                "inline_value_sha256 or source_artifact_sha256 to be set "
                "(invariant X-4 / AUDIT C-016)"
            )
        if self.materialization_mode_resolved not in {"copy", "reference", "symlink"}:
            raise ValueError(
                "materialization_mode_resolved must be one of "
                f"'copy'|'reference'|'symlink', got "
                f"{self.materialization_mode_resolved!r}"
            )
        if self.call_depth < 0:
            raise ValueError(
                f"call_depth must be >= 0, got {self.call_depth}"
            )

    def to_jsonable(self) -> dict[str, Any]:
        """Return a plain-dict representation suitable for json.dumps."""
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_jsonable(cls, data: dict[str, Any]) -> ProvenanceObject:
        """Rebuild a :class:`ProvenanceObject` from its JSON form.

        Unknown keys are rejected to keep the frozen public schema honest.
        """
        if not isinstance(data, dict):
            raise TypeError(
                f"from_jsonable expects dict, got {type(data).__name__}"
            )
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(
                f"unknown ProvenanceObject fields: {sorted(unknown)}"
            )
        return cls(**{k: v for k, v in data.items() if k in known})


__all__ = ["ProvenanceObject"]
