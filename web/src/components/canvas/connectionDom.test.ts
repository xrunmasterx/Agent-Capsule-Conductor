import { describe, expect, it, vi } from 'vitest';
import {
  closestConnectionHandle,
  connectionModeForHandleElement,
  connectionSideFromHandleElement,
  isConnectionHandleForMode,
  queueControlHandleConnectionStart,
} from './connectionDom';

describe('connectionDom', () => {
  it('classifies control and data handles by DOM contract', () => {
    document.body.innerHTML = `
      <div>
        <button
          class="workflow-control-handle target"
          data-nodeid="workflow-a"
          data-handleid="workflow-a:control:target"
        >
          <span id="nested-control">control</span>
        </button>
        <button
          class="workflow-port-handle source"
          data-nodeid="node-a"
          data-handleid="node-a:port:output:main"
        ></button>
      </div>
    `;

    const nestedControl = document.getElementById('nested-control');
    const controlHandle = closestConnectionHandle(nestedControl);
    const dataHandle = document.querySelector<HTMLElement>('.workflow-port-handle');

    expect(controlHandle).toBeInstanceOf(HTMLElement);
    expect(dataHandle).toBeInstanceOf(HTMLElement);
    expect(connectionModeForHandleElement(controlHandle!)).toBe('control');
    expect(connectionSideFromHandleElement(controlHandle!)).toBe('target');
    expect(isConnectionHandleForMode(controlHandle!, 'control')).toBe(true);
    expect(isConnectionHandleForMode(controlHandle!, 'data')).toBe(false);
    expect(connectionModeForHandleElement(dataHandle!)).toBe('data');
    expect(connectionSideFromHandleElement(dataHandle!)).toBe('source');
    expect(isConnectionHandleForMode(dataHandle!, 'data')).toBe(true);
  });

  it('queues a connection start only for handles matching the requested mode', () => {
    document.body.innerHTML = `
      <div>
        <button
          class="agent-control-handle source"
          data-nodeid="agent-a"
          data-handleid="agent-a:control:source"
        >
          <span id="nested-source">start</span>
        </button>
        <button
          class="workflow-port-handle target"
          data-nodeid="agent-b"
          data-handleid="agent-b:port:input:main"
        ></button>
      </div>
    `;
    const onStart = vi.fn();
    const nestedSource = document.getElementById('nested-source');
    const dataHandle = document.querySelector<HTMLElement>('.workflow-port-handle');

    expect(queueControlHandleConnectionStart(nestedSource, onStart, 'control')).toBe(true);
    expect(onStart).toHaveBeenCalledWith('agent-a', 'agent-a:control:source', 'source', 'control');

    expect(queueControlHandleConnectionStart(dataHandle, onStart, 'control')).toBe(false);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
