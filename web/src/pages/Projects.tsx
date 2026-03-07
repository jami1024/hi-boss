import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type ProjectSummary } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

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

  useEffect(() => {
    const load = async () => {
      try {
        const { projects: list } = await api.listProjects({ limit: 100 });
        setProjects(list);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

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
            Projects are automatically created when agents use work items with project context.
          </p>
        </div>
      )}
    </div>
  );
}
