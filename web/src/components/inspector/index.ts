/**
 * NodeDetailOverlay - full node inspection floating panel.
 *
 * Extracted from WorkflowViewer.tsx lines 8175-8262.
 * The overlay is shown when a user double-clicks a node on the canvas.
 * It delegates to SelectionInputPane, SelectionPropertiesPane, and
 * SelectionOutputPane which remain in WorkflowViewer until a later
 * extraction step (they have heavy coupling to the canvas model types).
 *
 * This file re-exports the NodeDetailOverlay as a thin wrapper so that
 * callers can import from `components/inspector`.
 */

export { NodeDetailOverlay } from './NodeDetailOverlay';
export { RightInspector } from './RightInspector';
export { SelectionDetailsDock } from './SelectionDetailsDock';
export { DataConnectionsPanel } from './DataConnectionsPanel';
export { EdgeInspector } from './EdgeInspector';
export { PortInspector } from './PortInspector';
