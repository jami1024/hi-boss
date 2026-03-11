/**
 * Agent health computation using a sliding-window approach.
 *
 * Instead of judging health by the single most-recent run, we look at the
 * last N finished runs and count consecutive failures from the most recent.
 *
 * Health levels:
 *   - "ok"       – most recent run succeeded (or cancelled)
 *   - "degraded" – 1–2 consecutive recent failures (yellow warning)
 *   - "error"    – 3+ consecutive recent failures (red alert)
 *   - "unknown"  – no finished runs, or health was manually reset
 */

export type AgentHealthLevel = "ok" | "degraded" | "error" | "unknown";

export interface AgentRunSlice {
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
}

/** How many consecutive failures before we escalate to "error". */
const FAILURE_THRESHOLD = 3;

/**
 * Compute agent health from recent finished runs.
 *
 * @param runs - Recent finished runs, ordered most-recent first.
 * @param healthResetAt - Optional timestamp; runs before this are ignored.
 */
export function computeAgentHealth(
  runs: AgentRunSlice[],
  healthResetAt?: number,
): AgentHealthLevel {
  const effective = healthResetAt
    ? runs.filter((r) => r.startedAt >= healthResetAt)
    : runs;

  if (effective.length === 0) return "unknown";

  let consecutiveFailures = 0;
  for (const run of effective) {
    if (run.status === "failed") {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  if (consecutiveFailures === 0) return "ok";
  if (consecutiveFailures < FAILURE_THRESHOLD) return "degraded";
  return "error";
}
