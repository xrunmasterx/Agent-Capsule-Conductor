export function isTextEditingKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .monaco-editor'));
}

export function isNodeDetailDoubleClickIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, input, textarea, select, [contenteditable="true"], .workflow-port-click-target, .workflow-port-node, .workflow-control-handle, .react-flow__handle',
    ),
  );
}
