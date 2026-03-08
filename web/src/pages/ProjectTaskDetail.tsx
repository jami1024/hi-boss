import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  type ProjectTask,
  type ProjectTaskProgress,
  type ProjectTaskState,
  type ProjectSummary,
} from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ActivityItem = {
  id: string;
  kind: "flow" | "progress" | "envelope";
  at: number;
  title: string;
  detail: string;
};

const TASK_STATES: ProjectTaskState[] = [
  "created",
  "planning",
  "dispatched",
  "executing",
  "completed",
  "cancelled",
];

function formatTime(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function ProjectTaskDetailPage() {
  const { id, taskId } = useParams<{ id: string; taskId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [progress, setProgress] = useState<ProjectTaskProgress[]>([]);
  const [envelopes, setEnvelopes] = useState<Array<{ id: string; from: string; to: string; text: string; status: string; createdAt: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingState, setSavingState] = useState(false);
  const [cancellingTask, setCancellingTask] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);

  const [nextState, setNextState] = useState<ProjectTaskState>("planning");
  const [assignee, setAssignee] = useState("");
  const [dispatchText, setDispatchText] = useState("");
  const [reason, setReason] = useState("");
  const [output, setOutput] = useState("");

  const [progressAgent, setProgressAgent] = useState("");
  const [progressContent, setProgressContent] = useState("");
  const [progressTodos, setProgressTodos] = useState("");

  const load = useCallback(async () => {
    if (!id || !taskId) return;
    try {
      setLoading(true);
      setError("");
      const [{ project: nextProject }, detail] = await Promise.all([
        api.getProject(id),
        api.getProjectTask(id, taskId),
      ]);
      setProject(nextProject);
      setTask(detail.task);
      setProgress(detail.progress);
      setEnvelopes(detail.envelopes);
      setNextState(detail.task.state);
      setAssignee(detail.task.assignee ?? "");
      setOutput(detail.task.output ?? "");
      setProgressAgent(detail.task.assignee ?? nextProject.speakerAgent);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activities = useMemo<ActivityItem[]>(() => {
    if (!task) return [];
    const flowItems: ActivityItem[] = task.flowLog.map((entry, index) => ({
      id: `flow-${index}-${entry.at}`,
      kind: "flow",
      at: entry.at,
      title: `State: ${entry.toState}`,
      detail: [entry.fromState ? `from ${entry.fromState}` : "initial", entry.actor ? `actor ${entry.actor}` : "", entry.reason ? `reason ${entry.reason}` : ""]
        .filter(Boolean)
        .join(" · "),
    }));
    const progressItems: ActivityItem[] = progress.map((entry) => ({
      id: `progress-${entry.id}`,
      kind: "progress",
      at: entry.createdAt,
      title: `Progress by ${entry.agentName}`,
      detail:
        entry.todos && entry.todos.length > 0
          ? `${entry.content} · todos: ${entry.todos.join(" | ")}`
          : entry.content,
    }));
    const envelopeItems: ActivityItem[] = envelopes.map((entry) => ({
      id: `envelope-${entry.id}`,
      kind: "envelope",
      at: entry.createdAt,
      title: `Envelope ${entry.from} → ${entry.to}`,
      detail: `${entry.text} · status ${entry.status}`,
    }));
    return [...flowItems, ...progressItems, ...envelopeItems].sort((a, b) => a.at - b.at);
  }, [task, progress, envelopes]);

  const activeLeaders = useMemo(
    () => (project?.leaders ?? []).filter((leader) => leader.active).map((leader) => leader.agentName),
    [project]
  );

  const handleUpdateState = async () => {
    if (!id || !taskId) return;
    setSavingState(true);
    setError("");
    try {
      await api.updateProjectTaskState(id, taskId, {
        state: nextState,
        assignee: assignee.trim() || undefined,
        ...(nextState === "dispatched" && dispatchText.trim() ? { dispatchText: dispatchText.trim() } : {}),
        reason: reason.trim() || undefined,
        output: output.trim() || undefined,
      });
      setReason("");
      setDispatchText("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingState(false);
    }
  };

  const handleAppendProgress = async () => {
    if (!id || !taskId || !progressAgent.trim() || !progressContent.trim()) return;
    setSavingProgress(true);
    setError("");
    try {
      const todos = progressTodos
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      await api.appendProjectTaskProgress(id, taskId, {
        agentName: progressAgent.trim(),
        content: progressContent.trim(),
        ...(todos.length > 0 ? { todos } : {}),
      });
      setProgressContent("");
      setProgressTodos("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingProgress(false);
    }
  };

  const handleCancelTask = async (force: boolean) => {
    if (!id || !taskId) return;
    setCancellingTask(true);
    setError("");
    try {
      await api.cancelProjectTask(id, taskId, {
        force,
        reason: force ? "force-cancel-from-task-detail" : "cancel-from-task-detail",
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingTask(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading task details...</div>;
  }

  if (error && !task) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">Error: {error}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    );
  }

  if (!task || !id) {
    return <div className="p-6 text-sm text-muted-foreground">Task not found.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${encodeURIComponent(id)}/tasks`)}>
            &larr; Tasks
          </Button>
          <h1 className="text-2xl font-bold truncate">{task.title}</h1>
          <Badge variant="outline" className="font-mono text-xs">
            {task.id}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {task.state}
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>Project: {project?.name ?? task.projectId}</div>
          <div>Priority: {task.priority}</div>
          <div>Assignee: {task.assignee ?? "—"}</div>
          <div>Output: {task.output ?? "—"}</div>
          <div>Created: {formatTime(task.createdAt)}</div>
          <div>Updated: {formatTime(task.updatedAt)}</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update State</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="nextState">State</Label>
              <Select value={nextState} onValueChange={(value) => setNextState(value as ProjectTaskState)}>
                <SelectTrigger id="nextState">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignee">Assignee</Label>
              <Input
                id="assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                list="task-assignee-options"
                placeholder={activeLeaders.length > 0 ? "choose active leader" : "leader agent name"}
              />
              {activeLeaders.length > 0 && (
                <>
                  <datalist id="task-assignee-options">
                    {activeLeaders.map((leader) => (
                      <option key={leader} value={leader} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    Active leaders: {activeLeaders.join(", ")}
                  </p>
                </>
              )}
            </div>
            {nextState === "dispatched" && (
              <div className="space-y-2">
                <Label htmlFor="dispatchText">Dispatch Text (optional)</Label>
                <Textarea
                  id="dispatchText"
                  value={dispatchText}
                  onChange={(e) => setDispatchText(e.target.value)}
                  placeholder="task summary for the assignee"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  If empty, the default dispatch template is used.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="why this transition"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="output">Output</Label>
              <Input
                id="output"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="summary or path"
              />
            </div>
            <Button onClick={handleUpdateState} disabled={savingState || (nextState === "dispatched" && !assignee.trim())}>
              {savingState ? "Saving..." : "Apply State"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void handleCancelTask(false)}
                disabled={cancellingTask || task.state === "completed" || task.state === "cancelled"}
              >
                {cancellingTask ? "Cancelling..." : "Cancel Task"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleCancelTask(true)}
                disabled={cancellingTask || !task.assignee || task.state === "completed" || task.state === "cancelled"}
              >
                {cancellingTask ? "Stopping..." : "Force Stop Agent"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Append Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="progressAgent">Agent</Label>
              <Input
                id="progressAgent"
                value={progressAgent}
                onChange={(e) => setProgressAgent(e.target.value)}
                placeholder="agent name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="progressContent">Progress</Label>
              <Input
                id="progressContent"
                value={progressContent}
                onChange={(e) => setProgressContent(e.target.value)}
                placeholder="current progress"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="progressTodos">Todos (optional, split by ; or ,)</Label>
              <Input
                id="progressTodos"
                value={progressTodos}
                onChange={(e) => setProgressTodos(e.target.value)}
                placeholder="step A done; step B doing"
              />
            </div>
            <Button onClick={handleAppendProgress} disabled={savingProgress || !progressContent.trim()}>
              {savingProgress ? "Appending..." : "Append Progress"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unified Activity Stream</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activities.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          )}
          {activities.map((item) => (
            <div key={item.id} className="border rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {item.kind}
                </Badge>
                <span className="font-medium text-sm">{item.title}</span>
                <span className="text-xs text-muted-foreground">{formatTime(item.at)}</span>
              </div>
              <p className="text-sm text-muted-foreground break-words">{item.detail}</p>
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
