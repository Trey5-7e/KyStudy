import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useCallback, type ReactNode } from "react";

import type {
  PlanningConversation,
  PlanningMessage,
} from "../../../shared/tauri/planningChatClient";

interface AssistantChatRuntimeProps {
  conversation?: PlanningConversation;
  busy: boolean;
  onPrepare(question: string): void;
  onCancel(): void;
  children: ReactNode;
}

/**
 * Bridges KyStudy's persisted conversation shape into assistant-ui's
 * headless runtime. The runtime owns keyboard/scroll/send state only; all
 * persistence and the mode-specific send contract stay in PlanningChatPanel.
 */
export function AssistantChatRuntime({
  conversation,
  busy,
  onPrepare,
  onCancel,
  children,
}: AssistantChatRuntimeProps) {
  const messages = conversation?.messages ?? [];
  const convertMessage = useCallback(
    (message: PlanningMessage): ThreadMessageLike => ({
      id: message.id,
      role: message.role,
      content: [{ type: "text", text: message.content }],
      createdAt: new Date(message.createdAt),
    }),
    [],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .map((part) =>
          part.type === "text" && typeof part.text === "string"
            ? part.text
            : "",
        )
        .join("")
        .trim();
      if (text !== "") onPrepare(text);
    },
    [onPrepare],
  );

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: busy,
    isSendDisabled: busy || conversation === undefined,
    onNew,
    onCancel: async () => onCancel(),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
