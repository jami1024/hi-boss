import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Badge } from "@/components/ui/badge";
import { Dashboard } from "@/pages/Dashboard";
import { AgentsPage } from "@/pages/Agents";
import { AgentDetailPage } from "@/pages/AgentDetail";
import { ProjectsPage } from "@/pages/Projects";
import { ProjectDetailPage } from "@/pages/ProjectDetail";
import { ProjectChatPage } from "@/pages/ProjectChat";
import { ProjectMemoryPage } from "@/pages/ProjectMemory";
import { ProjectTasksPage } from "@/pages/ProjectTasks";
import { ProjectTaskDetailPage } from "@/pages/ProjectTaskDetail";
import { ConfigPage } from "@/pages/Config";
import { EnvelopesPage } from "@/pages/Envelopes";
import { LoginPage, hasToken } from "@/pages/Login";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Waypoints } from "lucide-react";

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="app-shell-bg">
        <header className="sticky top-0 z-20 flex h-15 items-center justify-between border-b border-border/60 bg-background/82 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 !h-5" />
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] tracking-wide uppercase">
              <Waypoints className="size-3" />
              编排中枢
            </Badge>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] font-semibold">
              <Sparkles className="size-3" />
              Hi-Boss 中文控制台
            </Badge>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:name" element={<AgentDetailPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/chat" element={<ProjectChatPage />} />
            <Route path="/projects/:id/chat/:conversationId" element={<ProjectChatPage />} />
            <Route path="/projects/:id/memory" element={<ProjectMemoryPage />} />
            <Route path="/projects/:id/tasks" element={<ProjectTasksPage />} />
            <Route path="/projects/:id/tasks/:taskId" element={<ProjectTaskDetailPage />} />
            <Route path="/envelopes" element={<EnvelopesPage />} />
            <Route path="/cli" element={<ConfigPage />} />
          </Routes>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function App() {
  if (!hasToken()) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <TooltipProvider>
        <AppLayout />
      </TooltipProvider>
    </BrowserRouter>
  );
}
