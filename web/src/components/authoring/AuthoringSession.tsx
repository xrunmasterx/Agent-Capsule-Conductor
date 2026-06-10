/**
 * AuthoringSession — canvas authoring session logic.
 *
 * This module encapsulates the AI assistant authoring session lifecycle:
 * snapshot capture, proposal generation, validation, and application.
 *
 * Functions extracted from WorkflowViewer.tsx lines ~830-2200.
 */

// ---------------------------------------------------------------------------
// Re-export the authoring pure functions from WorkflowViewer via named imports.
// After the full extraction these will become direct exports from this module.
// ---------------------------------------------------------------------------

export {
  captureAuthoringSnapshot,
  buildDeterministicCanvasAuthoringProposal,
  validateCanvasAuthoringProposal,
  applyCanvasAuthoringProposal,
  temporaryResourceIssueForCanvas,
  temporaryResourceIssueForGraph,
} from '../WorkflowViewer';

/**
 * Re-exported authoring type references.
 *
 * After full extraction these will be owned by this module.
 * For now they remain inline in WorkflowViewer.tsx.
 */
export type {
  // - AuthoringContextSnapshot
  // - CanvasAuthoringOperation
  // - CanvasAuthoringProposal
  // - CanvasAuthoringValidationResult
  // - CanvasAuthoringApplyResult
  // - TemporaryResourceDraft
  // - TemporaryResourceDraftStatus
  // - WorkbenchAuthoringState
  // - CanvasAuthoringTarget
  // (currently defined inline in WorkflowViewer.tsx)
};
