export const PROJECT_TASK_STATES = [
  "created",
  "planning",
  "dispatched",
  "executing",
  "completed",
  "cancelled",
] as const;

export type ProjectTaskState = (typeof PROJECT_TASK_STATES)[number];

export const PROJECT_TASK_PRIORITIES = ["low", "normal", "high", "critical"] as const;

export type ProjectTaskPriority = (typeof PROJECT_TASK_PRIORITIES)[number];

export interface ProjectTaskFlowEntry {
  fromState?: ProjectTaskState;
  toState: ProjectTaskState;
  actor?: string;
  reason?: string;
  at: number;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  state: ProjectTaskState;
  priority: ProjectTaskPriority;
  assignee?: string;
  output?: string;
  flowLog: ProjectTaskFlowEntry[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TaskProgress {
  id: string;
  taskId: string;
  agentName: string;
  content: string;
  todos?: string[];
  createdAt: number;
}

const PROJECT_TASK_ALLOWED_TRANSITIONS: Record<ProjectTaskState, readonly ProjectTaskState[]> = {
  created: ["planning", "cancelled"],
  planning: ["dispatched", "cancelled"],
  dispatched: ["executing", "cancelled"],
  executing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isProjectTaskState(value: string): value is ProjectTaskState {
  return PROJECT_TASK_STATES.includes(value as ProjectTaskState);
}

export function isProjectTaskPriority(value: string): value is ProjectTaskPriority {
  return PROJECT_TASK_PRIORITIES.includes(value as ProjectTaskPriority);
}

export function canTransitionProjectTaskState(
  from: ProjectTaskState,
  to: ProjectTaskState
): boolean {
  if (from === to) return true;
  return PROJECT_TASK_ALLOWED_TRANSITIONS[from].includes(to);
}
