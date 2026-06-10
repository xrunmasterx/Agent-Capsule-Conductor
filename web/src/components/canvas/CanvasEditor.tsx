/**
 * CanvasEditor — top-level canvas rendering component.
 *
 * This module wraps the WorkspaceCanvas component, establishing the module
 * boundary for canvas rendering logic.  During the incremental migration
 * (steps 5-6 of the refactoring plan), the full WorkspaceCanvas
 * implementation will move here.  For now this file re-exports a thin
 * adapter so that consumers can start importing from `canvas/` immediately.
 *
 * Responsibilities:
 * - ReactFlow <ReactFlow> provider & viewport management
 * - Node type registration (workflowContainer, agentToolNode)
 * - Keyboard shortcuts (Delete / Backspace)
 * - Canvas-level drag-and-drop (palette → canvas)
 * - Connection interaction (start → preview → commit)
 * - Edge rendering & filtering (data / control / all)
 */

export {
  // Constants re-exported for child components
  AGENT_CONTROL_HANDLE_TOP,
  AGENT_DATA_PORT_TOP,
  AGENT_DATA_PORT_GAP,
  AGENT_TOOL_NODE_SIZE,
  BOUNDARY_NODE_SIZE,
  DEFAULT_CONTAINER_SIZE,
  INTERNAL_AGENT_TOOL_NODE_SIZE,
  WORKFLOW_CHILD_PADDING,
  WORKFLOW_CHILD_START_PADDING,
  WORKFLOW_INNER_HANDLE_X,
  WORKFLOW_INTERNAL_LAYOUT_GAP,
  WORKFLOW_LAYOUT_SAFE_AREA,
  ROOT_LAYOUT_GAP,
} from './canvasConstants';

export { AgentToolNode, WorkflowContainer } from './NodeRenderer';
