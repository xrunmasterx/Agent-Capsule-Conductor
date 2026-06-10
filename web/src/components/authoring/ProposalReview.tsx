/**
 * ProposalReview — canvas authoring proposal review UI helpers.
 *
 * This module will contain the proposal validation display, apply/discard
 * controls, and the deterministic proposal builder once extracted from
 * WorkflowViewer.tsx.
 *
 * Key functions that will live here:
 * - buildDeterministicCanvasAuthoringProposal
 * - validateCanvasAuthoringProposal
 * - mergeAuthoringValidation
 * - authoringValidationFromBackend
 *
 * Currently these remain in WorkflowViewer.tsx; named imports provide access.
 */

export {
  buildDeterministicCanvasAuthoringProposal,
  validateCanvasAuthoringProposal,
  applyCanvasAuthoringProposal,
  captureAuthoringSnapshot,
} from '../WorkflowViewer';
