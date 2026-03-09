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

function stateLabel(state: ProjectTaskState): string {
  if (state === "created") return "已创建";
  if (state === "planning") return "规划中";
  if (state === "dispatched") return "已分派";
  if (state === "executing") return "执行中";
  if (state === "completed") return "已完成";
  return "已取消";
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function envelopeStatusLabel(status: string): string {
  if (status === "pending") return "待处理";
  if (status === "done") return "已完成";
  return status;
}

function activityKindLabel(kind: ActivityItem["kind"]): string {
  if (kind === "flow") return "流转";
  if (kind === "progress") return "进度";
  return "信封";
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
      title: `状态：${stateLabel(entry.toState)}`,
      detail: [entry.fromState ? `从 ${stateLabel(entry.fromState)}` : "初始状态", entry.actor ? `执行者 ${entry.actor}` : "", entry.reason ? `原因 ${entry.reason}` : ""]
        .filter(Boolean)
        .join(" · "),
    }));
    const progressItems: ActivityItem[] = progress.map((entry) => ({
      id: `progress-${entry.id}`,
      kind: "progress",
      at: entry.createdAt,
      title: `${entry.agentName} 的进度更新`,
      detail:
        entry.todos && entry.todos.length > 0
          ? `${entry.content} · 待办：${entry.todos.join(" | ")}`
          : entry.content,
    }));
    const envelopeItems: ActivityItem[] = envelopes.map((entry) => ({
      id: `envelope-${entry.id}`,
      kind: "envelope",
      at: entry.createdAt,
      title: `信封 ${entry.from} → ${entry.to}`,
      detail: `${entry.text} · 状态 ${envelopeStatusLabel(entry.status)}`,
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
    return <div className="p-6 text-sm text-muted-foreground">加载任务详情中...</div>;
  }

  if (error && !task) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">错误：{error}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          返回
        </Button>
      </div>
    );
  }

  if (!task || !id) {
    return <div className="p-6 text-sm text-muted-foreground">未找到任务。</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${encodeURIComponent(id)}/tasks`)}>
            &larr; 任务
          </Button>
          <h1 className="text-2xl font-bold truncate">{task.title}</h1>
          <Badge variant="outline" className="font-mono text-xs">
            {task.id}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {stateLabel(task.state)}
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">任务概览</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>项目：{project?.name ?? task.projectId}</div>
          <div>优先级：{task.priority}</div>
          <div>执行者：{task.assignee ?? "—"}</div>
          <div>产出：{task.output ?? "—"}</div>
          <div>创建时间：{formatTime(task.createdAt)}</div>
          <div>更新时间：{formatTime(task.updatedAt)}</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">更新状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="nextState">状态</Label>
              <Select value={nextState} onValueChange={(value) => setNextState(value as ProjectTaskState)}>
                <SelectTrigger id="nextState">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {stateLabel(state)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignee">执行者</Label>
              <Input
                id="assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                list="task-assignee-options"
                placeholder={activeLeaders.length > 0 ? "选择激活的领队" : "领队智能体名称"}
              />
              {activeLeaders.length > 0 && (
                <>
                  <datalist id="task-assignee-options">
                    {activeLeaders.map((leader) => (
                      <option key={leader} value={leader} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    激活领队：{activeLeaders.join(", ")}
                  </p>
                </>
              )}
            </div>
            {nextState === "dispatched" && (
              <div className="space-y-2">
                <Label htmlFor="dispatchText">分派文本（可选）</Label>
                <Textarea
                  id="dispatchText"
                  value={dispatchText}
                  onChange={(e) => setDispatchText(e.target.value)}
                  placeholder="给执行者的任务摘要"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  为空时将使用默认分派模板。
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="reason">原因</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="说明状态变更原因"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="output">输出</Label>
              <Input
                id="output"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="摘要或路径"
              />
            </div>
            <Button onClick={handleUpdateState} disabled={savingState || (nextState === "dispatched" && !assignee.trim())}>
              {savingState ? "保存中..." : "应用状态"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void handleCancelTask(false)}
                disabled={cancellingTask || task.state === "completed" || task.state === "cancelled"}
              >
                {cancellingTask ? "取消中..." : "取消任务"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleCancelTask(true)}
                disabled={cancellingTask || !task.assignee || task.state === "completed" || task.state === "cancelled"}
              >
                {cancellingTask ? "停止中..." : "强制停止智能体"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">追加进度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="progressAgent">智能体</Label>
              <Input
                id="progressAgent"
                value={progressAgent}
                onChange={(e) => setProgressAgent(e.target.value)}
                placeholder="智能体名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="progressContent">进度内容</Label>
              <Input
                id="progressContent"
                value={progressContent}
                onChange={(e) => setProgressContent(e.target.value)}
                placeholder="当前进展"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="progressTodos">待办（可选，用 ; 或 , 分隔）</Label>
              <Input
                id="progressTodos"
                value={progressTodos}
                onChange={(e) => setProgressTodos(e.target.value)}
                placeholder="步骤A完成; 步骤B进行中"
              />
            </div>
            <Button onClick={handleAppendProgress} disabled={savingProgress || !progressContent.trim()}>
              {savingProgress ? "追加中..." : "追加进度"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">统一活动流</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activities.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无活动。</p>
          )}
          {activities.map((item) => (
            <div key={item.id} className="border rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {activityKindLabel(item.kind)}
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
