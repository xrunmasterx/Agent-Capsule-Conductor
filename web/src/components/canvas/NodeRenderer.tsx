/**
 * NodeRenderer — individual node type rendering components.
 *
 * This module will contain the AgentToolNode, WorkflowContainer,
 * WorkflowHeader, ControlConnectHitbox, and WorkflowPortColumn components
 * after the full extraction (refactoring plan step 6).
 *
 * Current status: module boundary established; implementation remains in
 * WorkflowViewer.tsx.  The testables interface provides temporary access.
 */

export { __workflowViewerTestables as _nodeInternals } from '../WorkflowViewer';

// Re-export placeholder references for the node type components.
// These will become real named exports once step 6 is complete.
export const AgentToolNode = 'AgentToolNode' as const;
export const WorkflowContainer = 'WorkflowContainer' as const;
