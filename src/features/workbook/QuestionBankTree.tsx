import { useMemo, useState } from "react";

import {
  practiceStatus,
  type QuestionBankSnapshot,
  type WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import { groupQuestionBankSnapshot } from "./questionBankHomeModel";

export function QuestionBankTree({
  snapshot,
  onManageSegment,
}: {
  snapshot: QuestionBankSnapshot;
  onManageSegment(
    segment: WorkbookDocumentSegment,
    trigger: HTMLButtonElement,
  ): void;
}) {
  const subjects = useMemo(
    () => groupQuestionBankSnapshot(snapshot),
    [snapshot],
  );
  const segmentMeta = useMemo(() => {
    const questionCounts = new Map<string, number>();
    for (const question of snapshot.questions) {
      questionCounts.set(
        question.segmentId,
        (questionCounts.get(question.segmentId) ?? 0) + 1,
      );
    }
    return new Map(
      snapshot.segments.map((segment) => {
        const questionCount = questionCounts.get(segment.id) ?? 0;
        return [
          segment.id,
          {
            questionCount,
            visibility:
              segment.indexState === "pending" || questionCount === 0
                ? ("pending" as const)
                : ("browsable" as const),
          },
        ];
      }),
    );
  }, [snapshot.questions, snapshot.segments]);
  const [expandedSubjectIds, setExpandedSubjectIds] = useState<Set<string>>(
    () => new Set(subjects[0] === undefined ? [] : [subjects[0].subjectId]),
  );
  const effectiveExpandedSubjectIds = useMemo(() => {
    const validIds = new Set(subjects.map((subject) => subject.subjectId));
    const next = new Set(
      [...expandedSubjectIds].filter((subjectId) => validIds.has(subjectId)),
    );
    if (next.size === 0 && subjects[0] !== undefined) {
      next.add(subjects[0].subjectId);
    }
    return next;
  }, [expandedSubjectIds, subjects]);

  return (
    <div className="question-bank-tree">
      {subjects.map((subject) => {
        const pendingSegments = subject.segments.filter(
          (segment) => segmentMeta.get(segment.id)?.visibility === "pending",
        ).length;
        const needsReviewSegments = subject.segments.filter(
          (segment) =>
            segment.indexState === "needs_review" &&
            segmentMeta.get(segment.id)?.visibility !== "pending",
        ).length;
        return (
          <section
            key={subject.subjectId}
            className="question-bank-subject"
            aria-labelledby={`question-bank-subject-${subject.subjectId}`}
          >
            <details
              className="question-bank-subject-disclosure"
              open={effectiveExpandedSubjectIds.has(subject.subjectId)}
              onToggle={(event) => {
                const nextOpen = event.currentTarget.open;
                setExpandedSubjectIds((current) => {
                  const next = new Set(current);
                  if (nextOpen) next.add(subject.subjectId);
                  else next.delete(subject.subjectId);
                  return next;
                });
              }}
            >
              <summary className="question-bank-subject-summary">
                <div>
                  <span
                    className="question-bank-root-mark"
                    aria-hidden="true"
                  />
                  <h3 id={`question-bank-subject-${subject.subjectId}`}>
                    <span className="question-bank-subject-name">
                      {subject.subjectName}
                    </span>
                  </h3>
                </div>
                <span>
                  {subject.workbooks.length} 本 · {subject.questions.length} 道
                  {pendingSegments === 0 ? "" : ` · ${pendingSegments} 待建立`}
                  {needsReviewSegments === 0
                    ? ""
                    : ` · ${needsReviewSegments} 待校对`}
                </span>
              </summary>
              <div className="question-bank-workbooks">
                {subject.workbooks.map((workbook) => {
                  const segments = workbook.segments;
                  const questions = workbook.questions;
                  const completed = questions.filter(
                    (value) => practiceStatus(value) !== "unattempted",
                  ).length;
                  const percent =
                    questions.length === 0
                      ? 0
                      : Math.round((completed / questions.length) * 100);
                  const pendingWorkbookSegments = segments.filter(
                    (item) =>
                      segmentMeta.get(item.id)?.visibility === "pending",
                  ).length;
                  const needsReviewWorkbookSegments = segments.filter(
                    (item) =>
                      item.indexState === "needs_review" &&
                      segmentMeta.get(item.id)?.visibility !== "pending",
                  ).length;
                  return (
                    <article
                      key={workbook.workbookId}
                      className="question-bank-workbook-card"
                    >
                      <header className="question-bank-workbook-title">
                        <div>
                          <span>练习册</span>
                          <h4 className="question-bank-workbook-name">
                            {workbook.workbookName}
                          </h4>
                        </div>
                        <span>
                          {completed}/{questions.length} 已做
                        </span>
                      </header>
                      <div
                        className="question-bank-progress"
                        role="progressbar"
                        aria-label={`${workbook.workbookName}完成进度`}
                        aria-valuetext={
                          questions.length === 0
                            ? "暂无已索引题目"
                            : `${completed} / ${questions.length} 道题已做`
                        }
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <details className="question-bank-segment-disclosure">
                        <summary>
                          分段 {segments.length} 个
                          {pendingWorkbookSegments === 0
                            ? ""
                            : ` · ${pendingWorkbookSegments} 个待建立`}
                          {needsReviewWorkbookSegments === 0
                            ? ""
                            : ` · ${needsReviewWorkbookSegments} 个待校对`}
                        </summary>
                        <div className="question-bank-segment-list">
                          {segments.map((segment) => {
                            const metadata = segmentMeta.get(segment.id);
                            const segmentQuestionCount =
                              metadata?.questionCount ?? 0;
                            const visibility =
                              metadata?.visibility ?? "pending";
                            return (
                              <div
                                key={segment.id}
                                className="question-bank-segment"
                                data-question-segment-visibility={visibility}
                                data-question-count={segmentQuestionCount}
                              >
                                <div className="question-bank-segment-copy">
                                  <span className="question-bank-segment-title">
                                    {segment.sourceHeading}
                                  </span>
                                  <small>
                                    PDF 第 {segment.pageStart}～
                                    {segment.pageEnd} 页 ·{" "}
                                    {segmentQuestionCount} 道 ·{" "}
                                    {visibility === "pending"
                                      ? "待建立"
                                      : indexStateLabel(segment.indexState)}
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  className="secondary-button question-bank-segment-manage"
                                  aria-label={`管理分段：${segment.subjectName} / ${segment.workbookName} / ${segment.sourceHeading}，PDF 第 ${segment.pageStart}-${segment.pageEnd} 页`}
                                  onClick={(event) =>
                                    onManageSegment(
                                      segment,
                                      event.currentTarget,
                                    )
                                  }
                                >
                                  管理
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}

function indexStateLabel(value: string): string {
  return (
    { pending: "待建立", ready: "索引完成", needs_review: "有少量待校对" }[
      value
    ] ?? value
  );
}
