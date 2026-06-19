export const DEFAULT_CONTAINER_SIZE = { width: 430, height: 328 };
export const BOUNDARY_NODE_SIZE = { width: 270, height: 240 };
export const AGENT_TOOL_NODE_SIZE = { width: 276, height: 132 };
export const INTERNAL_AGENT_TOOL_NODE_SIZE = { width: 276, height: 158 };
export const AGENT_CONTROL_HANDLE_TOP = '50%';
export const AGENT_CONTROL_HANDLE_FALLBACK_TOP = AGENT_TOOL_NODE_SIZE.height / 2;
export const AGENT_MAX_DATA_PORTS = 10;
export const AGENT_DATA_PORT_TOP = 88;
export const AGENT_DATA_PORT_GAP = 28;
export const AGENT_PORT_VERTICAL_PADDING = 42;
export const WORKFLOW_INNER_HANDLE_X = 25;
export const WORKFLOW_CHILD_PADDING = 24;
export const WORKFLOW_CHILD_START_PADDING = 8;
export const WORKFLOW_LAYOUT_SAFE_AREA = { left: 64, top: 146, right: 64, bottom: 56 };
export const WORKFLOW_INTERNAL_LAYOUT_GAP = { rank: 72, node: 28 };
export const ROOT_LAYOUT_GAP = { rank: 96, node: 88 };
export const WORKFLOW_CONTAINER_Z_INDEX = 0;
export const WORKFLOW_INTERNAL_EDGE_Z_INDEX = 2;
export const WORKFLOW_INTERNAL_SELECTED_EDGE_Z_INDEX = 6;
export const WORKFLOW_INTERNAL_NODE_Z_INDEX = 4;
export const WORKFLOW_INTERNAL_SELECTED_NODE_Z_INDEX = 8;
export const INSPECTOR_DEFAULT_WIDTH = 390;
export const INSPECTOR_MIN_WIDTH = 320;
export const INSPECTOR_MAX_WIDTH = 640;
export const CONTROL_SLOT_LIMIT = 10;
export const DEFAULT_WORKFLOW_MAX_CONCURRENCY = 8;
export const MAX_LOG_PREVIEW_LINES = 180;
export const TASK_STORE_KEY = 'acc.workbench.tasks.v2';
export const DEFAULT_TASK_ID = 'task_canvas_default';
export const TEMPORARY_CALLABLE_ID_PREFIX = 'tmp_agent_';

export function agentDataPortSlot(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const aboveCount = Math.floor(count / 2);
  if (index < aboveCount) {
    return index - aboveCount;
  }
  return index - aboveCount + 1;
}

export function agentDataPortTop(index: number, count: number, nodeHeight: number): number {
  return nodeHeight / 2 + agentDataPortSlot(index, count) * AGENT_DATA_PORT_GAP;
}

export function agentDataPortMaxOffset(count: number): number {
  if (count <= 0) {
    return 0;
  }
  const aboveCount = Math.floor(count / 2);
  const belowCount = count - aboveCount;
  return Math.max(aboveCount, belowCount) * AGENT_DATA_PORT_GAP;
}
