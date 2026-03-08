import { useEffect, useState } from "react";
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

  const loadProjects = async () => {
    try {
      const { projects: list } = await api.listProjects({ limit: 100 });
      setProjects(list);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadProjects();
    const interval = setInterval(loadProjects, 15000);
    return () => clearInterval(interval);
  }, []);

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
  }, [dialogOpen]);

  const handleCreate = async () => {
    setCreateError("");
    const name = newProject.name.trim();
    const root = newProject.root.trim();
    const speakerAgent = newProject.speakerAgent;

    if (!name) {
      setCreateError("Project name is required");
      return;
    }
    if (!root) {
      setCreateError("Root path is required");
      return;
    }
    if (!speakerAgent) {
      setCreateError("Speaker agent is required");
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
        <p className="text-destructive">Error: {error}</p>
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Filter projects..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setCreateError("");
            }
          }}>
            <DialogTrigger asChild>
              <Button>Create Project</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Project</DialogTitle>
                <DialogDescription>
                  Create a new project by specifying a local path and binding a speaker agent.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="project-name">Project Name</Label>
                  <Input
                    id="project-name"
                    placeholder="my-project"
                    value={newProject.name}
                    onChange={(e) =>
                      setNewProject((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-root">Root Path</Label>
                  <Input
                    id="project-root"
                    placeholder="/home/user/projects/my-project"
                    className="font-mono text-sm"
                    value={newProject.root}
                    onChange={(e) =>
                      setNewProject((prev) => ({ ...prev, root: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Absolute path to the project directory on this machine.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="speaker-agent">Speaker Agent</Label>
                  <Select
                    value={newProject.speakerAgent}
                    onValueChange={(value) =>
                      setNewProject((prev) => ({ ...prev, speakerAgent: value }))
                    }
                  >
                    <SelectTrigger id="speaker-agent">
                      <SelectValue placeholder="Select an agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.name} value={agent.name}>
                          {agent.name}
                          {agent.role ? ` (${agent.role})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="main-channel">
                    Group Channel <span className="text-muted-foreground">(optional)</span>
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
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Badge variant="outline">{projects.length} total</Badge>
        </div>
      </div>

      {filtered.length === 0 && projects.length > 0 && (
        <p className="text-muted-foreground">No projects match the filter.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() =>
                  navigate(`/projects/${encodeURIComponent(project.id)}`)
                }
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {activeLeaders.length} leader{activeLeaders.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Speaker</span>
                      <span className="font-medium text-foreground">
                        {project.speakerAgent}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Root</span>
                      <span
                        className="font-mono text-xs text-foreground truncate max-w-[200px]"
                        title={project.root}
                      >
                        {project.root}
                      </span>
                    </div>
                    {project.mainGroupChannel && (
                      <div className="flex justify-between">
                        <span>Channel</span>
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
          <p className="text-muted-foreground">No projects yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "Create Project" to get started.
          </p>
        </div>
      )}
    </div>
  );
}
