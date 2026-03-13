import type { Agent } from "../agent/types.js";
import type { HiBossDatabase } from "../daemon/db/database.js";

/**
 * Direct (non-project) chat with any agent is disabled.
 * All agent communication must go through project chat.
 */
export function validateDirectChatTarget(_db: HiBossDatabase, agent: Agent): string | null {
  return `Direct chat with '${agent.name}' is not allowed. Please use project chat instead.`;
}
