import type { Agent } from "../agent/types.js";
import type { HiBossDatabase } from "../daemon/db/database.js";

export function validateDirectChatTarget(db: HiBossDatabase, agent: Agent): string | null {
  if (agent.role !== "speaker") {
    return "Direct chat is only available for speaker agents";
  }

  const project = db.getProjectBySpeakerAgent(agent.name);
  if (project) {
    return `Speaker '${agent.name}' is bound to project '${project.id}'. Use project chat instead.`;
  }

  return null;
}
