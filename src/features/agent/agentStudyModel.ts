import type { AgentRunState } from "../../shared/tauri/agentContract";
import type { AgentResult } from "../../shared/tauri/agentClient";

export function studyQuestion(goal: string): string {
  try {
    const value: unknown = JSON.parse(goal);
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "study_followup" &&
      "question" in value &&
      typeof value.question === "string"
    )
      return value.question;
  } catch {
    /* Plain goals remain compatible. */
  }
  return goal;
}

function sourceChunks(
  results: AgentResult[],
  sourceId: string,
): Record<string, unknown>[] {
  return results.flatMap((result) => {
    if (result.kind !== "tool_result" || result.source_id !== sourceId)
      return [];
    try {
      const chunk: unknown = JSON.parse(result.text);
      return chunk !== null &&
        typeof chunk === "object" &&
        !Array.isArray(chunk)
        ? [chunk as Record<string, unknown>]
        : [{ text: result.text }];
    } catch {
      return [{ text: result.text }];
    }
  });
}

export function studySourceText(
  results: AgentResult[],
  sourceId: string,
): string {
  return (
    [
      ...new Set(
        sourceChunks(results, sourceId)
          .map((c) => c.text)
          .filter((t): t is string => typeof t === "string"),
      ),
    ].join("\n\n—— 读取片段 ——\n\n") ||
    "本轮没有可展示的索引文字。请在资料库核对原始页面。"
  );
}

export function hasPartialStudySource(
  results: AgentResult[],
  sources: string[],
): boolean {
  return sources.some((source) => {
    const chunks = sourceChunks(results, source);
    const ranges = chunks.filter((c) =>
      [c.offset, c.endOffset, c.totalCharacters].every(
        (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
      ),
    );
    if (!ranges.length) return true;
    ranges.sort((a, b) => Number(a.offset) - Number(b.offset));
    let end = 0;
    const total = Number(ranges[0]?.totalCharacters);
    for (const range of ranges) {
      if (
        range.totalCharacters !== total ||
        Number(range.offset) > end ||
        Number(range.endOffset) < Number(range.offset) ||
        Number(range.endOffset) > total
      )
        return true;
      end = Math.max(end, Number(range.endOffset));
    }
    return end < total;
  });
}

export function parseStudyPages(input: string, maximum: number): number[] {
  const pages = new Set<number>();
  if (!input.trim() || input.length > 256) return [];
  for (const part of input.split(/[,，]/)) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) return [];
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      last < first ||
      last > maximum ||
      last - first >= 24
    )
      return [];
    for (let page = first; page <= last; page++) {
      pages.add(page);
      if (pages.size > 24) return [];
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export const AGENT_STATE_TEXT: Record<AgentRunState, string> = {
  queued: "等待开始",
  running: "正在研读",
  waiting_for_input: "等待补充问题",
  waiting_for_approval: "等待确认",
  waiting_for_handoff: "等待交接",
  interrupted: "运行已中断",
  completed: "研读完成",
  failed: "本轮未完成",
  canceled: "已取消",
};
export function isStudyActive(state: AgentRunState): boolean {
  return (
    state === "running" || state === "queued" || state === "waiting_for_handoff"
  );
}
