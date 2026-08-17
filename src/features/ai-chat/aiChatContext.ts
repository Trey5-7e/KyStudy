import type { PlanningQuestionContext } from "../../shared/tauri/planningChatClient";

export const AI_CHAT_OPEN_EVENT = "kystudy:open-ai-chat";

let pendingContext: PlanningQuestionContext | undefined;

export function requestAiChat(context?: PlanningQuestionContext): void {
  pendingContext = context;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AI_CHAT_OPEN_EVENT));
  }
}

export function consumePendingAiChatContext():
  PlanningQuestionContext | undefined {
  const current = pendingContext;
  pendingContext = undefined;
  return current;
}
