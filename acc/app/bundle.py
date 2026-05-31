from __future__ import annotations

from dataclasses import dataclass

from acc.domain import NodeInvocationSpec, WorkflowFunctionTemplate, WorkflowTemplate
from acc.engine import normalize_workflow_function_template


@dataclass(frozen=True)
class CallableWorkflowBundle:
    """Load-time callable view of a workflow template.

    ``template`` retains the legacy scheduling model (edges, ports, policies).
    ``node_invocations`` is parsed once at load and consumed on the runtime hot path.
    """

    template: WorkflowTemplate
    workflow_function: WorkflowFunctionTemplate
    node_invocations: dict[str, NodeInvocationSpec]


def build_callable_workflow_bundle(template: WorkflowTemplate) -> CallableWorkflowBundle:
    workflow_function = normalize_workflow_function_template(template)
    return CallableWorkflowBundle(
        template=template,
        workflow_function=workflow_function,
        node_invocations=dict(workflow_function.node_invocations),
    )
