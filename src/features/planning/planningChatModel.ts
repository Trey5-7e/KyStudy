import type {
  PlanningChatPreview,
  PlanningChatRequest,
  PlanningQuestionContext,
} from "../../shared/tauri/planningChatClient";
import type { ResourceSearchResult } from "../../shared/tauri/resourceSearchClient";

export const MAX_PLANNING_CONTEXTS = 6;
export const MAX_PLANNING_QUESTION_IMAGES = 6;
export const MAX_PLANNING_QUESTION_CONTEXT_CHARS = 12_000;

export interface SelectedPlanningContext {
  selection: PlanningChatRequest["contexts"][number];
  title: string;
  excerpt: string;
}

export function togglePlanningContext(
  current: SelectedPlanningContext[],
  result: ResourceSearchResult,
  searchQuery: string,
): SelectedPlanningContext[] {
  if (result.pageNumber === undefined) return current;
  const key = `${result.documentId}:${result.pageNumber}`;
  const exists = current.some(
    (context) =>
      `${context.selection.documentId}:${context.selection.pageNumber}` === key,
  );
  if (exists) {
    return current.filter(
      (context) =>
        `${context.selection.documentId}:${context.selection.pageNumber}` !==
        key,
    );
  }
  if (current.length >= MAX_PLANNING_CONTEXTS) return current;
  return [
    ...current,
    {
      selection: {
        documentId: result.documentId,
        pageNumber: result.pageNumber,
        searchQuery,
      },
      title: result.documentTitle,
      excerpt: result.excerpt,
    },
  ];
}

export function buildPlanningChatRequest(
  conversationId: string | undefined,
  question: string,
  contexts: SelectedPlanningContext[],
  outputLimit: string,
  questionContext?: PlanningQuestionContext,
): PlanningChatRequest | undefined {
  const normalizedQuestion = question.trim();
  const maxOutputTokens = Number(outputLimit);
  if (
    conversationId === undefined ||
    normalizedQuestion === "" ||
    contexts.length > MAX_PLANNING_CONTEXTS ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 1800 ||
    !isValidQuestionContext(questionContext)
  ) {
    return undefined;
  }
  return {
    conversationId,
    question: normalizedQuestion,
    contexts: contexts.map((context) => context.selection),
    questionContext,
    maxOutputTokens,
  };
}

export function planningPreviewFingerprint(
  request: PlanningChatRequest,
  preview: PlanningChatPreview,
): string {
  return JSON.stringify({
    request,
    destination: preview.preview.destination,
    prompt: preview.preview.prompt,
    providerType: preview.preview.providerType,
    providerName: preview.preview.providerName,
    modelName: preview.preview.modelName,
    projectedTokens: preview.preview.projectedTokens,
    sources: preview.sources,
  });
}

function isValidQuestionContext(
  value: PlanningQuestionContext | undefined,
): boolean {
  if (value === undefined) return true;
  return (
    value.title.trim() !== "" &&
    value.title.length <= 300 &&
    value.documentTitle.trim() !== "" &&
    value.documentTitle.length <= 300 &&
    (value.analysis === undefined ||
      value.analysis.length <= MAX_PLANNING_QUESTION_CONTEXT_CHARS) &&
    value.imageDataUrls.length <= MAX_PLANNING_QUESTION_IMAGES
  );
}

export function confirmedPromptMatches(
  preview: PlanningChatPreview,
  confirmedPrompt: string,
): boolean {
  return preview.preview.prompt === confirmedPrompt;
}

export function isCurrentPlanningRequest(
  requestId: number,
  currentRequestId: number,
  mounted = true,
): boolean {
  return mounted && requestId === currentRequestId;
}
