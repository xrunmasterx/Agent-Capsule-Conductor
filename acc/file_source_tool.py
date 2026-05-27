from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

SECRET_EXACT_NAMES = {
    ".env",
    ".env.local",
    ".envrc",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "known_hosts",
}
SECRET_SUBSTRINGS = {
    "api_key",
    "apikey",
    "credential",
    "password",
    "private_key",
    "secret",
    "token",
}
MAX_MANIFEST_FILES = 500


def main() -> None:
    input_path = Path(os.environ["ACC_INPUT_PATH"])
    artifact_dir = Path(os.environ["ACC_ARTIFACT_DIR"])
    output_path = Path(os.environ["ACC_OUTPUT_JSON"])
    workspace = Path(
        os.environ.get("ACC_ENVIRONMENT_WORKSPACE")
        or os.environ.get("ACC_WORKSPACE_DIR")
        or "."
    ).resolve()
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    target = resolve_workspace_path(workspace, str(payload["path"]))
    reject_secret_like_path(target)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    manifest = manifest_for_target(workspace, target)
    manifest_path = artifact_dir / "source_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    output = {
        "status": "success",
        "summary": f"Published source manifest for {target.name or target}",
        "source_path": str(target),
        "source_type": "directory" if target.is_dir() else "file",
        "manifest_path": str(manifest_path),
    }
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def resolve_workspace_path(workspace: Path, value: str) -> Path:
    raw_path = Path(value)
    target = raw_path if raw_path.is_absolute() else workspace / raw_path
    resolved = target.resolve()
    if not resolved.is_relative_to(workspace):
        raise SystemExit(f"Source path escapes workflow workspace: {resolved}")
    if not resolved.exists():
        raise SystemExit(f"Source path does not exist: {resolved}")
    if not resolved.is_file() and not resolved.is_dir():
        raise SystemExit(f"Source path is not a file or directory: {resolved}")
    return resolved


def reject_secret_like_path(path: Path) -> None:
    lower_parts = [part.lower() for part in path.parts]
    name = path.name.lower()
    if name in SECRET_EXACT_NAMES or any(part in SECRET_EXACT_NAMES for part in lower_parts):
        raise SystemExit("Secret-like source paths are not exposed")
    if any(marker in name for marker in SECRET_SUBSTRINGS):
        raise SystemExit("Secret-like source paths are not exposed")


def manifest_for_target(workspace: Path, target: Path) -> dict[str, Any]:
    if target.is_file():
        return {
            "workspace_root": str(workspace),
            "source": file_record(workspace, target),
            "files": [file_record(workspace, target)],
            "truncated": False,
        }
    files = []
    truncated = False
    for path in sorted(target.rglob("*")):
        if not path.is_file():
            continue
        reject_secret_like_path(path)
        files.append(file_record(workspace, path))
        if len(files) >= MAX_MANIFEST_FILES:
            truncated = True
            break
    return {
        "workspace_root": str(workspace),
        "source": {
            "path": str(target),
            "relative_path": relative_path(workspace, target),
            "type": "directory",
        },
        "files": files,
        "truncated": truncated,
    }


def file_record(workspace: Path, path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "relative_path": relative_path(workspace, path),
        "type": "file",
        "size_bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def relative_path(workspace: Path, path: Path) -> str:
    try:
        return str(path.relative_to(workspace)).replace("\\", "/")
    except ValueError:
        return str(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
