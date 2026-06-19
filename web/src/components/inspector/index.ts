/**
 * NodeDetailOverlay - full node inspection floating panel.
 *
 * Extracted from WorkflowViewer.tsx lines 8175-8262.
 * The overlay is shown when a user double-clicks a node on the canvas.
 * It delegates to selected-detail panes extracted across the refactor.
 *
 * This file re-exports the NodeDetailOverlay as a thin wrapper so that
 * callers can import from `components/inspector`.
 */

export { NodeDetailOverlay } from './NodeDetailOverlay';
export { NodePromptEditor } from './NodePromptEditor';
export { RightInspector } from './RightInspector';
export { SelectionDetailsDock } from './SelectionDetailsDock';
export { CodexExecutionModeSelector } from './CodexExecutionModeSelector';
export { DataConnectionsPanel } from './DataConnectionsPanel';
export { EdgeInspector } from './EdgeInspector';
export { PortInspector } from './PortInspector';
export {
  SchemaFieldCards,
  dedupeSchemaFields,
  schemaFieldsFromArtifactContract,
  schemaFieldsFromJsonSchema,
  schemaFieldsFromPorts,
  type SchemaFieldCard,
} from './SchemaFieldCards';
export { SelectedNodeRuntimePane } from './SelectedNodeRuntimePane';
export { SelectionInputPane } from './SelectionInputPane';
export { SelectionOutputPane } from './SelectionOutputPane';
export { StructuredValueView } from './StructuredValueView';
