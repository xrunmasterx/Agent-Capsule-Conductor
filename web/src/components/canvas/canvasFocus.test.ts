import { describe, expect, it } from 'vitest';
import type { WorkspaceCanvasModel } from '../../types/workbench';
import { focusCanvas } from './canvasFocus';

function canvasFixture(): WorkspaceCanvasModel {
  return {
    id: 'task-a',
    name: 'Task A',
    rootWorkflowId: 'workflow-a',
    workflows: [
      {
        id: 'workflow-a',
        title: 'Workflow A',
        directory: 'workflows/a',
        sourceKind: 'workflow',
        status: 'not_run',
        inputPorts: [{ id: 'target', label: 'Target', direction: 'input' }],
        outputPorts: [{ id: 'summary', label: 'Summary', direction: 'output' }],
        internalNodes: [
          {
            id: 'agent-a',
            name: 'Agent A',
            kind: 'Agent',
            task: 'agent',
            status: 'not_run',
            callableId: 'agent.a',
            inputPorts: [{ id: 'target', label: 'Target', direction: 'input' }],
            outputPorts: [{ id: 'main', label: 'Main', direction: 'output' }],
            position: { x: 120, y: 140 },
          },
        ],
        internalEdges: [
          {
            id: 'control_inputs_agent_a',
            kind: 'control',
            source: { workflowId: 'workflow-a__workflow_inputs' },
            target: { workflowId: 'agent-a' },
          },
        ],
        position: { x: 80, y: 90 },
        size: { width: 640, height: 360 },
        warnings: [],
      },
    ],
    edges: [],
  };
}

describe('focusCanvas', () => {
  it('returns the original canvas when no workflow is focused', () => {
    const canvas = canvasFixture();

    expect(focusCanvas(canvas, null)).toBe(canvas);
    expect(focusCanvas(canvas, 'missing')).toBe(canvas);
  });

  it('projects a workflow into focus mode with boundary nodes', () => {
    const focused = focusCanvas(canvasFixture(), 'workflow-a');

    expect(focused).toEqual(
      expect.objectContaining({
        id: 'task-a_workflow-a',
        layout: 'workflow-focus',
        focusedWorkflowId: 'workflow-a',
        rootWorkflowId: 'agent-a',
        edges: [
          {
            id: 'control_inputs_agent_a',
            kind: 'control',
            source: { workflowId: 'workflow-a__workflow_inputs' },
            target: { workflowId: 'agent-a' },
          },
        ],
      }),
    );
    expect(focused.workflows.map((workflow) => workflow.id)).toEqual([
      'workflow-a__workflow_inputs',
      'agent-a',
      'workflow-a__workflow_outputs',
    ]);
    expect(focused.workflows[0].outputPorts).toEqual([
      expect.objectContaining({ id: 'target', direction: 'output' }),
    ]);
    expect(focused.workflows[2].inputPorts).toEqual([
      expect.objectContaining({ id: 'summary', direction: 'input' }),
    ]);
  });
});
