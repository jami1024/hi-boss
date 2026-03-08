import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ProjectTask, type ProjectTaskPriority, type ProjectSummary } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function formatTime(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

const PRIORITY_OPTIONS: ProjectTaskPriority[] = ["low", "normal", "high", "critical"];

export function ProjectTasksPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<ProjectTaskPriority>("normal");

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks]
  );

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError("");
      const [{ project: nextProject }, { tasks: nextTasks }] = await Promise.all([
        api.getProject(id),
        api.listProjectTasks(id, { limit: 200 }),
      ]);
      setProject(nextProject);
      setTasks(nextTasks);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateTask = async () => {
    if (!id || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api.createProjectTask(id, {
        title: title.trim(),
        text: text.trim() || undefined,
        priority,
        autoDispatch: true,
      });
      setTitle("");
      setText("");
      setPriority("normal");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading project tasks...</div>;
  }

  if (error && !project) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">Error: {error}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${encodeURIComponent(id ?? "")}`)}>
            &larr; Project
          </Button>
          <h1 className="text-2xl font-bold">{project?.name ?? id} Tasks</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Task</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="taskTitle">Title</Label>
              <Input
                id="taskTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What should be done?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taskPriority">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as ProjectTaskPriority)}>
                <SelectTrigger id="taskPriority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="taskText">Initial Brief (optional)</Label>
              <Input
                id="taskText"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Extra context for speaker auto-dispatch"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleCreateTask} disabled={saving || !title.trim()}>
              {saving ? "Creating..." : "Create & Dispatch"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          )}
          {sortedTasks.map((task) => (
            <div
              key={task.id}
              className="border rounded-lg p-3 flex items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{task.title}</span>
                  <Badge variant="outline" className="text-xs font-mono">
                    {task.id}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {task.state}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {task.priority}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Assignee: {task.assignee ?? "—"} · Updated: {formatTime(task.updatedAt)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/projects/${encodeURIComponent(id ?? "")}/tasks/${encodeURIComponent(task.id)}`)}
              >
                Activity
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
