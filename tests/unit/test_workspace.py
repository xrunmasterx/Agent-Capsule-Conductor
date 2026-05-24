from pathlib import Path

import pytest

from acc.schemas import WorkspaceSpec
from acc.utils import AccError
from acc.workspace import WorkspaceManager, build_worktree_command


def test_existing_dir_resolves_absolute_path(tmp_path: Path) -> None:
    spec = WorkspaceSpec(mode="existing_dir", repo_path_input="repo")
    result = WorkspaceManager().prepare(spec, {"repo": str(tmp_path)}, tmp_path / "run")

    assert result.path == tmp_path.resolve()


def test_missing_existing_dir_fails(tmp_path: Path) -> None:
    spec = WorkspaceSpec(mode="existing_dir", repo_path_input="repo")

    with pytest.raises(AccError, match="Repository directory not found"):
        WorkspaceManager().prepare(spec, {"repo": str(tmp_path / "missing")}, tmp_path / "run")


def test_git_worktree_readonly_constructs_expected_command(tmp_path: Path) -> None:
    command = build_worktree_command(
        "git_worktree_readonly",
        tmp_path / "repo",
        tmp_path / "run" / "workspace",
        "main",
    )

    assert command[:4] == ["git", "-C", str(tmp_path / "repo"), "worktree"]
    assert "--detach" in command
    assert command[-1] == "main"


def test_git_worktree_write_constructs_branch_name(tmp_path: Path) -> None:
    command = build_worktree_command(
        "git_worktree_write",
        tmp_path / "repo",
        tmp_path / "run" / "workspace",
        None,
    )

    assert "-b" in command
    assert "acc-run" in command


def test_allowed_root_rejects_outside_path(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    spec = WorkspaceSpec(
        mode="existing_dir",
        repo_path_input="repo",
        allowed_paths=[str(allowed)],
    )

    with pytest.raises(AccError, match="outside allowed paths"):
        WorkspaceManager().prepare(spec, {"repo": str(outside)}, tmp_path / "run")

