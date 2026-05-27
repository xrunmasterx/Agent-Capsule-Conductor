from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from acc.app import (
    WorkflowAppService,
    hydrate_legacy_capsule_permissions,
    run_workflow_template_instance,
)
from acc.engine import topological_levels
from acc.legacy_graph_importer import legacy_graph_to_accflow_payload, load_legacy_graph_template
from acc.registry import CapsuleRegistry
from acc.store import FileSystemWorkflowStore, write_json
from acc.utils import AccError


def test_legacy_graph_demo_imports_to_canonical_workflow_template() -> None:
    template, _raw = load_legacy_graph_template(Path("examples/workflows/demo_two_node.graph.json"))

    assert template.id == "demo_two_node"
    assert template.metadata["canonical_format"] == "accflow"
    assert template.metadata["imported_from"] == "legacy_graph_json"
    assert set(template.nodes) == {"echo", "fake"}
    assert template.nodes["echo"].raw["legacy_capsule_id"] == "echo-test.generic"


def test_legacy_graph_with_policy_still_imports_legacy_edges_as_control_edges(
    tmp_path: Path,
) -> None:
    graph_path = tmp_path / "legacy_with_policy.graph.json"
    write_json(
        graph_path,
        {
            "id": "legacy_with_policy",
            "version": "0.2.0",
            "policy": {"failure_mode": "fail_fast", "max_concurrency": 4},
            "nodes": [
                {"id": "plan", "capsule_id": "echo-test.generic", "input": {}},
                {"id": "branch_a", "capsule_id": "fake-agent.generic", "input": {}},
                {"id": "branch_b", "capsule_id": "fake-agent.generic", "input": {}},
                {"id": "merge", "capsule_id": "fake-agent.generic", "input": {}},
            ],
            "edges": [
                {"id": "edge_plan_a", "from": "plan", "to": "branch_a"},
                {"id": "edge_plan_b", "from": "plan", "to": "branch_b"},
                {"id": "edge_a_merge", "from": "branch_a", "to": "merge"},
                {"id": "edge_b_merge", "from": "branch_b", "to": "merge"},
            ],
        },
    )
    template, _raw = load_legacy_graph_template(graph_path)

    assert [(edge.source, edge.target) for edge in template.control_edges] == [
        ("plan", "branch_a"),
        ("plan", "branch_b"),
        ("branch_a", "merge"),
        ("branch_b", "merge"),
    ]
    assert topological_levels(template) == [["plan"], ["branch_a", "branch_b"], ["merge"]]


def test_workflow_app_service_validate_rejects_missing_legacy_capsule(tmp_path: Path) -> None:
    graph_path = tmp_path / "missing_capsule.graph.json"
    write_json(
        graph_path,
        {
            "id": "missing_capsule",
            "nodes": [{"id": "only", "capsule_id": "missing.generic", "input": {}}],
            "edges": [],
        },
    )

    with pytest.raises(AccError, match="Capsule not found: missing.generic"):
        WorkflowAppService().validate(graph_path)


def test_legacy_graph_nodes_inherit_capsule_timeout(tmp_path: Path, monkeypatch) -> None:
    capsule_dir = tmp_path / "capsules" / "slow-codex.codex"
    capsule_dir.mkdir(parents=True)
    (capsule_dir / "capsule.yaml").write_text(
        "\n".join(
            [
                "id: slow-codex.codex",
                "version: 0.1.0",
                "name: Slow Codex",
                "description: Slow external agent.",
                "runtime:",
                "  type: codex_cli",
                "workspace:",
                "  mode: existing_dir",
                "permissions:",
                "  sandbox: read-only",
                "  network: true",
                "  write_files: false",
                "  timeout_seconds: 600",
                "  allow_dangerous: false",
                "prompt:",
                "  template: prompt_template.md",
                "schema:",
                "  input: input_schema.json",
                "  output: output_schema.json",
                "artifacts:",
                "  manifest: artifact_manifest.yaml",
            ]
        ),
        encoding="utf-8",
    )
    (capsule_dir / "prompt_template.md").write_text("{{ input.topic }}\n", encoding="utf-8")
    write_json(
        capsule_dir / "input_schema.json",
        {
            "type": "object",
            "properties": {"topic": {"type": "string"}},
            "additionalProperties": False,
        },
    )
    write_json(
        capsule_dir / "output_schema.json",
        {
            "type": "object",
            "required": ["status", "summary"],
            "properties": {"status": {"type": "string"}, "summary": {"type": "string"}},
            "additionalProperties": False,
        },
    )
    (capsule_dir / "artifact_manifest.yaml").write_text(
        "version: '2.0'\nrequired: []\n",
        encoding="utf-8",
    )
    graph_path = tmp_path / "slow.graph.json"
    write_json(
        graph_path,
        {
            "id": "slow",
            "version": "0.1.0",
            "nodes": [{"id": "research", "capsule_id": "slow-codex.codex", "input": {}}],
            "edges": [],
        },
    )

    template, _raw = load_legacy_graph_template(graph_path)
    hydrated = hydrate_legacy_capsule_permissions(
        template,
        CapsuleRegistry(tmp_path / "capsules"),
    )

    assert hydrated.nodes["research"].permission_profile is not None
    assert hydrated.nodes["research"].permission_profile.timeout_seconds == 600
    assert hydrated.nodes["research"].permission_profile.network is True

    service = WorkflowAppService(registry=CapsuleRegistry(tmp_path / "capsules"))
    with pytest.raises(AccError, match="network access is rejected in hermetic mode"):
        service.validate(graph_path)
    monkeypatch.setenv("ACC_RUN_EXTERNAL_AGENT_TESTS", "1")
    assert service.validate(graph_path)["status"] == "valid"


def test_legacy_graph_and_imported_accflow_produce_equivalent_outputs_and_events(
    tmp_path: Path,
) -> None:
    graph_path = Path("examples/workflows/demo_two_node.graph.json")
    accflow_path = tmp_path / "demo_two_node_imported.accflow.json"
    write_json(accflow_path, legacy_graph_to_accflow_payload(graph_path))

    service = WorkflowAppService()
    graph_result = service.run_sync(graph_path, tmp_path / "graph_run")
    accflow_result = service.run_sync(accflow_path, tmp_path / "accflow_run")

    assert graph_result["status"] == "success"
    assert accflow_result["status"] == "success"
    assert node_summaries(graph_result) == node_summaries(accflow_result)
    assert event_types(tmp_path / "graph_run") == event_types(tmp_path / "accflow_run")


def boundary_graph(**updates) -> dict:
    payload = {
        "id": "boundary_demo",
        "version": "0.1.0",
        "nodes": [
            {
                "id": "worker",
                "capsule_id": "fake-agent.generic",
                "input": {},
                "input_ports": [{"id": "main", "direction": "input"}],
                "output_ports": [{"id": "main", "direction": "output"}],
            }
        ],
        "control_edges": [],
        "data_edges": [],
        "exposed_inputs": [{"id": "main", "direction": "input", "required": True}],
        "exposed_outputs": [{"id": "main", "direction": "output"}],
        "metadata": {
            "workflow_port_edges": [
                {
                    "from": {"node": "boundary_demo__workflow_inputs", "port": "main"},
                    "to": {"node": "worker", "port": "main"},
                    "materialization": "copy",
                },
                {
                    "from": {"node": "worker", "port": "main"},
                    "to": {"node": "boundary_demo__workflow_outputs", "port": "main"},
                    "materialization": "copy",
                },
            ]
        },
    }
    payload.update(updates)
    return payload


def test_legacy_graph_imports_workflow_boundary_edges(tmp_path: Path) -> None:
    graph_path = tmp_path / "boundary_demo.graph.json"
    write_json(graph_path, boundary_graph())

    template, _raw = load_legacy_graph_template(graph_path)

    assert set(template.exposed_inputs) == {"main"}
    assert set(template.exposed_outputs) == {"main"}
    assert template.workflow_input_bindings[0].target.node == "worker"
    assert template.workflow_output_bindings[0].source.node == "worker"


def test_workflow_boundary_input_materializes_and_output_publishes(tmp_path: Path) -> None:
    graph_path = tmp_path / "boundary_demo.graph.json"
    write_json(graph_path, boundary_graph())
    template, _raw = load_legacy_graph_template(graph_path)
    store = FileSystemWorkflowStore(
        template=template,
        workflow_path=graph_path,
        run_dir=tmp_path / "run",
    )

    async def fake_executor(node, _workflow_path, _run_dir, node_dir, _frame):
        output = {"status": "success", "summary": f"ran {node.id}", "value": 7}
        write_json(node_dir / "output.json", output)
        return output

    result = asyncio.run(
        run_workflow_template_instance(
            template,
            graph_path,
            store,
            workflow_input={"main": {"topic": "rendering papers"}},
            node_executor=fake_executor,
        )
    )

    assert result["status"] == "success"
    inbox_manifest = (
        tmp_path
        / "run"
        / "nodes"
        / "worker"
        / "inbox"
        / "main"
        / "boundary_demo__workflow_inputs_main"
        / "inbox_manifest.json"
    )
    assert inbox_manifest.exists()
    output_manifest = (
        tmp_path
        / "run"
        / "workflow_outputs"
        / "main"
        / "workflow_output_manifest.json"
    )
    assert output_manifest.exists()
    assert result["workflow_outputs"]["main"]["source_node_id"] == "worker"


def test_required_workflow_input_missing_fails_before_run_dir_pollution(tmp_path: Path) -> None:
    graph_path = tmp_path / "boundary_demo.graph.json"
    write_json(graph_path, boundary_graph())
    template, _raw = load_legacy_graph_template(graph_path)
    store = FileSystemWorkflowStore(
        template=template,
        workflow_path=graph_path,
        run_dir=tmp_path / "run",
    )

    with pytest.raises(AccError, match="Missing required workflow input"):
        asyncio.run(
            run_workflow_template_instance(
                template,
                graph_path,
                store,
                workflow_input={},
            )
        )

    assert not (tmp_path / "run").exists()


def test_malformed_workflow_boundary_edge_rejected(tmp_path: Path) -> None:
    graph = boundary_graph()
    graph["metadata"]["workflow_port_edges"] = [
        {
            "from": {"node": "worker", "port": "main"},
            "to": {"node": "boundary_demo__workflow_inputs", "port": "main"},
        }
    ]
    graph_path = tmp_path / "bad_boundary.graph.json"
    write_json(graph_path, graph)

    with pytest.raises(AccError, match="Workflow boundary edge direction"):
        WorkflowAppService().validate(graph_path)


def node_summaries(payload: dict) -> dict[str, str]:
    return {node["node_id"]: node["summary"] for node in payload["nodes"]}


def event_types(run_dir: Path) -> list[str]:
    return [
        line.split('"type": "', 1)[1].split('"', 1)[0]
        for line in (run_dir / "workflow_events.jsonl").read_text(encoding="utf-8").splitlines()
        if '"type": "' in line
    ]
