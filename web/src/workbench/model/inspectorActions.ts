import type {
  DataConnectionDraft,
  PortDirection,
  WorkflowCanvasEdge,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  dataConnectNodes,
  dataEdgesForNode,
  type DataConnectNodeOption,
} from './canvasEdgeOps';
import { isSchemaDerivedOutputPort } from './schemaPorts';

export type DataConnectionRelatedEdge = Extract<WorkflowCanvasEdge, { kind: 'data' }>;

export type DataConnectionPortModel = {
  port: WorkflowPortView;
  direction: PortDirection;
  relatedEdges: DataConnectionRelatedEdge[];
  readonly: boolean;
  readonlyReason?: string;
};

export type DataConnectionTargetPortModel = {
  port: WorkflowPortView;
  conflicts: DataConnectionRelatedEdge[];
  hasOneCardinalityConflict: boolean;
  requestedPortId: string;
};

export type DataConnectionTargetModel = Omit<DataConnectNodeOption, 'inputPorts'> & {
  inputPorts: DataConnectionTargetPortModel[];
};

export type DataConnectionsModel = {
  sourceScopeMatches: boolean;
  incoming: DataConnectionRelatedEdge[];
  outgoing: DataConnectionRelatedEdge[];
  inputPorts: DataConnectionPortModel[];
  outputPorts: DataConnectionPortModel[];
  targets: DataConnectionTargetModel[];
};

export function buildDataConnectionsModel({
  canvas,
  scopeWorkflowId,
  nodeId,
  inputPorts,
  outputPorts,
  outputPortsReadonly = false,
  dataConnectionDraft,
}: {
  canvas: WorkspaceCanvasModel;
  scopeWorkflowId: string | null;
  nodeId: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  outputPortsReadonly?: boolean;
  dataConnectionDraft: DataConnectionDraft;
}): DataConnectionsModel {
  const incoming = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, 'input');
  const outgoing = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, 'output');
  const sourceScopeMatches = dataConnectionDraft?.scopeWorkflowId === scopeWorkflowId;
  const targets = dataConnectNodes(canvas, scopeWorkflowId)
    .filter((candidate) => candidate.nodeId !== dataConnectionDraft?.sourceNodeId)
    .map((candidate) => ({
      ...candidate,
      inputPorts: candidate.inputPorts.map((targetPort) => {
        const conflicts = dataEdgesForNode(canvas, scopeWorkflowId, candidate.nodeId, 'input').filter(
          (edge) => edge.target.portId === targetPort.id,
        );
        return {
          port: targetPort,
          conflicts,
          hasOneCardinalityConflict: conflicts.length > 0 && (targetPort.cardinality || 'one') !== 'many',
          requestedPortId: `${dataConnectionDraft?.sourceNodeId || 'source'}_input`,
        };
      }),
    }));

  return {
    sourceScopeMatches,
    incoming,
    outgoing,
    inputPorts: inputPorts.map((portValue) => ({
      port: portValue,
      direction: 'input',
      relatedEdges: incoming.filter((edge) => edge.target.portId === portValue.id),
      readonly: false,
    })),
    outputPorts: outputPorts.map((portValue) => {
      const readonly = outputPortsReadonly || isSchemaDerivedOutputPort(portValue);
      return {
        port: portValue,
        direction: 'output',
        relatedEdges: outgoing.filter((edge) => edge.source.portId === portValue.id),
        readonly,
        readonlyReason: readonly ? 'schema-derived output port is read-only; edit output schema instead' : undefined,
      };
    }),
    targets,
  };
}
