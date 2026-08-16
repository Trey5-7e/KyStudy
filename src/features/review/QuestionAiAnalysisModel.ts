import type {
  QuestionType,
  QuestionRegion,
} from "../../shared/tauri/questionClient";

export const DEFAULT_QUESTION_AI_INSTRUCTIONS =
  "请用中文依次给出：解题思路、关键步骤、最终结论、易错点。若图片信息不足或无法确认答案，请明确说明，不要猜测。控制篇幅，避免复述整道题。";
export const DEFAULT_QUESTION_AI_ROLE = "你是考研学习辅助老师。";
const DEFAULT_QUESTION_AI_CONTEXT_PREFIX = `${DEFAULT_QUESTION_AI_ROLE}请分析随附题目图片，图片顺序就是题目区域顺序。`;
export const QUESTION_AI_INSTRUCTIONS_MAX_CHARS = 18_000;

const QUESTION_AI_INSTRUCTIONS_KEY =
  "kystudy.ai.questionAnalysisInstructions.v1";
const QUESTION_AI_PROMPT_KEY = "kystudy.ai.questionAnalysisPrompt.v2";
let fallbackQuestionAiInstructions: string | undefined;
let fallbackQuestionAiPrompt: { prompt: string; context: string } | undefined;

export interface QuestionAiInput {
  id: string;
  documentId: string;
  documentTitle: string;
  title: string;
  questionType?: QuestionType;
  updatedAt?: number;
}

export function questionAiInputFingerprint(
  question: QuestionAiInput,
  regions: QuestionRegion[],
  imageDataUrls: string[] = [],
): string {
  return JSON.stringify({
    question: {
      id: question.id,
      documentId: question.documentId,
      documentTitle: question.documentTitle,
      title: question.title,
      questionType: question.questionType ?? "other",
      updatedAt: question.updatedAt,
    },
    regions: regions.map((region) => ({
      id: region.id,
      pageNumber: region.pageNumber,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      sortOrder: region.sortOrder,
    })),
    imageDataUrls,
  });
}

/** Identifies the saved analysis source without embedding rendered image data. */
export function questionAiSourceFingerprint(
  question: QuestionAiInput,
  regions: QuestionRegion[],
  promptPreference = DEFAULT_QUESTION_AI_INSTRUCTIONS,
): string {
  const normalizedPromptPreference =
    promptPreference.trim() || DEFAULT_QUESTION_AI_INSTRUCTIONS;
  const stablePreference = stablePromptPreference(normalizedPromptPreference);
  const defaultPreference = `${DEFAULT_QUESTION_AI_CONTEXT_PREFIX}\n${DEFAULT_QUESTION_AI_INSTRUCTIONS}`;
  if (
    normalizedPromptPreference === DEFAULT_QUESTION_AI_INSTRUCTIONS ||
    stablePreference === defaultPreference
  ) {
    return questionAiInputFingerprint(question, regions);
  }
  return JSON.stringify({
    source: questionAiInputFingerprint(question, regions),
    instructions: stablePreference,
  });
}

export function analysisPrompt(
  question: QuestionAiInput,
  imageCount: number,
  instructions = DEFAULT_QUESTION_AI_INSTRUCTIONS,
): string {
  return [
    questionAiPromptContext(question, imageCount),
    instructions.trim() || DEFAULT_QUESTION_AI_INSTRUCTIONS,
  ].join("\n");
}

export function questionAiPromptContext(
  question: QuestionAiInput,
  imageCount: number,
): string {
  const type = {
    choice: "选择题",
    blank: "填空题",
    solution: "解答题",
    other: "其他题型",
  }[question.questionType ?? "other"];
  return [
    DEFAULT_QUESTION_AI_CONTEXT_PREFIX,
    `题目：${question.title}；来源：${question.documentTitle}；题型：${type}；图片：${imageCount} 张。`,
  ].join("\n");
}

/**
 * Returns the complete prompt shown in the editor. The saved prompt keeps
 * the current question context separately so it can be refreshed when the
 * learner moves to another question.
 */
export function loadQuestionAiPrompt(
  question: QuestionAiInput,
  imageCount: number,
): string {
  const context = questionAiPromptContext(question, imageCount);
  const saved = readSavedQuestionAiPrompt();
  if (saved === undefined) {
    return analysisPrompt(question, imageCount, loadQuestionAiInstructions());
  }
  return replaceQuestionAiPromptContext(saved.prompt, saved.context, context);
}

export function saveQuestionAiPrompt(prompt: string, context: string): void {
  const normalizedPrompt = prompt.trim();
  const normalizedContext = context.trim();
  if (typeof window === "undefined") {
    fallbackQuestionAiPrompt =
      normalizedPrompt === ""
        ? undefined
        : { prompt: normalizedPrompt, context: normalizedContext };
    return;
  }
  try {
    if (normalizedPrompt === "") {
      window.localStorage.removeItem(QUESTION_AI_PROMPT_KEY);
    } else {
      window.localStorage.setItem(
        QUESTION_AI_PROMPT_KEY,
        JSON.stringify({
          prompt: normalizedPrompt,
          context: normalizedContext,
        }),
      );
    }
  } catch {
    fallbackQuestionAiPrompt =
      normalizedPrompt === ""
        ? undefined
        : { prompt: normalizedPrompt, context: normalizedContext };
    // A restricted WebView storage should not block the current AI request.
  }
}

/**
 * Removes the generated question line before hashing a prompt preference.
 * This makes the same custom role/instructions reusable across questions
 * while still keeping old instruction-only fingerprints compatible.
 */
function stablePromptPreference(prompt: string): string {
  const lines = prompt.trim().split(/\r?\n/);
  const dynamicContextIndex = lines.findIndex(
    (line, index) => index > 0 && line.trimStart().startsWith("题目："),
  );
  if (dynamicContextIndex >= 0) {
    lines.splice(dynamicContextIndex, 1);
  }
  return lines.join("\n").trim();
}

function replaceQuestionAiPromptContext(
  prompt: string,
  previousContext: string,
  nextContext: string,
): string {
  const normalizedPrompt = prompt.trim();
  const normalizedPreviousContext = previousContext.trim();
  if (normalizedPreviousContext !== "") {
    const previousContextIndex = normalizedPrompt.indexOf(
      normalizedPreviousContext,
    );
    if (previousContextIndex >= 0) {
      return `${normalizedPrompt.slice(0, previousContextIndex)}${nextContext}${normalizedPrompt.slice(previousContextIndex + normalizedPreviousContext.length)}`.trim();
    }
  }

  const nextContextLines = nextContext.split("\n");
  const lines = normalizedPrompt.split(/\r?\n/);
  const dynamicContextIndex = lines.findIndex(
    (line, index) => index > 0 && line.trimStart().startsWith("题目："),
  );
  if (dynamicContextIndex >= 0) {
    lines[dynamicContextIndex] = nextContextLines[1] ?? "";
    return lines.join("\n").trim();
  }

  if (lines.length === 0 || lines[0] === "") return nextContext;
  return [lines[0], nextContextLines[1], ...lines.slice(1)]
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

function readSavedQuestionAiPrompt():
  { prompt: string; context: string } | undefined {
  if (typeof window === "undefined") return fallbackQuestionAiPrompt;
  try {
    const raw = window.localStorage.getItem(QUESTION_AI_PROMPT_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("prompt" in parsed) ||
      typeof parsed.prompt !== "string" ||
      !("context" in parsed) ||
      typeof parsed.context !== "string"
    ) {
      return undefined;
    }
    return { prompt: parsed.prompt, context: parsed.context };
  } catch {
    return fallbackQuestionAiPrompt;
  }
}

export function loadQuestionAiInstructions(): string {
  if (typeof window === "undefined") {
    return fallbackQuestionAiInstructions ?? DEFAULT_QUESTION_AI_INSTRUCTIONS;
  }
  try {
    const value = window.localStorage.getItem(QUESTION_AI_INSTRUCTIONS_KEY);
    return value?.trim() || DEFAULT_QUESTION_AI_INSTRUCTIONS;
  } catch {
    return fallbackQuestionAiInstructions ?? DEFAULT_QUESTION_AI_INSTRUCTIONS;
  }
}

export function saveQuestionAiInstructions(value: string): void {
  const normalized = value.trim();
  if (typeof window === "undefined") {
    fallbackQuestionAiInstructions = normalized || undefined;
    return;
  }
  try {
    if (normalized === "") {
      window.localStorage.removeItem(QUESTION_AI_INSTRUCTIONS_KEY);
    } else {
      window.localStorage.setItem(QUESTION_AI_INSTRUCTIONS_KEY, normalized);
    }
  } catch {
    fallbackQuestionAiInstructions = normalized || undefined;
    // A restricted WebView storage should not block the current AI request.
  }
}
