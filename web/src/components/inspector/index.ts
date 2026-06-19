/**
 * NodeDetailOverlay - full node inspection floating panel.
 * * The overlay is shown when a user double-clicks a node on the canvas.
 * It delegates to selected-detail panes extracted across the refactor.
 *
 * This file re-exports the NodeDetailOverlay as a thin wrapper so that
 * callers can import from `components/inspector`.
 */

export { NodeDetailOverlay } from './NodeDetailOverlay';
export { InvocationIdentityCard } from './InvocationIdentityCard';
export { InvocationInputEditor } from './InvocationInputEditor';
export { NodePromptEditor } from './NodePromptEditor';
export { PropertyGroups } from './PropertyGroups';
export { RightInspector } from './RightInspector';
export { RunEvidenceCard } from './RunEvidenceCard';
export { SelectionDetailsDock } from './SelectionDetailsDock';
export { CodexExecutionModeSelector } from './CodexExecutionModeSelector';
export { DataConnectionsPanel } from './DataConnectionsPanel';
export { EdgeInspector } from './EdgeInspector';
export { EvidencePreview } from './EvidencePreview';
export { EventTimeline } from './EventTimeline';
export { AgentSessionPanel } from './AgentSessionPanel';
export { AgentNodeSettingsPanel, SelectionPropertiesPane } from './AgentNodeSettingsPanel';
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
export { TechnicalDetailsDisclosure } from './TechnicalDetailsDisclosure';
