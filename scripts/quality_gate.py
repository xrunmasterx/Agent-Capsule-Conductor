"""Run the local quality gate used before accepting ACC changes."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
NPM_COMMAND = "npm.cmd" if os.name == "nt" else "npm"

STEPS = (
    ("Python lint", ("uv", "run", "ruff", "check", "."), PROJECT_ROOT),
    ("Python tests", ("uv", "run", "pytest", "-q"), PROJECT_ROOT),
    (
        "Frontend tests",
        (NPM_COMMAND, "run", "test", "--", "--run"),
        PROJECT_ROOT / "web",
    ),
    ("Frontend build", (NPM_COMMAND, "run", "build"), PROJECT_ROOT / "web"),
)


def run_step(label: str, command: tuple[str, ...], cwd: Path) -> None:
    command_text = " ".join(command)
    print(f"\n==> {label}: {command_text}", flush=True)
    completed = subprocess.run(command, cwd=cwd, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> None:
    for label, command, cwd in STEPS:
        run_step(label, command, cwd)


if __name__ == "__main__":
    main()
