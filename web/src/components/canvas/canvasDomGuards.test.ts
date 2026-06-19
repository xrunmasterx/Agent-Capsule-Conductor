import { describe, expect, it } from 'vitest';
import {
  isNodeDetailDoubleClickIgnored,
  isTextEditingKeyboardTarget,
} from './canvasDomGuards';

describe('canvasDomGuards', () => {
  it('detects text editing keyboard targets', () => {
    document.body.innerHTML = `
      <div>
        <input id="input" />
        <div id="editor" class="cm-editor"></div>
        <button id="button"></button>
      </div>
    `;

    expect(isTextEditingKeyboardTarget(document.getElementById('input'))).toBe(true);
    expect(isTextEditingKeyboardTarget(document.getElementById('editor'))).toBe(true);
    expect(isTextEditingKeyboardTarget(document.getElementById('button'))).toBe(false);
  });

  it('ignores node details double clicks from interactive targets', () => {
    document.body.innerHTML = `
      <article>
        <button id="button"></button>
        <span id="port" class="workflow-port-click-target"></span>
        <strong id="label"></strong>
      </article>
    `;

    expect(isNodeDetailDoubleClickIgnored(document.getElementById('button'))).toBe(true);
    expect(isNodeDetailDoubleClickIgnored(document.getElementById('port'))).toBe(true);
    expect(isNodeDetailDoubleClickIgnored(document.getElementById('label'))).toBe(false);
  });
});
