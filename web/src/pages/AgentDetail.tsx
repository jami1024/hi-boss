import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  ChevronLeft,
  Clock,
  Cpu,
  Heart,
  Inbox,
  RefreshCw,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import {
  api,
  type AgentSummary,
  type AgentStatus,
  type AgentUpdateParams,
  type RemoteSkillRecord,
  type SessionPolicy,
} from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
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
    case "ok": return "正常";
    case "degraded": return "降级";
    case "error": return "异常";
    default: return "未知";
  }
}

function formatTime(ms: number | null): string {
  if (!ms) return "--";
  return new Date(ms).toLocaleString();
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

function roleLabel(role: string | null): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "--";
}

function runStatusLabel(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  if (status === "cancelled") return "已取消";
  return "未知";
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.25 },
  }),
};

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
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
  const formDirtyRef = useRef(false);
  const markFormDirty = useCallback(() => { formDirtyRef.current = true; }, []);

  const syncFormFromAgent = useCallback((a: AgentSummary) => {
    setDescription(a.description ?? "");
    setWorkspace(a.workspace ?? "");
    setProvider((a.provider ?? "claude") as "claude" | "codex");
    setModel(a.model ?? "");
    setReasoningEffort(a.reasoningEffort ?? "");
    setPermissionLevel(a.permissionLevel ?? "standard");
    setDailyResetAt(a.sessionPolicy?.dailyResetAt ?? "");
    setIdleTimeout(a.sessionPolicy?.idleTimeout ?? "");
    setMaxContextLength(
      a.sessionPolicy?.maxContextLength != null
        ? String(a.sessionPolicy.maxContextLength)
        : ""
    );
    formDirtyRef.current = false;
  }, []);

  const loadAgent = useCallback(async (opts?: { forceSync?: boolean }) => {
    if (!name) return;
    try {
      const detail = await api.getAgentStatus(name);
      setAgent(detail.agent);
      setStatus(detail.status);
      if (!formDirtyRef.current || opts?.forceSync) {
        syncFormFromAgent(detail.agent);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [name, syncFormFromAgent]);

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

      if (Object.keys(params).length === 0) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        return;
      }

      await api.updateAgent(name, params);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      await loadAgent({ forceSync: true });
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
        <p className="text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/agents")}>
          返回智能体列表
        </Button>
      </div>
    );
  }

  if (!agent || !status) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <Bot className="size-8 text-muted-foreground/40 mx-auto animate-pulse" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  const isRunning = status.agentState === "running";
  const healthOk = status.agentHealth === "ok";

  return (
    <div className="p-6 space-y-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate("/agents")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2.5">
            <div className={`grid size-10 place-items-center rounded-xl ${isRunning ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              <Bot className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight">{agent.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant={agent.role === "speaker" ? "default" : "secondary"} className="text-[11px]">
                  {roleLabel(agent.role)}
                </Badge>
                {agent.provider && (
                  <Badge variant="outline" className="text-[11px] gap-1">
                    <Cpu className="size-2.5" />
                    {agent.provider}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            刷新会话
          </Button>
          {isRunning && (
            <Button variant="outline" size="sm" onClick={handleAbort} className="gap-1.5">
              <Square className="size-3" />
              中止
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除智能体</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将永久删除智能体 &ldquo;{agent.name}&rdquo;，并移除其绑定、定时任务和主目录。
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

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <motion.div custom={0} initial="hidden" animate="visible" variants={fadeUp}>
          <StatusCard
            icon={<Zap className="size-4" />}
            label="状态"
            value={isRunning ? "运行中" : "空闲"}
            highlight={isRunning}
            dot={isRunning}
          />
        </motion.div>
        <motion.div custom={1} initial="hidden" animate="visible" variants={fadeUp}>
          <StatusCard
            icon={<Heart className="size-4" />}
            label="健康度"
            value={healthLabel(status.agentHealth)}
            variant={healthOk ? "ok" : status.agentHealth === "degraded" ? "warn" : status.agentHealth === "error" ? "error" : undefined}
          />
        </motion.div>
        <motion.div custom={2} initial="hidden" animate="visible" variants={fadeUp}>
          <StatusCard
            icon={<Inbox className="size-4" />}
            label="待处理"
            value={String(status.pendingCount)}
            highlight={status.pendingCount > 0}
          />
        </motion.div>
        <motion.div custom={3} initial="hidden" animate="visible" variants={fadeUp}>
          <LastRunCard lastRun={status.lastRun} />
        </motion.div>
      </div>

      {/* Current run banner */}
      {status.currentRun && (
        <motion.div custom={4} initial="hidden" animate="visible" variants={fadeUp}>
          <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <Activity className="size-4 text-primary animate-pulse shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                正在执行任务
                {status.currentRun.sessionTarget && (
                  <span className="font-mono text-xs text-muted-foreground ml-2">
                    {status.currentRun.sessionTarget}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="font-mono">{status.currentRun.id.replace(/-/g, "").slice(0, 8)}</span>
                {status.currentRun.projectId && (
                  <span>项目: <span className="font-mono">{status.currentRun.projectId}</span></span>
                )}
                <span>{formatRelativeTime(status.currentRun.startedAt)} 开始</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Last run error */}
      {status.lastRun?.error && (
        <motion.div custom={5} initial="hidden" animate="visible" variants={fadeUp}>
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-xs font-medium text-destructive mb-1">最近运行错误</p>
            <pre className="text-sm text-destructive/80 whitespace-pre-wrap">{status.lastRun.error}</pre>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onChangeCapture={() => markFormDirty()}>
      <Tabs defaultValue="general">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="provider">供应商</TabsTrigger>
          <TabsTrigger value="session">会话策略</TabsTrigger>
          <TabsTrigger value="skills">远程技能</TabsTrigger>
          <TabsTrigger value="prompt">提示词</TabsTrigger>
          <TabsTrigger value="info">信息</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <Card className="border-border/60">
            <CardContent className="pt-6 space-y-5">
              <FormField label="描述" hint="描述会展示给发言者智能体，用于判断将哪些任务分配给该智能体。建议分行写明职责、擅长领域和不擅长领域。">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={"负责前端开发，擅长 React/TypeScript。\n可处理：UI组件开发、样式调整、页面路由、状态管理。\n不擅长：后端API、数据库操作。"}
                  rows={4}
                  className="resize-none"
                />
              </FormField>
              <FormField label="工作目录">
                <Input
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="/Users/你的用户名/projects/workspace"
                  className="font-mono text-sm"
                />
              </FormField>
              <FormField label="权限级别">
                <Select value={permissionLevel} onValueChange={(v) => { setPermissionLevel(v); markFormDirty(); }}>
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
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="provider" className="mt-4">
          <Card className="border-border/60">
            <CardContent className="pt-6 space-y-5">
              <FormField label="供应商">
                <Select value={provider} onValueChange={(v) => { setProvider(v as "claude" | "codex"); markFormDirty(); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="模型">
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="该供应商的默认模型"
                  className="font-mono text-sm"
                />
              </FormField>
              <FormField label="推理强度">
                <Select
                  value={reasoningEffort || "default"}
                  onValueChange={(v) => { setReasoningEffort(v === "default" ? "" : v); markFormDirty(); }}
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
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="session" className="mt-4">
          <Card className="border-border/60">
            <CardContent className="pt-6 space-y-5">
              <FormField label="每日重置时间" hint="每日重置智能体会话的时间（HH:MM，按 Boss 时区）。">
                <Input
                  value={dailyResetAt}
                  onChange={(e) => setDailyResetAt(e.target.value)}
                  placeholder="例如 09:00"
                />
              </FormField>
              <FormField label="空闲超时" hint="空闲超时时长（例如 &quot;2h&quot;、&quot;30m&quot;、&quot;1h30m&quot;）。">
                <Input
                  value={idleTimeout}
                  onChange={(e) => setIdleTimeout(e.target.value)}
                  placeholder="例如 2h"
                />
              </FormField>
              <FormField label="最大上下文长度" hint="会话刷新前允许的最大 token 上下文长度。">
                <Input
                  type="number"
                  value={maxContextLength}
                  onChange={(e) => setMaxContextLength(e.target.value)}
                  placeholder="例如 100000"
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
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

        <TabsContent value="prompt" className="mt-4">
          <AgentPromptPanel agentName={agent.name} />
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <Card className="border-border/60">
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoItem label="名称" value={agent.name} mono />
                <InfoItem label="角色" value={roleLabel(agent.role)} />
                <InfoItem label="创建时间" value={formatTime(agent.createdAt)} />
                <InfoItem label="最近在线" value={agent.lastSeenAt ? formatRelativeTime(agent.lastSeenAt) : "--"} sub={formatTime(agent.lastSeenAt)} />
                <InfoItem
                  label="绑定"
                  value={agent.bindings.length > 0 ? agent.bindings.join(", ") : "无"}
                  mono={agent.bindings.length > 0}
                />
                {status.currentRun && (
                  <InfoItem label="当前运行" value={status.currentRun.id.replace(/-/g, "").slice(0, 8)} mono />
                )}
                {status.currentRun?.sessionTarget && (
                  <InfoItem label="会话目标" value={status.currentRun.sessionTarget} mono />
                )}
                {status.currentRun?.projectId && (
                  <InfoItem label="当前项目" value={status.currentRun.projectId} mono />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-0 -mx-6 md:-mx-8 border-t border-border/60 bg-background/90 backdrop-blur-sm px-6 md:px-8 py-3">
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? "保存中..." : "保存变更"}
          </Button>
          {saveSuccess && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">保存成功</span>
          )}
          {saveError && (
            <span className="text-sm text-destructive">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Sub-components ---- */

function StatusCard({
  icon,
  label,
  value,
  highlight,
  dot,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  dot?: boolean;
  variant?: "ok" | "warn" | "error";
}) {
  const colorClass = variant === "ok"
    ? "text-emerald-600 dark:text-emerald-400"
    : variant === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : variant === "error"
        ? "text-red-600 dark:text-red-400"
        : highlight
          ? "text-primary"
          : "";

  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {dot && (
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
          <p className={`text-lg font-bold leading-tight ${colorClass}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LastRunCard({ lastRun }: { lastRun: AgentStatus["lastRun"] }) {
  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Clock className="size-4" />
          <span className="text-xs font-medium">最近运行</span>
        </div>
        {lastRun ? (
          <div>
            <Badge
              variant={
                lastRun.status === "completed" ? "default"
                  : lastRun.status === "failed" ? "destructive"
                    : "secondary"
              }
              className="text-[11px]"
            >
              {runStatusLabel(lastRun.status)}
            </Badge>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {formatRelativeTime(lastRun.completedAt ?? lastRun.startedAt)}
            </p>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </CardContent>
    </Card>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function InfoItem({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/30 px-3.5 py-2.5">
      <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
