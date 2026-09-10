/** M1 lifecycle DTOs; get/list-events/cancel are registered, with no Agent UI yet. */
export type AgentRunState =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "waiting_for_handoff"
  | "interrupted"
  | "completed"
  | "failed"
  | "canceled";

export interface AgentBudget {
  models: number;
  tools: number;
  input: number;
  output: number;
  activeMs: number;
}

export type AgentTokenPolicy = "observe" | "warn" | "enforce";
export const DEFAULT_AGENT_TOKEN_POLICY: AgentTokenPolicy = "observe";

export interface AgentRunSnapshot {
  id: string;
  state: AgentRunState;
  revision: number;
  ownerEpoch: number;
  limit: AgentBudget;
  tokenPolicy: AgentTokenPolicy;
  used: AgentBudget;
  eventSequence: number;
  cancelRequested: boolean;
  errorCode: string | null;
}

export interface AgentEvent {
  sequence: number;
  kind: string;
  payload: string;
}

/** Host-created authorization snapshot, not a model tool argument. */
export interface AgentGrant {
  providerId: string;
  providerRevision: string;
  model: string;
  pages: Array<{ documentId: string; revision: string; pages: number[] }>;
}

/** Zero token thresholds are unset; loop/time protection remains independent. */
export const DEFAULT_AGENT_BUDGET: Readonly<AgentBudget> = Object.freeze({
  models: 6,
  tools: 8,
  input: 0,
  output: 0,
  activeMs: 180_000,
});

export function isAgentTerminal(state: AgentRunState): boolean {
  return state === "completed" || state === "failed" || state === "canceled";
}

export function hasAgentTokenWarning(
  run: Pick<AgentRunSnapshot, "tokenPolicy" | "limit" | "used">,
): boolean {
  return (
    run.tokenPolicy === "warn" &&
    (run.used.input >= run.limit.input || run.used.output >= run.limit.output)
  );
}
