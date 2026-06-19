/**
 * Assistant barrel export.
 *
 * Consumers import from `components/assistant` to access assistant UI
 * components and related types.
 */

export { AssistantTurnList, type AssistantChatMessage } from './AssistantTurnList';
export {
  AssistantDrawer,
  AssistantDockContent,
  AssistantControlRail,
  AssistantProposalSummary,
} from './AssistantDrawer';
export type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
export type {
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  SelectedEntityDetailsModel,
  TemporaryResourceDraft,
} from '../../types/workbench';
