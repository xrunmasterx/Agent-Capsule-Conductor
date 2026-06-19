import type { ReactNode } from 'react';

import type { NodeRunSummary, RunEvent } from '../../types';
import type { NodeLiveLogs, WorkflowPortView } from '../../types/workbench';

export type CodeBlockVariant = 'json' | 'log' | 'text';

export type InvocationIdentityCardProps = {
  scope: string;
  nodeId: string;
  label: string;
  callableId?: string;
  workflowRef?: string;
  onLabelChange?: (label: string) => void;
};

export type InspectorRenderers = {
  codeBlock: (props: { title: string; content: string; variant?: CodeBlockVariant }) => ReactNode;
  evidencePreview: (props: { path?: string | null; title: string; emptyText: string }) => ReactNode;
  invocationInputEditor: (props: {
    input: Record<string, unknown>;
    onChange: (input: Record<string, unknown>) => void;
  }) => ReactNode;
  invocationIdentityCard: (props: InvocationIdentityCardProps) => ReactNode;
  liveLogBlocks: (liveLogs?: NodeLiveLogs) => ReactNode;
  nodeEvidencePaths: (props: {
    nodeRun?: NodeRunSummary;
    liveLogs?: NodeLiveLogs;
    onReadEvidence: (path: string | null | undefined, title?: string) => void;
  }) => ReactNode;
  portList: (props: { title: string; ports: WorkflowPortView[] }) => ReactNode;
  eventTimeline: (props: { events: RunEvent[]; title: string }) => ReactNode;
};
