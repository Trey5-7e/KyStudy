import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  AI_CHAT_OPEN_EVENT,
  consumePendingAiChatContext,
} from "./aiChatContext";
import { PlanningChatPanel } from "../planning/PlanningChatPanel";

export interface AiChatPanelProps {
  headerAction?: ReactNode;
  onOpenReference(documentId: string, page: number): void;
  onStartPaper?(questions: IndexedQuestion[], title?: string): void;
}

export function AiChatPanel({
  headerAction,
  onOpenReference,
  onStartPaper,
}: AiChatPanelProps) {
  const [questionContext, setQuestionContext] = useState(
    consumePendingAiChatContext,
  );
  const [contextVersion, setContextVersion] = useState(0);
  useEffect(() => {
    // The page can already be open when a question card requests a follow-up.
    // The planning panel consumes the latest context through its prop, so the
    // event must also update an already-mounted standalone chat.
    const handleOpenRequest = () => {
      setQuestionContext(consumePendingAiChatContext());
      setContextVersion((current) => current + 1);
    };
    window.addEventListener(AI_CHAT_OPEN_EVENT, handleOpenRequest);
    return () =>
      window.removeEventListener(AI_CHAT_OPEN_EVENT, handleOpenRequest);
  }, []);
  return (
    <PlanningChatPanel
      key={`standalone-ai-chat-${contextVersion}`}
      standalone
      conversationKind="chat"
      headerAction={headerAction}
      initialQuestionContext={questionContext}
      onOpenReference={onOpenReference}
      onStartPaper={onStartPaper}
      onDraftCreated={async () => undefined}
    />
  );
}
