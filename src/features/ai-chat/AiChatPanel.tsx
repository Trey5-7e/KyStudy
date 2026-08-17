import { useState } from "react";

import { consumePendingAiChatContext } from "./aiChatContext";
import { PlanningChatPanel } from "../planning/PlanningChatPanel";

export interface AiChatPanelProps {
  onOpenReference(documentId: string, page: number): void;
}

export function AiChatPanel({ onOpenReference }: AiChatPanelProps) {
  const [questionContext] = useState(consumePendingAiChatContext);
  return (
    <PlanningChatPanel
      standalone
      initialQuestionContext={questionContext}
      onOpenReference={onOpenReference}
      onDraftCreated={async () => undefined}
    />
  );
}
