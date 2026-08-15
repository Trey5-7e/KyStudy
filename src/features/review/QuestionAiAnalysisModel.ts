import type {
  Question,
  QuestionRegion,
} from "../../shared/tauri/questionClient";

export function questionAiInputFingerprint(
  question: Question,
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

export function analysisPrompt(question: Question, imageCount: number): string {
  const type = {
    choice: "选择题",
    blank: "填空题",
    solution: "解答题",
    other: "其他题型",
  }[question.questionType ?? "other"];
  return [
    "你是考研学习辅助老师。请分析随附题目图片，图片顺序就是题目区域顺序。",
    `题目：${question.title}；来源：${question.documentTitle}；题型：${type}；图片：${imageCount} 张。`,
    "请用中文依次给出：解题思路、关键步骤、最终结论、易错点。若图片信息不足或无法确认答案，请明确说明，不要猜测。控制篇幅，避免复述整道题。",
  ].join("\n");
}
