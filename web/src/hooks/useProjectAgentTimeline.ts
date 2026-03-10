import { useEffect, useRef, useState } from "react";
import type {
  ProjectAgentRuntimeSnapshot,
  ProjectAgentTimelineEvent,
} from "@/components/project/project-agent-types";

export function useProjectAgentTimeline(
  agentNames: string[],
  statusByName: Record<string, ProjectAgentRuntimeSnapshot | undefined>,
  maxEvents = 40
): ProjectAgentTimelineEvent[] {
  const [events, setEvents] = useState<ProjectAgentTimelineEvent[]>([]);
  const previousRef = useRef<Record<string, ProjectAgentRuntimeSnapshot | undefined>>({});
  const initializedRef = useRef(false);

  useEffect(() => {
    if (agentNames.length === 0) {
      previousRef.current = {};
      setEvents([]);
      initializedRef.current = false;
      return;
    }

    const nextPrevious: Record<string, ProjectAgentRuntimeSnapshot | undefined> = {};
    const baselineEvents: ProjectAgentTimelineEvent[] = [];
    const deltaEvents: ProjectAgentTimelineEvent[] = [];

    for (const agentName of agentNames) {
      const current = statusByName[agentName];
      const previous = previousRef.current[agentName];
      nextPrevious[agentName] = current;

      if (!current) continue;

      if (!previous) {
        baselineEvents.push({
          id: `${agentName}-${Date.now()}-observed`,
          agentName,
          kind: "observed",
          after: `${current.state} / ${current.health}`,
          at: Date.now(),
        });
        continue;
      }

      if (previous.state !== current.state) {
        deltaEvents.push({
          id: `${agentName}-${Date.now()}-state`,
          agentName,
          kind: "state",
          before: previous.state,
          after: current.state,
          at: Date.now(),
        });
      }

      if (previous.health !== current.health) {
        deltaEvents.push({
          id: `${agentName}-${Date.now()}-health`,
          agentName,
          kind: "health",
          before: previous.health,
          after: current.health,
          at: Date.now(),
        });
      }

      if ((previous.pendingCount === 0) !== (current.pendingCount === 0)) {
        deltaEvents.push({
          id: `${agentName}-${Date.now()}-pending`,
          agentName,
          kind: "pending",
          before: String(previous.pendingCount),
          after: String(current.pendingCount),
          at: Date.now(),
        });
      }

      if (previous.sessionTarget !== current.sessionTarget && current.sessionTarget) {
        deltaEvents.push({
          id: `${agentName}-${Date.now()}-session`,
          agentName,
          kind: "session",
          before: previous.sessionTarget ?? "none",
          after: current.sessionTarget,
          at: Date.now(),
        });
      }
    }

    previousRef.current = nextPrevious;

    if (!initializedRef.current) {
      initializedRef.current = true;
      setEvents(baselineEvents.slice(0, maxEvents));
      return;
    }

    if (deltaEvents.length > 0) {
      setEvents((previous) => [...deltaEvents.reverse(), ...previous].slice(0, maxEvents));
    }
  }, [agentNames, maxEvents, statusByName]);

  return events;
}
