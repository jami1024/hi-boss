import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  api,
  type AgentSummary,
  type AgentStatus,
  type AgentUpdateParams,
  type ProjectSummary,
  type RemoteSkillRecord,
  type SessionPolicy,
} from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RemoteSkillManager } from "@/components/RemoteSkillManager";
import { AgentPromptPanel } from "@/components/AgentPromptPanel";

function healthLabel(health: string): string {
  switch (health) {
    case "ok": return "健康";
    case "degraded": return "亚健康";
    case "error": return "异常";
    default: return "未知";
  }
}

function healthColor(health: string): string {
  switch (health) {
    case "ok": return "text-green-600";
    case "degraded": return "text-yellow-600";
    case "error": return "text-red-600";
    default: return "text-gray-500";
  }
}

function formatTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function roleLabel(role: string | null): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "—";
}

function agentStateLabel(state: string): string {
  if (state === "running") return "运行中";
  if (state === "idle") return "空闲";
  if (state === "stopped") return "已停止";
  return "未知";
}

function runStatusLabel(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  if (status === "cancelled") return "已取消";
  return "未知";
}

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [boundProjects, setBoundProjects] = useState<ProjectSummary[]>([]);
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkillRecord[]>([]);
  const [remoteSkillsLoading, setRemoteSkillsLoading] = useState(false);
  const [remoteSkillsError, setRemoteSkillsError] = useState("");

  // Edit form state
  const [description, setDescription] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<string>("");
  const [permissionLevel, setPermissionLevel] = useState<string>("standard");
  const [dailyResetAt, setDailyResetAt] = useState("");
  const [idleTimeout, setIdleTimeout] = useState("");
  const [maxContextLength, setMaxContextLength] = useState("");

  const loadAgent = useCallback(async () => {
    if (!name) return;
    try {
      const detail = await api.getAgentStatus(name);
      setAgent(detail.agent);
      setStatus(detail.status);
      // Initialize form with current values
      setDescription(detail.agent.description ?? "");
      setWorkspace(detail.agent.workspace ?? "");
      setProvider((detail.agent.provider ?? "claude") as "claude" | "codex");
      setModel(detail.agent.model ?? "");
      setReasoningEffort(detail.agent.reasoningEffort ?? "");
      setPermissionLevel(detail.agent.permissionLevel ?? "standard");
      setDailyResetAt(detail.agent.sessionPolicy?.dailyResetAt ?? "");
      setIdleTimeout(detail.agent.sessionPolicy?.idleTimeout ?? "");
      setMaxContextLength(
        detail.agent.sessionPolicy?.maxContextLength != null
          ? String(detail.agent.sessionPolicy.maxContextLength)
          : ""
      );

      if (detail.agent.role === "speaker") {
        const { projects } = await api.listProjects({ limit: 200 });
        setBoundProjects(projects.filter((project) => project.speakerAgent === detail.agent.name));
      } else {
        setBoundProjects([]);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [name]);

  const loadRemoteSkills = useCallback(async () => {
    if (!name) return;
    setRemoteSkillsLoading(true);
    setRemoteSkillsError("");
    try {
      const result = await api.listAgentRemoteSkills(name);
      setRemoteSkills(result.skills);
    } catch (err) {
      setRemoteSkillsError((err as Error).message);
    } finally {
      setRemoteSkillsLoading(false);
    }
  }, [name]);

  useEffect(() => {
    loadAgent();
    loadRemoteSkills();
    const interval = setInterval(loadAgent, 10000);
    return () => clearInterval(interval);
  }, [loadAgent, loadRemoteSkills]);

  const handleAddRemoteSkill = async (input: { skillName: string; sourceUrl: string; ref?: string }) => {
    if (!name) return;
    const result = await api.addAgentRemoteSkill(name, input);
    await loadRemoteSkills();
    return { refresh: result.refresh };
  };

  const handleUpdateRemoteSkill = async (input: { skillName: string; sourceUrl?: string; ref?: string }) => {
    if (!name) return;
    const result = await api.updateAgentRemoteSkill(name, input.skillName, {
      sourceUrl: input.sourceUrl,
      ref: input.ref,
    });
    await loadRemoteSkills();
    return { refresh: result.refresh };
  };

  const handleRemoveRemoteSkill = async (skillName: string) => {
    if (!name) return;
    const result = await api.removeAgentRemoteSkill(name, skillName);
    await loadRemoteSkills();
    return { refresh: result.refresh };
  };

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    try {
      const params: AgentUpdateParams = {};

      if (description !== (agent?.description ?? "")) {
        params.description = description.trim() || null;
      }
      if (workspace !== (agent?.workspace ?? "")) {
        params.workspace = workspace.trim() || null;
      }
      if (provider !== (agent?.provider ?? "claude")) {
        params.provider = provider;
      }
      if (model !== (agent?.model ?? "")) {
        params.model = model.trim() || null;
      }
      if (reasoningEffort !== (agent?.reasoningEffort ?? "")) {
        params.reasoningEffort = (reasoningEffort || null) as AgentUpdateParams["reasoningEffort"];
      }
      if (permissionLevel !== (agent?.permissionLevel ?? "standard")) {
        params.permissionLevel = permissionLevel as AgentUpdateParams["permissionLevel"];
      }

      // Session policy
      const currentPolicy = agent?.sessionPolicy;
      const newPolicy: SessionPolicy = {};
      let policyChanged = false;

      if (dailyResetAt !== (currentPolicy?.dailyResetAt ?? "")) {
        newPolicy.dailyResetAt = dailyResetAt.trim() || undefined;
        policyChanged = true;
      }
      if (idleTimeout !== (currentPolicy?.idleTimeout ?? "")) {
        newPolicy.idleTimeout = idleTimeout.trim() || undefined;
        policyChanged = true;
      }
      const currentMaxCtx = currentPolicy?.maxContextLength != null
        ? String(currentPolicy.maxContextLength)
        : "";
      if (maxContextLength !== currentMaxCtx) {
        const parsed = parseInt(maxContextLength, 10);
        if (maxContextLength.trim() && !Number.isNaN(parsed) && parsed > 0) {
          newPolicy.maxContextLength = parsed;
        }
        policyChanged = true;
      }

      if (policyChanged) {
        if (!dailyResetAt.trim() && !idleTimeout.trim() && !maxContextLength.trim()) {
          params.sessionPolicy = null;
        } else {
          params.sessionPolicy = newPolicy;
        }
      }

      // Only send if there are changes
      if (Object.keys(params).length === 0) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        return;
      }

      await api.updateAgent(name, params);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      await loadAgent();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!name) return;
    try {
      await api.refreshAgent(name);
      await loadAgent();
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleAbort = async () => {
    if (!name) return;
    try {
      await api.abortAgent(name);
      await loadAgent();
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!name) return;
    try {
      await api.deleteAgent(name);
      navigate("/agents");
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/agents")}>
          返回智能体列表
        </Button>
      </div>
    );
  }

  if (!agent || !status) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/agents")}>
            &larr; 返回
          </Button>
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <Badge variant={agent.role === "speaker" ? "default" : "secondary"}>
            {roleLabel(agent.role)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {agent.role === "speaker" && boundProjects.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/agents/${encodeURIComponent(agent.name)}/chat`)}
            >
              聊天
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            刷新会话
          </Button>
          {status.agentState === "running" && (
            <Button variant="outline" size="sm" onClick={handleAbort}>
              中止
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">删除</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除智能体</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将永久删除智能体“{agent.name}”，并移除其绑定、定时任务和主目录。
                  此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Status Overview */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">状态</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={status.agentState === "running" ? "default" : "secondary"}>
                {agentStateLabel(status.agentState)}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">健康度</CardTitle>
            </CardHeader>
            <CardContent>
              <span className={`font-semibold ${healthColor(status.agentHealth)}`}>
                {healthLabel(status.agentHealth)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">待处理</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{status.pendingCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">最近运行</CardTitle>
            </CardHeader>
            <CardContent>
              {status.lastRun ? (
                <div className="text-sm">
                  <Badge
                    variant={status.lastRun.status === "completed" ? "default"
                      : status.lastRun.status === "failed" ? "destructive"
                      : "secondary"}
                    className="text-xs"
                  >
                    {runStatusLabel(status.lastRun.status)}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatTime(status.lastRun.completedAt ?? status.lastRun.startedAt)}
                  </p>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Error display for last run */}
      {status.lastRun?.error && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">最近运行错误</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-destructive whitespace-pre-wrap">{status.lastRun.error}</pre>
          </CardContent>
        </Card>
      )}

      {/* Tabs for editing */}
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="provider">供应商</TabsTrigger>
          <TabsTrigger value="session">会话策略</TabsTrigger>
          <TabsTrigger value="skills">远程技能</TabsTrigger>
          <TabsTrigger value="prompt">提示词</TabsTrigger>
          <TabsTrigger value="info">信息</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={"负责前端开发，擅长 React/TypeScript。\n可处理：UI组件开发、样式调整、页面路由、状态管理。\n不擅长：后端API、数据库操作。"}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  描述会展示给发言者智能体，用于判断将哪些任务分配给该智能体。建议分行写明职责、擅长领域和不擅长领域。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace">工作目录</Label>
                <Input
                  id="workspace"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="/Users/你的用户名/projects/workspace"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="permission">权限级别</Label>
                <Select value={permissionLevel} onValueChange={setPermissionLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restricted">受限</SelectItem>
                    <SelectItem value="standard">标准</SelectItem>
                    <SelectItem value="privileged">高权限</SelectItem>
                    <SelectItem value="boss">Boss（最高权限）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="provider" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="provider">供应商</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as "claude" | "codex")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">模型</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="该供应商的默认模型"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reasoning">推理强度</Label>
                <Select
                  value={reasoningEffort || "default"}
                  onValueChange={(v) => setReasoningEffort(v === "default" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">默认</SelectItem>
                    <SelectItem value="none">无</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="xhigh">超高</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="session" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dailyReset">每日重置时间（HH:MM）</Label>
                <Input
                  id="dailyReset"
                  value={dailyResetAt}
                  onChange={(e) => setDailyResetAt(e.target.value)}
                  placeholder="例如 09:00"
                />
                <p className="text-xs text-muted-foreground">
                  每日重置智能体会话的时间（按 Boss 时区）。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="idleTimeout">空闲超时</Label>
                <Input
                  id="idleTimeout"
                  value={idleTimeout}
                  onChange={(e) => setIdleTimeout(e.target.value)}
                  placeholder="例如 2h"
                />
                <p className="text-xs text-muted-foreground">
                  空闲超时时长（例如 "2h"、"30m"、"1h30m"）。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxContext">最大上下文长度</Label>
                <Input
                  id="maxContext"
                  type="number"
                  value={maxContextLength}
                  onChange={(e) => setMaxContextLength(e.target.value)}
                  placeholder="例如 100000"
                />
                <p className="text-xs text-muted-foreground">
                  会话刷新前允许的最大 token 上下文长度。
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills" className="space-y-4 mt-4">
          <RemoteSkillManager
            title="智能体远程技能"
            description={`安装目录：~/hiboss/agents/${agent.name}/skills`}
            loading={remoteSkillsLoading}
            error={remoteSkillsError}
            skills={remoteSkills}
            onRefresh={loadRemoteSkills}
            onAdd={handleAddRemoteSkill}
            onUpdate={handleUpdateRemoteSkill}
            onRemove={handleRemoveRemoteSkill}
          />
        </TabsContent>

        <TabsContent value="prompt" className="space-y-4 mt-4">
          <AgentPromptPanel agentName={agent.name} />
        </TabsContent>

        <TabsContent value="info" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">名称</span>
                  <span className="font-mono">{agent.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">角色</span>
                  <span>{roleLabel(agent.role)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">创建时间</span>
                  <span>{formatTime(agent.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最近在线</span>
                  <span>{formatTime(agent.lastSeenAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">绑定</span>
                  <span>{agent.bindings.length > 0 ? agent.bindings.join(", ") : "无"}</span>
                </div>
                {status.currentRun && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">当前运行</span>
                    <span className="font-mono text-xs">{status.currentRun.id.slice(0, 8)}</span>
                  </div>
                )}
                {status.currentRun?.sessionTarget && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">当前会话目标</span>
                    <span className="font-mono text-xs">{status.currentRun.sessionTarget}</span>
                  </div>
                )}
                {status.currentRun?.projectId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">当前项目</span>
                    <span className="font-mono text-xs">{status.currentRun.projectId}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存变更"}
        </Button>
        {saveSuccess && (
          <span className="text-sm text-green-600">保存成功</span>
        )}
        {saveError && (
          <span className="text-sm text-destructive">{saveError}</span>
        )}
      </div>
    </div>
  );
}
