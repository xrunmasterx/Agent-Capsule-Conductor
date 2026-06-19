/**
 * AuthoringSession - canvas authoring session logic.
 *
 * This barrel exposes the authoring runtime functions and keeps authoring
 * domain types anchored in `types/workbench`.
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

export type {
  AuthoringContextSnapshot,
  CanvasAuthoringOperation,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasAuthoringApplyResult,
  TemporaryResourceDraft,
  TemporaryResourceDraftStatus,
  WorkbenchAuthoringState,
  CanvasAuthoringTarget,
} from '../../types/workbench';
