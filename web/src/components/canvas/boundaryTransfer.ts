import type { BoundaryTransferPreview, WorkflowGraphEdge } from '../../types';
import type { BoundaryTransfer, BoundaryTransferMapping } from '../../types/workbench';

export const BOUNDARY_TRANSFER_SCHEMA = 'acc.workbench.boundary_transfer.v1';

export type { BoundaryTransfer, BoundaryTransferMapping };

export function boundaryTransferFromGraphEdge(edge: WorkflowGraphEdge): BoundaryTransfer | null {
  const raw = edge.boundary_transfer;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return normalizeBoundaryTransfer(raw);
}

export function boundaryTransferToGraphMetadata(
  transfer: BoundaryTransfer | undefined,
): WorkflowGraphEdge['boundary_transfer'] | undefined {
  if (!transfer) {
    return undefined;
  }
  const mappings = transfer.mappings?.map((mapping) => ({
    source_port: mapping.sourcePort,
    target_port: mapping.targetPort,
  }));
  return {
    schema: BOUNDARY_TRANSFER_SCHEMA,
    direction: transfer.direction,
    materialization: transfer.materialization,
    inference: mappings && mappings.length > 0 ? 'explicit' : transfer.inference,
    ...(mappings && mappings.length > 0 ? { mappings } : {}),
  };
}

export function normalizeBoundaryTransfer(raw: Record<string, unknown>): BoundaryTransfer | null {
  const direction =
    raw.direction === 'workflow_output' || raw.direction === 'workflow_input' ? raw.direction : null;
  if (!direction) {
    return null;
  }
  const mappings = boundaryTransferMappings(raw.mappings);
  return {
    direction,
    materialization: raw.materialization === 'reference' ? 'reference' : 'copy',
    inference: mappings.length > 0 ? 'explicit' : boundaryTransferInference(raw.inference),
    ...(mappings.length > 0 ? { mappings } : {}),
  };
}

export function boundaryTransferPreviewHasErrors(preview: BoundaryTransferPreview | null): boolean {
  return Boolean(preview?.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
}

export function inferBoundaryTransferPairs(
  sourcePorts: string[],
  targetPorts: string[],
): BoundaryTransferMapping[] {
  const sourceIds = uniquePortIds(sourcePorts);
  const targetIds = uniquePortIds(targetPorts);
  const sameName = sourceIds.filter((portId) => targetIds.includes(portId));
  const specific = sameName.filter((portId) => portId !== 'main');
  if (specific.length > 0) {
    return specific.map((portId) => ({ sourcePort: portId, targetPort: portId }));
  }
  if (sameName.includes('main')) {
    return [{ sourcePort: 'main', targetPort: 'main' }];
  }
  if (sourceIds.length === 1 && targetIds.length === 1) {
    return [{ sourcePort: sourceIds[0], targetPort: targetIds[0] }];
  }
  return [];
}

export function unavailableBoundaryTransferPreview(): BoundaryTransferPreview {
  return {
    status: 'invalid',
    bindings: {
      workflow_input_bindings: [],
      workflow_output_bindings: [],
    },
    diagnostics: [
      {
        code: 'boundary_transfer_preview_unavailable',
        severity: 'warning',
        message: '边界控制线 preview 暂不可用；不会伪造成功 binding。',
      },
    ],
    canonical_preview: {
      workbench_projection: 'boundary_control_port_binding',
      runtime_control_edge: false,
      preview_source: 'unavailable',
    },
  };
}

function boundaryTransferMappings(value: unknown): BoundaryTransferMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const record = item as Record<string, unknown>;
    const sourcePort = record.sourcePort || record.source_port;
    const targetPort = record.targetPort || record.target_port;
    return typeof sourcePort === 'string' && typeof targetPort === 'string'
      ? [{ sourcePort, targetPort }]
      : [];
  });
}

function boundaryTransferInference(value: unknown): BoundaryTransfer['inference'] {
  return value === 'main_compat' || value === 'single_port' || value === 'same_name'
    ? value
    : 'same_name';
}

function uniquePortIds(ports: string[]): string[] {
  const ids = ports.map((portId) => portId || 'main');
  return [...new Set(ids.length > 0 ? ids : ['main'])];
}
