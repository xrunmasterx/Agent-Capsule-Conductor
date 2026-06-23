"""Shared CallableRef utility functions for engine submodules."""

from __future__ import annotations

from acc.models import CallableRef


def callable_ref_key(ref: CallableRef) -> tuple[str, str]:
    return (ref.kind, ref.id)


def callable_ref_payload(ref: CallableRef) -> dict[str, str | None]:
    return {"kind": ref.kind, "id": ref.id, "version": ref.version}
