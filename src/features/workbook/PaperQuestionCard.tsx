import type { RefObject } from "react";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type { AttemptResult } from "../../shared/tauri/questionClient";
import { QuestionAiAnalysis } from "../review/QuestionAiAnalysis";
import { QuestionRegionCard } from "../review/QuestionRegionCard";
import { partLabel, typeLabel } from "./QuestionIndexDialogs";

function attemptLabel(value: AttemptResult): string {
  return { correct: "做对", uncertain: "不全对", incorrect: "做错" }[value];
}

export function PaperQuestionCard({
  question,
  index,
  paperIndex,
  result,
  deferImages = false,
  questionRef,
  onResult,
  onAdjust,
  onEdit,
}: {
  question: IndexedQuestion;
  index: number;
  paperIndex: number;
  result?: AttemptResult;
  deferImages?: boolean;
  questionRef?: RefObject<HTMLElement | null>;
  onResult(questionId: string, result: AttemptResult): void;
  onAdjust(questionId: string): void;
  onEdit(questionId: string): void;
}) {
  return (
    <article
      id={`paper-question-${question.id}`}
      ref={questionRef}
      tabIndex={-1}
      className="generated-paper-question question-bank-paper-card"
      aria-label={`第 ${paperIndex + 1} 题`}
    >
      <header>
        <div>
          <span>
            第 {index + 1} 题 · 全卷第 {paperIndex + 1} 题
          </span>
          <h3>
            {question.subjectName} · {question.chapter}
          </h3>
        </div>
        <div className="generated-paper-question-tools">
          <small>
            {question.workbookName} / {partLabel(question.sectionPart)} /{" "}
            {typeLabel(question.questionType)} / 原题号{" "}
            {question.questionNumber}
          </small>
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onAdjust(question.id)}
            >
              校正区域
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onEdit(question.id)}
            >
              编辑题目
            </button>
          </div>
        </div>
      </header>
      <QuestionRegionCard
        documentId={question.documentId}
        title={question.title}
        regions={question.regions}
        deferImages={deferImages}
      />
      <QuestionAiAnalysis question={question} regions={question.regions} />
      <div
        className="paper-result-buttons"
        role="group"
        aria-label={`第 ${paperIndex + 1} 题结果`}
      >
        {(["correct", "uncertain", "incorrect"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={
              result === option
                ? `paper-result-${option} paper-result-active`
                : `paper-result-${option}`
            }
            aria-pressed={result === option}
            onClick={() => onResult(question.id, option)}
          >
            {attemptLabel(option)}
          </button>
        ))}
      </div>
    </article>
  );
}
