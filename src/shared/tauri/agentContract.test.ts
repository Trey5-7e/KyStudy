import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_BUDGET,
  DEFAULT_AGENT_TOKEN_POLICY,
  hasAgentTokenWarning,
  isAgentTerminal,
  type AgentRunState,
} from "./agentContract";

describe("Agent kernel DTO contract", () => {
  it("defaults to observation without a cumulative token threshold", () => {
    expect(DEFAULT_AGENT_TOKEN_POLICY).toBe("observe");
    expect(DEFAULT_AGENT_BUDGET).toEqual({
      models: 6,
      tools: 8,
      input: 0,
      output: 0,
      activeMs: 180000,
    });
    expect(Object.isFrozen(DEFAULT_AGENT_BUDGET)).toBe(true);
  });
  it("exposes warnings only when the user selected warning mode", () => {
    const limit = { ...DEFAULT_AGENT_BUDGET, input: 100, output: 20 };
    const used = { ...DEFAULT_AGENT_BUDGET, input: 101, output: 1 };
    expect(hasAgentTokenWarning({ tokenPolicy: "warn", limit, used })).toBe(
      true,
    );
    expect(hasAgentTokenWarning({ tokenPolicy: "observe", limit, used })).toBe(
      false,
    );
    expect(hasAgentTokenWarning({ tokenPolicy: "enforce", limit, used })).toBe(
      false,
    );
  });
  it("keeps interrupted and waiting runs nonterminal", () => {
    for (const state of [
      "queued",
      "running",
      "waiting_for_input",
      "waiting_for_approval",
      "waiting_for_handoff",
      "interrupted",
    ] satisfies AgentRunState[])
      expect(isAgentTerminal(state)).toBe(false);
    for (const state of [
      "completed",
      "failed",
      "canceled",
    ] satisfies AgentRunState[])
      expect(isAgentTerminal(state)).toBe(true);
  });
});
