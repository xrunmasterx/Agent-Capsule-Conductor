import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { NodeDetailOverlay } from './NodeDetailOverlay';

describe('NodeDetailOverlay', () => {
  test('wraps detail panes with node-detail chrome and close action', () => {
    const onClose = vi.fn();

    render(
      <NodeDetailOverlay
        model={{ title: '业务模式分析', subtitle: 'Inside: 基本面工作流', status: 'success' }}
        onClose={onClose}
      >
        <section>输入</section>
        <section>属性</section>
        <section>输出</section>
      </NodeDetailOverlay>,
    );

    expect(screen.getByLabelText('节点详情浮层')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('业务模式分析')).toBeInTheDocument();
    expect(screen.getByText('Inside: 基本面工作流')).toBeInTheDocument();
    expect(screen.getByText('输入')).toBeInTheDocument();
    expect(screen.getByText('属性')).toBeInTheDocument();
    expect(screen.getByText('输出')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭节点详情' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
