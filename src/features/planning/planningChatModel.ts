import type {
  PlanningChatPreview,
  PlanningChatRequest,
  PlanningQuestionContext,
} from "../../shared/tauri/planningChatClient";
import type { ResourceSearchResult } from "../../shared/tauri/resourceSearchClient";

export const MAX_PLANNING_CONTEXTS = 6;
export const MAX_PLANNING_ATTACHMENTS = 6;
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

export const DEFAULT_CHAT_MAX_OUTPUT_TOKENS = 131_072;
export const MAX_PLANNING_IMAGES = 6;

export function buildPlanningChatRequest(
  conversationId: string | undefined,
  question: string,
  contexts: SelectedPlanningContext[],
  outputLimit?: string,
  questionContext?: PlanningQuestionContext,
  attachmentIds: string[] = [],
  imageDataUrls: string[] = [],
): PlanningChatRequest | undefined {
  const normalizedQuestion = question.trim();
  const maxOutputTokens =
    outputLimit === undefined || outputLimit === ""
      ? DEFAULT_CHAT_MAX_OUTPUT_TOKENS
      : Number(outputLimit);
  const totalImageCount =
    imageDataUrls.length + (questionContext?.imageDataUrls.length ?? 0);
  if (
    conversationId === undefined ||
    (normalizedQuestion === "" && imageDataUrls.length === 0) ||
    contexts.length > MAX_PLANNING_CONTEXTS ||
    attachmentIds.length > MAX_PLANNING_ATTACHMENTS ||
    totalImageCount > MAX_PLANNING_IMAGES ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    !isValidQuestionContext(questionContext)
  ) {
    return undefined;
  }
  return {
    conversationId,
    question: normalizedQuestion || "请结合图片进行分析",
    contexts: contexts.map((context) => context.selection),
    questionContext,
    attachmentIds,
    imageDataUrls,
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
    transport: preview.transport,
    attachments: preview.attachments,
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
