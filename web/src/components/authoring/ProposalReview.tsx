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
 * Currently these remain in WorkflowViewer.tsx; this file reserves the
 * module path and provides type documentation.
 */

export { __workflowViewerTestables as _proposalInternals } from '../WorkflowViewer';
