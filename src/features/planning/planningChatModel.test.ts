import { describe, expect, it } from "vitest";

import {
  buildPlanningChatRequest,
  confirmedPromptMatches,
  isCurrentPlanningRequest,
  planningPreviewFingerprint,
  togglePlanningContext,
} from "./planningChatModel";
import type { PlanningChatPreview } from "../../shared/tauri/planningChatClient";

const result = (pageNumber: number) => ({
  documentId: `doc-${pageNumber}`,
  documentTitle: `资料 ${pageNumber}`,
  documentKind: "pdf" as const,
  pageNumber,
  excerpt: `片段 ${pageNumber}`,
  matchKind: "page_text" as const,
});

describe("planning chat model", () => {
  it("caps selected contexts at six and allows removal", () => {
    let selected = Array.from({ length: 6 }, (_, index) =>
      togglePlanningContext([], result(index + 1), "query"),
    ).flat();
    expect(selected).toHaveLength(6);
    selected = togglePlanningContext(selected, result(7), "query");
    expect(selected).toHaveLength(6);
    selected = togglePlanningContext(selected, result(3), "query");
    expect(selected).toHaveLength(5);
  });

  it("resets request state when conversation selection changes", () => {
    expect(buildPlanningChatRequest(undefined, "q", [], "800")).toBeUndefined();
    expect(
      buildPlanningChatRequest("conversation", "q", [], "800"),
    )?.toMatchObject({
      conversationId: "conversation",
      question: "q",
      maxOutputTokens: 800,
    });
  });

  it("rejects empty questions and invalid token limits before invoking AI", () => {
    expect(
      buildPlanningChatRequest("conversation", "  ", [], "800"),
    ).toBeUndefined();
    expect(
      buildPlanningChatRequest("conversation", "question", [], "0"),
    ).toBeUndefined();
    expect(
      buildPlanningChatRequest("conversation", "question", [], "1801"),
    ).toBeUndefined();
    expect(
      buildPlanningChatRequest("conversation", "  question  ", [], "800")
        ?.question,
    ).toBe("question");
  });

  it("keeps question context bounded and part of the request", () => {
    const request = buildPlanningChatRequest(
      "conversation",
      "question",
      [],
      "800",
      {
        title: "题目标题",
        documentTitle: "资料.pdf",
        analysis: "当前解析",
        imageDataUrls: ["data:image/png;base64,AAA"],
      },
    );
    expect(request?.questionContext?.title).toBe("题目标题");
    expect(
      buildPlanningChatRequest("conversation", "question", [], "800", {
        title: "题目标题",
        documentTitle: "资料.pdf",
        imageDataUrls: Array.from(
          { length: 7 },
          () => "data:image/png;base64,AAA",
        ),
      }),
    ).toBeUndefined();
  });

  it("fingerprints the displayed preview and requires its exact prompt", () => {
    const request = buildPlanningChatRequest("conversation", "q", [], "800");
    const preview = {
      preview: {
        destination: "offline",
        prompt: "完整外发文本",
        providerName: "Offline",
        providerType: "offline_test",
        modelName: "offline-model",
        projectedTokens: 12,
        allowed: true,
      },
      sources: [],
    } as unknown as PlanningChatPreview;
    expect(planningPreviewFingerprint(request!, preview)).toContain(
      "完整外发文本",
    );
    expect(confirmedPromptMatches(preview, "完整外发文本")).toBe(true);
    expect(confirmedPromptMatches(preview, "篡改文本")).toBe(false);
    expect(
      planningPreviewFingerprint(request!, {
        ...preview,
        preview: { ...preview.preview, modelName: "changed-model" },
      }),
    ).not.toBe(planningPreviewFingerprint(request!, preview));
  });

  it("rejects stale responses", () => {
    expect(isCurrentPlanningRequest(2, 1)).toBe(false);
    expect(isCurrentPlanningRequest(2, 2)).toBe(true);
    expect(isCurrentPlanningRequest(2, 2, false)).toBe(false);
  });
});
