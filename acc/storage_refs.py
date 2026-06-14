from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from acc.models import AccError
from acc.storage import validate_run_id

REF_VERSION = "v1"


@dataclass(frozen=True)
class ArtifactRef:
    run_id: str
    relative_path: str
    node_id: str | None = None


def make_object_ref(kind: str, object_id: str) -> str:
    object_id = validate_ref_component(object_id, "object_id")
    return f"{kind}:{REF_VERSION}:{object_id}"


def make_legacy_object_ref(kind: str, object_id: str) -> str:
    object_id = validate_ref_component(object_id, "object_id")
    return f"{kind}:{object_id}"


def make_run_ref(run_id: str) -> str:
    return f"run:{REF_VERSION}:{validate_run_id(run_id)}"


def make_task_ref(task_id: str) -> str:
    return make_object_ref("task", task_id)


def make_session_ref(session_id: str) -> str:
    return make_object_ref("session", session_id)


def parse_object_ref(object_ref: str) -> tuple[str, str]:
    parts = str(object_ref or "").split(":")
    if len(parts) == 3 and parts[1] == REF_VERSION:
        kind, _version, object_id = parts
        return validate_ref_component(kind, "kind"), validate_ref_component(
            object_id,
            "object_id",
        )
    if len(parts) == 2:
        kind, object_id = parts
        return validate_ref_component(kind, "kind"), validate_ref_component(
            object_id,
            "object_id",
        )
    raise AccError(f"Invalid object_ref: {object_ref}")


def make_run_artifact_ref(run_id: str, relative_path: str) -> str:
    safe_run_id = validate_run_id(run_id)
    safe_relative_path = validate_relative_ref_path(relative_path)
    return f"artifact:{REF_VERSION}:{safe_run_id}:run:{safe_relative_path}"


def make_node_artifact_ref(run_id: str, node_id: str, relative_path: str) -> str:
    return (
        f"artifact:{REF_VERSION}:{validate_run_id(run_id)}:node:"
        f"{validate_ref_component(node_id, 'node_id')}:{validate_relative_ref_path(relative_path)}"
    )


def parse_artifact_ref(artifact_ref: str) -> ArtifactRef:
    ref = str(artifact_ref or "").strip()
    parts = ref.split(":")
    if len(parts) >= 5 and parts[0] == "artifact" and parts[1] == REF_VERSION:
        run_id = validate_run_id(parts[2])
        scope = parts[3]
        if scope == "run":
            return ArtifactRef(run_id=run_id, relative_path=":".join(parts[4:]))
        if scope == "node" and len(parts) >= 6:
            node_id = validate_ref_component(parts[4], "node_id")
            return ArtifactRef(
                run_id=run_id,
                node_id=node_id,
                relative_path=":".join(parts[5:]),
            )
    if len(parts) >= 4 and parts[0] == "run" and parts[2] == "artifact":
        return ArtifactRef(
            run_id=validate_run_id(parts[1]),
            relative_path=":".join(parts[3:]),
        )
    if len(parts) >= 6 and parts[0] == "run" and parts[2] == "node" and parts[4] == "artifact":
        return ArtifactRef(
            run_id=validate_run_id(parts[1]),
            node_id=validate_ref_component(parts[3], "node_id"),
            relative_path=":".join(parts[5:]),
        )
    raise AccError(f"Invalid artifact_ref: {artifact_ref}")


def validate_ref_component(value: str, label: str) -> str:
    value = str(value or "")
    if value in {"", ".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
        raise AccError(f"Invalid {label}: {value}")
    return value


def validate_relative_ref_path(value: str) -> str:
    value = str(value or "")
    rel = Path(value)
    if not value or value == ".." or rel.is_absolute() or rel.drive or ".." in rel.parts:
        raise AccError(f"Invalid relative artifact path: {value}")
    return value.replace("\\", "/")
