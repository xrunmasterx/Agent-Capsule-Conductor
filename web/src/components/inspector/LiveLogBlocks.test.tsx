import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { LiveLogBlocks } from './LiveLogBlocks';

describe('LiveLogBlocks', () => {
  test('renders nothing without live logs', () => {
    const { container } = render(<LiveLogBlocks />);

    expect(container).toBeEmptyDOMElement();
  });

  test('renders stdout and stderr log blocks independently', () => {
    render(<LiveLogBlocks liveLogs={{ stdout: 'hello stdout', stderr: 'hello stderr', stdoutOffset: 0, stderrOffset: 0 }} />);

    expect(screen.getByRole('region', { name: 'Live stdout' })).toHaveTextContent('hello stdout');
    expect(screen.getByRole('region', { name: 'Live stderr' })).toHaveTextContent('hello stderr');
  });
});
