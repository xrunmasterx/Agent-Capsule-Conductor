from __future__ import annotations

from dataclasses import is_dataclass
from typing import get_args

from acc.domain import (
    CORE_V2_SCHEMA_VERSION,
    ArtifactContract,
    CallableKind,
    CallableRef,
    ClassTemplate,
    EventRecord,
    ExecutionNode,
    ExecutionPlan,
    FailureRecord,
    NodeInvocationRun,
    NodeInvocationSpec,
    PromptPolicy,
    ResultStoreAddress,
    RetryPolicy,
    RunRecord,
    RuntimePolicy,
    TimeoutPolicy,
)


def test_core_v2_callable_kind_excludes_legacy_capsule() -> None:
    assert set(get_args(CallableKind)) == {
        "agent_class",
        "tool_class",
        "workflow_function",
    }
    assert "legacy_capsule" not in get_args(CallableKind)


def test_core_v2_required_domain_records_are_dataclasses() -> None:
    for model in [
        RuntimePolicy,
        RetryPolicy,
        TimeoutPolicy,
        PromptPolicy,
        ArtifactContract,
        ExecutionNode,
        ExecutionPlan,
        NodeInvocationRun,
        ResultStoreAddress,
        RunRecord,
        EventRecord,
        FailureRecord,
    ]:
        assert is_dataclass(model)


def test_core_v2_node_invocation_owns_typed_runtime_fields() -> None:
    node = NodeInvocationSpec(
        id="collect",
        callable_ref=CallableRef(kind="agent_class", id="collector.codex"),
        runtime_policy=RuntimePolicy(
            retry=RetryPolicy(max_attempts=2, backoff_seconds=0.25),
            timeout=TimeoutPolicy(seconds=30),
        ),
        prompt_policy=PromptPolicy(user_prompt="Collect only verified facts."),
        artifact_contract=ArtifactContract(required_paths=("report.md",)),
    )

    assert node.callable_ref.kind == "agent_class"
    assert node.runtime_policy.retry.max_attempts == 2
    assert node.runtime_policy.timeout.seconds == 30
    assert node.prompt_policy.user_prompt == "Collect only verified facts."
    assert node.artifact_contract.required_paths == ("report.md",)


def test_core_v2_execution_plan_references_invocation_specs() -> None:
    node = NodeInvocationSpec(
        id="summarize",
        callable_ref=CallableRef(kind="tool_class", id="summarizer.local"),
    )
    plan = ExecutionPlan(
        workflow_function_id="daily_digest",
        schema_version=CORE_V2_SCHEMA_VERSION,
        nodes=(ExecutionNode(node_id=node.id, invocation=node),),
        levels=((node.id,),),
    )

    assert plan.nodes[0].invocation is node
    assert plan.levels == (("summarize",),)


def test_class_template_alias_names_only_new_class_templates() -> None:
    assert str(ClassTemplate).find("AgentClassTemplate") >= 0
    assert str(ClassTemplate).find("ToolClassTemplate") >= 0

