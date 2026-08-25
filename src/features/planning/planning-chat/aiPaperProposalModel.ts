import type { IndexedQuestion } from "../../../shared/tauri/questionBankClient";

export interface AiPaperProposalPayload {
  title: string;
  description?: string;
  questionIds: string[];
}

export interface ResolvedAiPaperProposal {
  title: string;
  description?: string;
  questions: IndexedQuestion[];
  totalCount: number;
  choiceCount: number;
  blankCount: number;
  solutionCount: number;
  otherCount: number;
}

export function parseAiPaperProposal(
  jsonText: string,
): AiPaperProposalPayload | undefined {
  try {
    const raw: unknown = JSON.parse(jsonText.trim());
    if (typeof raw !== "object" || raw === null) return undefined;
    const record = raw as Record<string, unknown>;
    const title =
      typeof record.title === "string" ? record.title.trim() : "智能组卷测试";
    const description =
      typeof record.description === "string"
        ? record.description.trim()
        : undefined;
    const questionIds = Array.isArray(record.questionIds)
      ? record.questionIds
          .filter(
            (id): id is string =>
              typeof id === "string" && id.trim().length > 0,
          )
          .map((id) => id.trim())
      : [];

    if (questionIds.length === 0) return undefined;

    return {
      title: title || "智能组卷测试",
      description,
      questionIds,
    };
  } catch {
    return undefined;
  }
}

export function resolveAiPaperProposal(
  proposal: AiPaperProposalPayload,
  availableQuestions: readonly IndexedQuestion[],
): ResolvedAiPaperProposal {
  const questionsById = new Map(
    availableQuestions.map((question) => [question.id, question]),
  );

  const questions = proposal.questionIds.flatMap((id) => {
    const matched = questionsById.get(id);
    return matched !== undefined ? [matched] : [];
  });

  let choiceCount = 0;
  let blankCount = 0;
  let solutionCount = 0;
  let otherCount = 0;

  for (const question of questions) {
    if (question.questionType === "choice") choiceCount++;
    else if (question.questionType === "blank") blankCount++;
    else if (question.questionType === "solution") solutionCount++;
    else otherCount++;
  }

  return {
    title: proposal.title,
    description: proposal.description,
    questions,
    totalCount: questions.length,
    choiceCount,
    blankCount,
    solutionCount,
    otherCount,
  };
}

export function summarizeQuestionBankForPrompt(
  questions: readonly IndexedQuestion[],
  maxQuestions = 120,
): string {
  if (questions.length === 0) return "";
  const sampled = questions.slice(0, maxQuestions);
  const lines = sampled.map((q) => {
    const typeStr =
      q.questionType === "choice"
        ? "单选"
        : q.questionType === "blank"
          ? "填空"
          : q.questionType === "solution"
            ? "解答"
            : "其他";
    const statusStr =
      q.incorrectCount > 0 ? "错题" : q.attemptCount > 0 ? "已做" : "未做";
    return `- [${q.id}] ${q.subjectName} | ${q.chapter} | ${typeStr} | 第${q.questionNumber}题 | ${q.title || "题目"} (${statusStr})`;
  });

  return [
    "【工作区题库可用题目清单（如需为用户组卷，请在回答末尾使用 ```kystudy-paper 代码块输出包含 title、description 和选中的 questionIds 数组）】",
    ...lines,
    questions.length > maxQuestions
      ? `(题库共有 ${questions.length} 道题目，此处展示前 ${maxQuestions} 道供参考)`
      : `(题库共有 ${questions.length} 道题目)`,
  ].join("\n");
}
