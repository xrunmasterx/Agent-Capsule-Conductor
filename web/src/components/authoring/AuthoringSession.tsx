/**
 * AuthoringSession — canvas authoring session logic.
 *
 * This module encapsulates the AI assistant authoring session lifecycle:
 * snapshot capture, proposal generation, validation, and application.
 *
 * Functions extracted from WorkflowViewer.tsx lines ~830-2200.
 */

// ---------------------------------------------------------------------------
// Re-export the authoring pure functions from WorkflowViewer until the full
// extraction is completed in step 7 of the refactoring plan.
// ---------------------------------------------------------------------------

export { __workflowViewerTestables as _authoringInternals } from '../WorkflowViewer';

/**
 * Re-exported authoring function references.
 *
 * After step 7 these will become direct named exports from this module.
 * For now, callers should continue to use them from WorkflowViewer.
 */
export type {
  // These are the key authoring types that will be owned by this module:
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
