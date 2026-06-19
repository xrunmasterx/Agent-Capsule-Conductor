import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasToolbar, ConnectPreviewLine, NodeCreateMenu } from './CanvasToolbar';

describe('CanvasToolbar', () => {
  it('emits connection and edge view mode changes', () => {
    const onConnectionMode = vi.fn();
    const onEdgeViewMode = vi.fn();
    render(
      <CanvasToolbar
        connectionMode="control"
        edgeViewMode="control"
        focusedWorkflowId="workflow-a"
        workflowRun={{ workflow_id: 'workflow-a', status: 'running' } as never}
        onConnectionMode={onConnectionMode}
        onEdgeViewMode={onEdgeViewMode}
        onExitFocus={vi.fn()}
      />,
    );

    const groups = document.querySelectorAll('.segmented-control');
    fireEvent.click(groups[0].querySelectorAll('button')[1]);
    fireEvent.click(groups[1].querySelectorAll('button')[2]);

    expect(onConnectionMode).toHaveBeenCalledWith('data');
    expect(onEdgeViewMode).toHaveBeenCalledWith('all');
  });

  it('shows the exit focus action only inside a focused workflow', () => {
    const onExitFocus = vi.fn();
    const { rerender } = render(
      <CanvasToolbar
        connectionMode="control"
        edgeViewMode="control"
        focusedWorkflowId={null}
        workflowRun={null}
        onConnectionMode={vi.fn()}
        onEdgeViewMode={vi.fn()}
        onExitFocus={onExitFocus}
      />,
    );

    expect(screen.queryByText('返回 Workspace')).toBeNull();

    rerender(
      <CanvasToolbar
        connectionMode="control"
        edgeViewMode="control"
        focusedWorkflowId="workflow-a"
        workflowRun={null}
        onConnectionMode={vi.fn()}
        onEdgeViewMode={vi.fn()}
        onExitFocus={onExitFocus}
      />,
    );
    fireEvent.click(screen.getByText('返回 Workspace'));

    expect(onExitFocus).toHaveBeenCalledTimes(1);
  });
});

describe('NodeCreateMenu', () => {
  it('picks callable palette items in focused workflow mode', () => {
    const onPick = vi.fn();
    render(
      <NodeCreateMenu
        x={100}
        y={120}
        focused
        callables={[
          { id: 'file-source.local', name: 'File Source' },
          { id: 'agent.alpha', name: 'Alpha Agent' },
        ] as never}
        workflows={[]}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Alpha Agent'));

    expect(onPick).toHaveBeenCalledWith({
      kind: 'agent',
      callableId: 'agent.alpha',
      label: 'Alpha Agent',
    });
  });

  it('picks workflow palette items outside focused workflow mode', () => {
    const onPick = vi.fn();
    render(
      <NodeCreateMenu
        x={100}
        y={120}
        focused={false}
        callables={[]}
        workflows={[{ workflow_id: 'workflow-a', name: 'Workflow A', path: 'workflows/a.accflow.json' }] as never}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Workflow A'));

    expect(onPick).toHaveBeenCalledWith({
      kind: 'workflow',
      workflowRef: 'workflows/a.accflow.json',
      label: 'Workflow A',
    });
  });
});

describe('ConnectPreviewLine', () => {
  it('renders a snapped preview path from pointer positions', () => {
    const { container } = render(
      <ConnectPreviewLine
        preview={{
          start: { x: 10, y: 20 },
          end: { x: 90, y: 60 },
          snapped: true,
        }}
      />,
    );

    const svg = container.querySelector('svg');
    const path = container.querySelector('path');
    expect(svg?.classList.contains('snapped')).toBe(true);
    expect(path?.getAttribute('d')).toBe('M 10 20 C 58 20 42 60 90 60');
  });
});
