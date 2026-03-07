import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  api,
  type AgentSummary,
  type AgentStatus,
  type AgentUpdateParams,
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

function healthLabel(health: string): string {
  switch (health) {
    case "ok": return "Healthy";
    case "error": return "Error";
    default: return "Unknown";
  }
}

function healthColor(health: string): string {
  switch (health) {
    case "ok": return "text-green-600";
    case "error": return "text-red-600";
    default: return "text-yellow-600";
  }
}

function formatTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
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
    } catch (err) {
      setError((err as Error).message);
    }
  }, [name]);

  useEffect(() => {
    loadAgent();
    const interval = setInterval(loadAgent, 10000);
    return () => clearInterval(interval);
  }, [loadAgent]);

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
        if (maxContextLength.trim() && !isNaN(parsed) && parsed > 0) {
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
        <p className="text-destructive">Error: {error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/agents")}>
          Back to Agents
        </Button>
      </div>
    );
  }

  if (!agent || !status) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/agents")}>
            &larr; Back
          </Button>
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <Badge variant={agent.role === "speaker" ? "default" : "secondary"}>
            {agent.role ?? "—"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/agents/${encodeURIComponent(agent.name)}/chat`)}
          >
            Chat
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            Refresh Session
          </Button>
          {status.agentState === "running" && (
            <Button variant="outline" size="sm" onClick={handleAbort}>
              Abort
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete agent "{agent.name}" and remove all its bindings,
                  cron schedules, and home directory. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
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
              <CardTitle className="text-sm font-medium text-muted-foreground">State</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={status.agentState === "running" ? "default" : "secondary"}>
                {status.agentState}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Health</CardTitle>
            </CardHeader>
            <CardContent>
              <span className={`font-semibold ${healthColor(status.agentHealth)}`}>
                {healthLabel(status.agentHealth)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{status.pendingCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Last Run</CardTitle>
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
                    {status.lastRun.status}
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
            <CardTitle className="text-sm text-destructive">Last Run Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-destructive whitespace-pre-wrap">{status.lastRun.error}</pre>
          </CardContent>
        </Card>
      )}

      {/* Tabs for editing */}
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="provider">Provider</TabsTrigger>
          <TabsTrigger value="session">Session Policy</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Agent description..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace">Workspace</Label>
                <Input
                  id="workspace"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="/path/to/workspace"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="permission">Permission Level</Label>
                <Select value={permissionLevel} onValueChange={setPermissionLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restricted">Restricted</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="privileged">Privileged</SelectItem>
                    <SelectItem value="boss">Boss</SelectItem>
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
                <Label htmlFor="provider">Provider</Label>
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
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Default model for provider"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reasoning">Reasoning Effort</Label>
                <Select
                  value={reasoningEffort || "default"}
                  onValueChange={(v) => setReasoningEffort(v === "default" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="xhigh">Extra High</SelectItem>
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
                <Label htmlFor="dailyReset">Daily Reset At (HH:MM)</Label>
                <Input
                  id="dailyReset"
                  value={dailyResetAt}
                  onChange={(e) => setDailyResetAt(e.target.value)}
                  placeholder="e.g. 09:00"
                />
                <p className="text-xs text-muted-foreground">
                  Time to reset the agent session daily (in boss timezone).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="idleTimeout">Idle Timeout</Label>
                <Input
                  id="idleTimeout"
                  value={idleTimeout}
                  onChange={(e) => setIdleTimeout(e.target.value)}
                  placeholder="e.g. 2h"
                />
                <p className="text-xs text-muted-foreground">
                  Duration string (e.g. "2h", "30m", "1h30m") for idle session timeout.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxContext">Max Context Length</Label>
                <Input
                  id="maxContext"
                  type="number"
                  value={maxContextLength}
                  onChange={(e) => setMaxContextLength(e.target.value)}
                  placeholder="e.g. 100000"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum context length in tokens before session refresh.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-mono">{agent.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span>{agent.role ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatTime(agent.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Seen</span>
                  <span>{formatTime(agent.lastSeenAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bindings</span>
                  <span>{agent.bindings.length > 0 ? agent.bindings.join(", ") : "None"}</span>
                </div>
                {status.currentRun && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current Run</span>
                    <span className="font-mono text-xs">{status.currentRun.id.slice(0, 8)}</span>
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
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saveSuccess && (
          <span className="text-sm text-green-600">Saved successfully</span>
        )}
        {saveError && (
          <span className="text-sm text-destructive">{saveError}</span>
        )}
      </div>
    </div>
  );
}
