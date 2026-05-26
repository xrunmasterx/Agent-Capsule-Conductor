from __future__ import annotations

from pathlib import Path

import pytest

from acc.domain import PermissionProfile
from acc.engine import (
    parse_clean_workflow_template,
    topological_levels,
    validate_clean_workflow_template,
    validate_permission_profile,
)
from acc.runtime import build_allowed_env, validate_workspace_access
from acc.store import safe_child_path
from acc.utils import AccError


def template_payload(**permission_overrides):
    permission_profile = {
        "workspace_access": "writes_run_only",
        "network": False,
        "shell": False,
        "dangerous": False,
        "env_policy": "acc_whitelist",
        "allowed_env": [],
        "timeout_seconds": 30,
    }
    permission_profile.update(permission_overrides)
    return {
        "id": "security_test",
        "version": "0.1.0",
        "nodes": [
            {
                "id": "a",
                "type": "tool",
                "runner": "fake",
                "ports": {"out": ["main"]},
                "permission_profile": permission_profile,
            }
        ],
    }


def test_phase10_aliases_parse_to_domain_node_spec() -> None:
    template = parse_clean_workflow_template(template_payload())

    node = template.nodes["a"]
    assert node.kind == "tool"
    assert node.tool == "fake_producer"
    assert "main" in node.output_ports


def test_dangerous_permission_rejected_by_default() -> None:
    template = parse_clean_workflow_template(template_payload(dangerous=True))

    with pytest.raises(AccError, match="dangerous permission"):
        validate_clean_workflow_template(template)


def test_network_rejected_in_hermetic_mode() -> None:
    template = parse_clean_workflow_template(template_payload(network=True))

    with pytest.raises(AccError, match="network access"):
        validate_clean_workflow_template(template)


def test_full_host_env_inheritance_rejected() -> None:
    profile = PermissionProfile(allowed_env=("*",))

    with pytest.raises(AccError, match="full host environment"):
        validate_permission_profile(profile)


def test_runtime_only_passes_whitelisted_env() -> None:
    profile = PermissionProfile(allowed_env=("SAFE_KEY",))

    env = build_allowed_env(
        profile,
        base_env={"SAFE_KEY": "visible", "SECRET_KEY": "hidden"},
        declared_env={"ACC_RUN_DIR": "run", "IGNORED": "no"},
    )

    assert env == {"ACC_RUN_DIR": "run", "SAFE_KEY": "visible"}


def test_workspace_write_requires_lock() -> None:
    template = parse_clean_workflow_template(
        template_payload(workspace_access="writes_workspace")
    )
    node = template.nodes["a"]

    with pytest.raises(AccError, match="workspace write lock"):
        validate_workspace_access(node, has_workspace_lock=False)


def test_path_traversal_rejected(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()

    with pytest.raises(AccError, match="Path escapes"):
        safe_child_path(root / ".." / "escape.txt", root)


def test_topological_levels_1000_node_sanity() -> None:
    nodes = [
        {
            "id": f"n_{index}",
            "type": "tool",
            "runner": "fake",
            "ports": {"out": ["main"]},
            "permission_profile": {
                "workspace_access": "writes_run_only",
                "network": False,
                "shell": False,
                "dangerous": False,
                "env_policy": "acc_whitelist",
                "allowed_env": [],
                "timeout_seconds": 30,
            },
        }
        for index in range(1000)
    ]
    edges = [{"from": f"n_{index}", "to": f"n_{index + 1}"} for index in range(999)]
    template = parse_clean_workflow_template(
        {
            "id": "large",
            "version": "0.1.0",
            "nodes": nodes,
            "control_edges": edges,
        }
    )

    levels = topological_levels(template)

    assert len(levels) == 1000
    assert levels[0] == ["n_0"]
    assert levels[-1] == ["n_999"]
