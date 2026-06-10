/**
 * WorkspaceCanvas — ReactFlow canvas root component.
 *
 * This module will hold the full WorkspaceCanvas implementation once it is
 * extracted from WorkflowViewer.tsx (refactoring plan step 6).
 *
 * For now it re-exports the component via the testables interface so that
 * import paths can be updated incrementally.
 */

// During migration: re-export from the monolith.
// After step 6 completes, this file will own the implementation.
export { __workflowViewerTestables as _canvasInternals } from '../WorkflowViewer';

/**
 * Placeholder re-export.  Consumers should import WorkspaceCanvas from
 * '../WorkflowViewer' until step 6 is done.  This file exists to reserve
 * the module path.
 */
export const WorkspaceCanvas = null as unknown as React.FC<Record<string, unknown>>;
// ^ Will be replaced with the real component after full extraction.
import type React from 'react';
