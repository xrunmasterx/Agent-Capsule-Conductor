import type { DragEvent } from 'react';

import type { CallableSummary, WorkflowSummary } from '../../types';
import type { PortDirection, WorkflowPortView } from '../../types/workbench';

export type { PortDirection, WorkflowPortView };

export type PaletteItem =
  | { kind: 'workflow'; workflowRef?: string; label: string }
  | {
      kind: 'agent';
      callableId: string;
      label: string;
      inputPorts?: WorkflowPortView[];
      outputPorts?: WorkflowPortView[];
      outputSchema?: Record<string, unknown>;
    }
  | {
      kind: 'tool';
      callableId: string;
      label: string;
      inputPorts?: WorkflowPortView[];
      outputPorts?: WorkflowPortView[];
      outputSchema?: Record<string, unknown>;
    }
  | { kind: 'file_source'; callableId: 'file-source.local'; label: string };

export type PaletteAddOptions = {
  forceRoot?: boolean;
};

export function paletteItemFromCallable(callable: CallableSummary): Exclude<PaletteItem, { kind: 'workflow' }> {
  return {
    kind: callable.kind === 'tool_class' ? 'tool' : 'agent',
    callableId: callable.id,
    label: callable.name || callable.id,
    inputPorts: workflowPortsFromPortContracts(callable.input_ports, 'input'),
    outputPorts: workflowPortsFromPortContracts(callable.output_ports, 'output'),
    outputSchema: outputSchemaFromArtifactContract(callable.artifact_contract),
  };
}

export function paletteItemFromWorkflow(workflow: WorkflowSummary): Extract<PaletteItem, { kind: 'workflow' }> {
  return {
    kind: 'workflow',
    workflowRef: workflow.path,
    label: workflow.name || workflow.workflow_id,
  };
}

export function newWorkflowPaletteItem(): Extract<PaletteItem, { kind: 'workflow' }> {
  return { kind: 'workflow', label: 'New Workflow' };
}

export function fileSourcePaletteItem(): Extract<PaletteItem, { kind: 'file_source' }> {
  return { kind: 'file_source', callableId: 'file-source.local', label: 'File Source' };
}

export function setPaletteDragData(event: DragEvent<HTMLElement>, item: PaletteItem) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/x-acc-palette', JSON.stringify(item));
}

export function parsePaletteItem(raw: string): PaletteItem | null {
  if (!raw) {
    return null;
  }
  try {
    const item = JSON.parse(raw) as PaletteItem;
    if (item.kind === 'workflow' && item.label) {
      return item;
    }
    if (
      (item.kind === 'agent' || item.kind === 'tool' || item.kind === 'file_source') &&
      item.callableId &&
      item.label
    ) {
      return item;
    }
  } catch {
    return null;
  }
  return null;
}

export function workflowPortsFromPortContracts(
  ports: Record<string, unknown> | undefined,
  direction: PortDirection,
): WorkflowPortView[] {
  if (!ports || Object.keys(ports).length === 0) {
    return direction === 'input' ? [port('main', '输入', 'input')] : [port('main', '输出', 'output')];
  }
  return Object.entries(ports).map(([id, value]) => {
    const payload = isPlainRecord(value) ? value : {};
    return port(
      id,
      id,
      direction,
      Boolean(payload.required),
      typeof payload.cardinality === 'string' ? payload.cardinality : 'one',
    );
  });
}

export function outputSchemaFromArtifactContract(contract: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(contract) || !isPlainRecord(contract.output_schema)) {
    return undefined;
  }
  return contract.output_schema;
}

function port(
  id: string,
  label: string,
  direction: PortDirection,
  required = false,
  cardinality = 'one',
): WorkflowPortView {
  return { id, label, direction, required, cardinality, artifactTypes: ['artifact'] };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
