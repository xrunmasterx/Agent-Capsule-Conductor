from __future__ import annotations

from dataclasses import dataclass

from acc.models import NodeInvocationSpec, WorkflowFunctionTemplate


@dataclass(frozen=True)
class CallableWorkflowBundle:
    template: WorkflowFunctionTemplate
    node_invocations: dict[str, NodeInvocationSpec]


def build_callable_workflow_bundle(
    template: WorkflowFunctionTemplate,
) -> CallableWorkflowBundle:
    return CallableWorkflowBundle(
        template=template,
        node_invocations=dict(template.node_invocations),
    )
