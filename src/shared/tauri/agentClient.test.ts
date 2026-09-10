import { describe, it, expect } from "vitest";
import { parseAgentRun, parseAgentDetail, agentErrorText } from "./agentClient";
import { DEFAULT_AGENT_BUDGET } from "./agentContract";
const run = {
  id: "run",
  state: "running",
  revision: 1,
  ownerEpoch: 1,
  limit: DEFAULT_AGENT_BUDGET,
  used: DEFAULT_AGENT_BUDGET,
  eventSequence: 1,
  cancelRequested: false,
  errorCode: null,
  tokenPolicy: "observe",
};
describe("Agent lifecycle response boundary", () => {
  it("parses a current snapshot without inventing a threshold", () =>
    expect(parseAgentRun(run).tokenPolicy).toBe("observe"));
  it.each([
    { ...run, state: "secret_state" },
    { ...run, used: { ...DEFAULT_AGENT_BUDGET, input: -1 } },
    { ...run, tokenPolicy: "auto_enforce" },
  ])("rejects malformed snapshots", (value) =>
    expect(() => parseAgentRun(value)).toThrow("AGENT_RESPONSE_INVALID"),
  );
  it("only carries public fields into visible results", () => {
    const detail = parseAgentDetail({
      run,
      goal: "q",
      grant: {
        providerId: "provider",
        providerRevision: "v1",
        model: "model",
        pages: [],
      },
      results: [
        {
          kind: "final",
          message: "answer",
          source_ids: [],
          reasoning_content: "private-test-field",
        },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("private-test-field");
  });
  it("rejects nonpublic result kinds", () =>
    expect(() =>
      parseAgentDetail({
        run,
        goal: "q",
        grant: {
          providerId: "p",
          providerRevision: "v",
          model: "m",
          pages: [],
        },
        results: [{ kind: "reasoning", text: "private" }],
      }),
    ).toThrow());
  it("does not show arbitrary provider error text", () =>
    expect(
      agentErrorText({ code: "UNKNOWN", message: "api-key-secret" }),
    ).not.toContain("api-key-secret"));
});
