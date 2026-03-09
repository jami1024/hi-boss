import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type ProjectSummary, type AgentSummary } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3 },
  }),
};

function roleLabel(role: string | null): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "—";
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Create project dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newProject, setNewProject] = useState({
    name: "",
    root: "",
    speakerAgent: "",
    mainGroupChannel: "",
  });

  const loadProjects = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects({ limit: 100 });
      setProjects(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    const interval = setInterval(loadProjects, 15000);
    return () => clearInterval(interval);
  }, [loadProjects]);

  // Load agents when dialog opens
  useEffect(() => {
    if (!dialogOpen) return;
    api.listAgents().then(({ agents: list }) => {
      setAgents(list);
      // Auto-select the first speaker agent if available
      const speaker = list.find((a) => a.role === "speaker");
      if (speaker && !newProject.speakerAgent) {
        setNewProject((prev) => ({ ...prev, speakerAgent: speaker.name }));
      }
    });
  }, [dialogOpen, newProject.speakerAgent]);

  const handleCreate = async () => {
    setCreateError("");
    const name = newProject.name.trim();
    const root = newProject.root.trim();
    const speakerAgent = newProject.speakerAgent;

    if (!name) {
      setCreateError("项目名称不能为空");
      return;
    }
    if (!root) {
      setCreateError("项目路径不能为空");
      return;
    }
    if (!speakerAgent) {
      setCreateError("必须选择发言智能体");
      return;
    }

    setCreating(true);
    try {
      const body: { name: string; root: string; speakerAgent: string; mainGroupChannel?: string } = {
        name,
        root,
        speakerAgent,
      };
      if (newProject.mainGroupChannel.trim()) {
        body.mainGroupChannel = newProject.mainGroupChannel.trim();
      }
      const { project } = await api.createProject(body);
      setDialogOpen(false);
      setNewProject({ name: "", root: "", speakerAgent: "", mainGroupChannel: "" });
      await loadProjects();
      navigate(`/projects/${encodeURIComponent(project.id)}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
      </div>
    );
  }

  const filtered = projects.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.root.toLowerCase().includes(q) ||
      p.speakerAgent.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">项目工作区</h1>
          <p className="mt-1 text-sm text-muted-foreground">清晰绑定发言者、领队与频道，确保协作边界明确。</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder="筛选项目..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setCreateError("");
            }
          }}>
            <DialogTrigger asChild>
              <Button className="shadow-[0_12px_24px_-14px_color-mix(in_oklab,var(--primary)_80%,black)]">新建项目</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>新建项目</DialogTitle>
                <DialogDescription>
                  通过指定本地路径并绑定发言智能体来创建项目。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="project-name">项目名称</Label>
                  <Input
                    id="project-name"
                    placeholder="我的项目"
                    value={newProject.name}
                    onChange={(e) =>
                      setNewProject((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-root">项目路径</Label>
                  <Input
                    id="project-root"
                    placeholder="/Users/你的用户名/projects/示例项目"
                    className="font-mono text-sm"
                    value={newProject.root}
                    onChange={(e) =>
                      setNewProject((prev) => ({ ...prev, root: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    当前机器上的项目绝对路径。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="speaker-agent">发言智能体</Label>
                  <Select
                    value={newProject.speakerAgent}
                    onValueChange={(value) =>
                      setNewProject((prev) => ({ ...prev, speakerAgent: value }))
                    }
                  >
                    <SelectTrigger id="speaker-agent">
                      <SelectValue placeholder="选择一个智能体" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.name} value={agent.name}>
                          {agent.name}
                          {agent.role ? ` (${roleLabel(agent.role)})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="main-channel">
                    群聊频道 <span className="text-muted-foreground">（可选）</span>
                  </Label>
                  <Input
                    id="main-channel"
                    placeholder="channel:telegram:-100123456789"
                    className="font-mono text-sm"
                    value={newProject.mainGroupChannel}
                    onChange={(e) =>
                      setNewProject((prev) => ({
                        ...prev,
                        mainGroupChannel: e.target.value,
                      }))
                    }
                  />
                </div>
                {createError && (
                  <p className="text-sm text-destructive">{createError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={creating}
                >
                  取消
                </Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "创建中..." : "创建"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Badge variant="outline">共 {projects.length} 个</Badge>
        </div>
      </div>

      {filtered.length === 0 && projects.length > 0 && (
        <p className="text-muted-foreground">没有匹配筛选条件的项目。</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((project, i) => {
          const activeLeaders = project.leaders?.filter((l) => l.active) ?? [];
          return (
            <motion.div
              key={project.id}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={cardVariants}
            >
              <Card
                className="cursor-pointer border-border/75 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40"
                onClick={() =>
                  navigate(`/projects/${encodeURIComponent(project.id)}`)
                }
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {activeLeaders.length} 位领队
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>发言智能体</span>
                      <span className="font-medium text-foreground">
                        {project.speakerAgent}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>路径</span>
                      <span
                        className="font-mono text-xs text-foreground truncate max-w-[200px]"
                        title={project.root}
                      >
                        {project.root}
                      </span>
                    </div>
                    {project.mainGroupChannel && (
                      <div className="flex justify-between">
                        <span>频道</span>
                        <span
                          className="font-mono text-xs text-foreground truncate max-w-[200px]"
                          title={project.mainGroupChannel}
                        >
                          {project.mainGroupChannel}
                        </span>
                      </div>
                    )}
                    {activeLeaders.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1">
                        {activeLeaders.map((l) => (
                          <Badge key={l.agentName} variant="secondary" className="text-xs">
                            {l.agentName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {projects.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">还没有任何项目。</p>
          <p className="text-sm text-muted-foreground mt-1">
            点击“新建项目”开始使用。
          </p>
        </div>
      )}
    </div>
  );
}
