import { describe, expect, test } from 'vitest';

import type { InternalNodeView, WorkbenchChromeState, WorkflowContainerModel } from '../../types/workbench';
import { authoringSelectionLabel, workbenchViewProjection } from './workbenchViewProjection';

function chrome(rightPanel: WorkbenchChromeState['rightPanel']): WorkbenchChromeState {
  return {
    leftPanel: 'tasks',
    rightPanel,
    inspectorWidth: 360,
  };
}

function workflow(overrides: Partial<WorkflowContainerModel> = {}): WorkflowContainerModel {
  return {
    id: 'flow',
    title: 'Flow',
    directory: 'workflows/flow',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 320, height: 240 },
    warnings: [],
    ...overrides,
  };
}

function internalNode(): InternalNodeView {
  return {
    id: 'agent',
    name: 'Agent',
    task: 'Run agent',
    kind: 'Agent',
    status: 'not_run',
  };
}

describe('workbenchViewProjection', () => {
  test('projects visible blueprint panels from chrome and dock state', () => {
    expect(
      workbenchViewProjection({
        taskWorkspaceView: 'blueprint',
        chrome: chrome('inspector'),
        bottomDockMode: 'assistant',
        evidenceDockOpen: true,
      }),
    ).toMatchObject({
      blueprintActive: true,
      rightPanelVisible: true,
      inspectorOpen: true,
      assistantOpen: true,
      detailsOpen: false,
    });
  });

  test('hides blueprint panels outside blueprint view', () => {
    expect(
      workbenchViewProjection({
        taskWorkspaceView: 'overview',
        chrome: chrome('inspector'),
        bottomDockMode: 'evidence',
        evidenceDockOpen: true,
      }),
    ).toEqual({
      blueprintActive: false,
      rightPanelVisible: false,
      resourceDetailOpen: false,
      inspectorOpen: false,
      assistantOpen: false,
      detailsOpen: false,
    });
  });

  test('formats authoring selection labels by selected entity type', () => {
    expect(authoringSelectionLabel({ type: 'task_canvas', taskId: 'task' })).toBe('当前任务画布');
    expect(authoringSelectionLabel({ type: 'workflow', id: 'flow' }, workflow({ invocationLabel: 'Research' }))).toBe(
      'Workflow: Research',
    );
    expect(
      authoringSelectionLabel(
        { type: 'internal', workflowId: 'flow', nodeId: 'agent' },
        workflow({ invocationLabel: 'Research' }),
        internalNode(),
      ),
    ).toBe('内部节点: Research / Agent');
    expect(authoringSelectionLabel({ type: 'edge', id: 'edge_1', scopeWorkflowId: null })).toBe('连线: root / edge_1');
    expect(authoringSelectionLabel({ type: 'port', workflowId: 'flow', portId: 'main', direction: 'input' })).toBe(
      '端口: flow.main',
    );
  });
});
