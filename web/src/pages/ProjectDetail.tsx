import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  api,
  type ProjectSummary,
  type ProjectLeaderInfo,
  type AgentSummary,
  type RemoteSkillRecord,
} from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RemoteSkillManager } from "@/components/RemoteSkillManager";

function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [refreshingSpeakerSession, setRefreshingSpeakerSession] = useState(false);
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkillRecord[]>([]);
  const [remoteSkillsLoading, setRemoteSkillsLoading] = useState(false);
  const [remoteSkillsError, setRemoteSkillsError] = useState("");

  // Edit form state
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [speakerAgent, setSpeakerAgent] = useState("");
  const [mainGroupChannel, setMainGroupChannel] = useState("");

  // Add leader form
  const [newLeaderName, setNewLeaderName] = useState("");
  const [newLeaderCaps, setNewLeaderCaps] = useState("");
  const [addingLeader, setAddingLeader] = useState(false);

  const loadProject = useCallback(async () => {
    if (!id) return;
    try {
      const { project: p } = await api.getProject(id);
      setProject(p);
      setName(p.name);
      setRoot(p.root);
      setSpeakerAgent(p.speakerAgent);
      setMainGroupChannel(p.mainGroupChannel ?? "");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  const loadAgents = useCallback(async () => {
    try {
      const { agents: list } = await api.listAgents();
      setAgents(list);
    } catch {
      // non-critical
    }
  }, []);

  const loadRemoteSkills = useCallback(async () => {
    if (!id) return;
    setRemoteSkillsLoading(true);
    setRemoteSkillsError("");
    try {
      const result = await api.listProjectRemoteSkills(id);
      setRemoteSkills(result.skills);
    } catch (err) {
      setRemoteSkillsError((err as Error).message);
    } finally {
      setRemoteSkillsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProject();
    loadAgents();
    loadRemoteSkills();
    const interval = setInterval(loadProject, 15000);
    return () => clearInterval(interval);
  }, [loadProject, loadAgents, loadRemoteSkills]);

  const handleAddRemoteSkill = async (input: { skillName: string; sourceUrl: string; ref?: string }) => {
    if (!id) return;
    const result = await api.addProjectRemoteSkill(id, input);
    await loadRemoteSkills();
    return { refresh: result.refresh };
  };

  const handleUpdateRemoteSkill = async (input: { skillName: string; sourceUrl?: string; ref?: string }) => {
    if (!id) return;
    const result = await api.updateProjectRemoteSkill(id, input.skillName, {
      sourceUrl: input.sourceUrl,
      ref: input.ref,
    });
    await loadRemoteSkills();
    return { refresh: result.refresh };
  };

  const handleRemoveRemoteSkill = async (skillName: string) => {
    if (!id) return;
    const result = await api.removeProjectRemoteSkill(id, skillName);
    await loadRemoteSkills();
    return { refresh: result.refresh };
  };

  const handleSave = async () => {
    if (!id || !project) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    try {
      const params: Record<string, string | null> = {};
      if (name !== project.name) params.name = name.trim();
      if (root !== project.root) params.root = root.trim();
      if (speakerAgent !== project.speakerAgent) params.speakerAgent = speakerAgent;
      if (mainGroupChannel !== (project.mainGroupChannel ?? "")) {
        params.mainGroupChannel = mainGroupChannel.trim() || null;
      }

      if (Object.keys(params).length === 0) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        setSaving(false);
        return;
      }

      await api.updateProject(id, params);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      await loadProject();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLeader = async (leader: ProjectLeaderInfo) => {
    if (!id) return;
    try {
      await api.updateProjectLeader(id, leader.agentName, {
        active: !leader.active,
      });
      await loadProject();
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleAddLeader = async () => {
    if (!id || !newLeaderName.trim()) return;
    setAddingLeader(true);
    setSaveError("");
    try {
      const capabilities = newLeaderCaps
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      await api.upsertProjectLeader(id, {
        agentName: newLeaderName.trim(),
        capabilities,
        active: true,
      });
      setNewLeaderName("");
      setNewLeaderCaps("");
      await loadProject();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setAddingLeader(false);
    }
  };

  const handleRefreshSpeakerSession = async () => {
    if (!project) return;
    setRefreshingSpeakerSession(true);
    setSaveError("");
    try {
      await api.refreshAgent(project.speakerAgent, { projectId: project.id });
      await loadProject();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setRefreshingSpeakerSession(false);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Error: {error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/projects")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const leaders = project.leaders ?? [];
  const availableAgents = agents.filter(
    (a) => !leaders.some((l) => l.agentName === a.name),
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
            &larr; Back
          </Button>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <Badge variant="outline" className="text-xs font-mono">
            {project.id.slice(0, 8)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshSpeakerSession}
            disabled={refreshingSpeakerSession}
          >
            {refreshingSpeakerSession ? "Refreshing..." : "Refresh Speaker Session"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/chat`)}
          >
            Chat
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/tasks`)}
          >
            Tasks
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/memory`)}
          >
            Memory
          </Button>
        </div>
      </div>

      {/* Project Info */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Speaker
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="font-semibold">{project.speakerAgent}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Leaders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {leaders.filter((l) => l.active).length}
                <span className="text-sm text-muted-foreground font-normal">
                  {" "}/ {leaders.length}
                </span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Created
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-sm">{formatTime(project.createdAt)}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Updated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-sm">{formatTime(project.updatedAt)}</span>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="root">Root Path</Label>
              <Input
                id="root"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="/path/to/project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="speaker">Speaker Agent</Label>
              {agents.length > 0 ? (
                <Select value={speakerAgent} onValueChange={setSpeakerAgent}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="speaker"
                  value={speakerAgent}
                  onChange={(e) => setSpeakerAgent(e.target.value)}
                  placeholder="Agent name"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel">Main Group Channel</Label>
              <Input
                id="channel"
                value={mainGroupChannel}
                onChange={(e) => setMainGroupChannel(e.target.value)}
                placeholder="e.g. channel:telegram:12345"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to clear.
              </p>
            </div>
          </div>

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
        </CardContent>
      </Card>

      {/* Leaders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Leaders</CardTitle>
            <Badge variant="outline">
              {leaders.filter((l) => l.active).length} active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {leaders.length === 0 && (
            <p className="text-sm text-muted-foreground">No leaders assigned yet.</p>
          )}

          {leaders.map((leader) => (
            <div
              key={leader.agentName}
              className="flex items-center justify-between border rounded-lg p-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{leader.agentName}</span>
                  <Badge
                    variant={leader.active ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {leader.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {leader.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {leader.capabilities.map((cap) => (
                      <Badge key={cap} variant="outline" className="text-xs">
                        {cap}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Updated: {formatTime(leader.updatedAt)}
                </p>
              </div>
              <Switch
                checked={leader.active}
                onCheckedChange={() => handleToggleLeader(leader)}
              />
            </div>
          ))}

          {/* Add Leader */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Add Leader</p>
            <div className="flex items-end gap-3">
              <div className="space-y-2 flex-1">
                <Label htmlFor="newLeader">Agent</Label>
                {availableAgents.length > 0 ? (
                  <Select value={newLeaderName} onValueChange={setNewLeaderName}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgents.map((a) => (
                        <SelectItem key={a.name} value={a.name}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="newLeader"
                    value={newLeaderName}
                    onChange={(e) => setNewLeaderName(e.target.value)}
                    placeholder="Agent name"
                  />
                )}
              </div>
              <div className="space-y-2 flex-1">
                <Label htmlFor="newCaps">Capabilities</Label>
                <Input
                  id="newCaps"
                  value={newLeaderCaps}
                  onChange={(e) => setNewLeaderCaps(e.target.value)}
                  placeholder="cap1, cap2, ..."
                />
              </div>
              <Button
                onClick={handleAddLeader}
                disabled={addingLeader || !newLeaderName.trim()}
              >
                {addingLeader ? "Adding..." : "Add"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <RemoteSkillManager
        title="Project Remote Skills"
        description={`Installed under ${project.root}/.hiboss/skills`}
        loading={remoteSkillsLoading}
        error={remoteSkillsError}
        skills={remoteSkills}
        onRefresh={loadRemoteSkills}
        onAdd={handleAddRemoteSkill}
        onUpdate={handleUpdateRemoteSkill}
        onRemove={handleRemoveRemoteSkill}
      />
    </div>
  );
}
