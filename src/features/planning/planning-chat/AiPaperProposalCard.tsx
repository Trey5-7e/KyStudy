import { useState } from "react";

import type { IndexedQuestion } from "../../../shared/tauri/questionBankClient";
import type { ResolvedAiPaperProposal } from "./aiPaperProposalModel";

interface AiPaperProposalCardProps {
  proposal: ResolvedAiPaperProposal;
  onStartPaper?(questions: IndexedQuestion[], title?: string): void;
  onExportPaper?(questions: IndexedQuestion[], title?: string): void;
}

export function AiPaperProposalCard({
  proposal,
  onStartPaper,
  onExportPaper,
}: AiPaperProposalCardProps) {
  const [listOpen, setListOpen] = useState(false);

  const typeSummaryParts: string[] = [];
  if (proposal.choiceCount > 0)
    typeSummaryParts.push(`选择题 ${proposal.choiceCount} 题`);
  if (proposal.blankCount > 0)
    typeSummaryParts.push(`填空题 ${proposal.blankCount} 题`);
  if (proposal.solutionCount > 0)
    typeSummaryParts.push(`解答题 ${proposal.solutionCount} 题`);
  if (proposal.otherCount > 0)
    typeSummaryParts.push(`其他题型 ${proposal.otherCount} 题`);

  const handleStart = () => {
    if (onStartPaper && proposal.questions.length > 0) {
      onStartPaper(proposal.questions, proposal.title);
    }
  };

  const handleExport = () => {
    if (onExportPaper && proposal.questions.length > 0) {
      onExportPaper(proposal.questions, proposal.title);
    }
  };

  return (
    <div className="ai-paper-proposal-card" aria-label="AI 智能组卷方案">
      <div className="ai-paper-proposal-header">
        <div className="ai-paper-proposal-badge">
          <span className="material-symbols-rounded" aria-hidden="true">
            auto_awesome
          </span>
          <span>AI 推荐套卷</span>
        </div>
        <span className="ai-paper-proposal-count">
          共 {proposal.totalCount} 道题目
        </span>
      </div>

      <h4 className="ai-paper-proposal-title">{proposal.title}</h4>
      {proposal.description ? (
        <p className="ai-paper-proposal-desc">{proposal.description}</p>
      ) : null}

      <div className="ai-paper-proposal-stats">
        {typeSummaryParts.map((part, idx) => (
          <span key={idx} className="ai-paper-stat-chip">
            {part}
          </span>
        ))}
      </div>

      <details
        className="ai-paper-proposal-details"
        open={listOpen}
        onToggle={(e) => setListOpen(e.currentTarget.open)}
      >
        <summary className="ai-paper-proposal-details-summary">
          <span>{listOpen ? "收起题目清单" : "查看题目清单"}</span>
          <span className="material-symbols-rounded" aria-hidden="true">
            {listOpen ? "expand_less" : "expand_more"}
          </span>
        </summary>
        <ul className="ai-paper-proposal-question-list">
          {proposal.questions.map((question, index) => (
            <li key={question.id} className="ai-paper-proposal-question-item">
              <span className="ai-paper-question-index">{index + 1}.</span>
              <div className="ai-paper-question-info">
                <span className="ai-paper-question-meta">
                  {question.subjectName} · {question.chapter} ·{" "}
                  {question.questionType === "choice"
                    ? "单选题"
                    : question.questionType === "blank"
                      ? "填空题"
                      : question.questionType === "solution"
                        ? "解答题"
                        : "题目"}{" "}
                  (第 {question.questionNumber} 题)
                </span>
                <strong className="ai-paper-question-title">
                  {question.title || "题目"}
                </strong>
              </div>
            </li>
          ))}
        </ul>
      </details>

      <div className="ai-paper-proposal-actions">
        <button
          type="button"
          className="ai-paper-action-start"
          onClick={handleStart}
          disabled={proposal.questions.length === 0}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            play_arrow
          </span>
          <span>立即开始模考练习</span>
        </button>
        {onExportPaper ? (
          <button
            type="button"
            className="ai-paper-action-export"
            onClick={handleExport}
            disabled={proposal.questions.length === 0}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              print
            </span>
            <span>导出试卷 PDF</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
