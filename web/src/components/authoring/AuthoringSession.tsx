/**
 * AuthoringSession — canvas authoring session logic.
 *
 * This module encapsulates the AI assistant authoring session lifecycle:
 * snapshot capture, proposal generation, validation, and application.
 *
 * Functions extracted from WorkflowViewer.tsx.
 */

export {
  captureAuthoringSnapshot,
  buildDeterministicCanvasAuthoringProposal,
  validateCanvasAuthoringProposal,
  applyCanvasAuthoringProposal,
} from './authoringRuntime';

export {
  temporaryResourceIssueForCanvas,
  temporaryResourceIssueForGraph,
} from '../../workbench/model/authoringProposal';

/**
 * Re-exported authoring type references.
 *
 * Authoring domain types are owned by `types/workbench`.
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
