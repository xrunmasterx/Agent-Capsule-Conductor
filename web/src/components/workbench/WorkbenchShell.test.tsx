import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { WorkbenchShell } from './WorkbenchShell';

describe('WorkbenchShell', () => {
  test('writes durable readiness to the shell data attribute', () => {
    const { rerender } = render(
      <WorkbenchShell durableTasksReady={false}>
        <div>canvas</div>
      </WorkbenchShell>,
    );

    expect(screen.getByLabelText('ACC Workbench')).toHaveAttribute('data-durable-tasks-ready', 'false');

    rerender(
      <WorkbenchShell durableTasksReady>
        <div>canvas</div>
      </WorkbenchShell>,
    );

    expect(screen.getByLabelText('ACC Workbench')).toHaveAttribute('data-durable-tasks-ready', 'true');
  });
});
