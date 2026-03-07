import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Dashboard } from "@/pages/Dashboard";
import { AgentsPage } from "@/pages/Agents";
import { AgentDetailPage } from "@/pages/AgentDetail";
import { AgentChatPage } from "@/pages/AgentChat";
import { ProjectsPage } from "@/pages/Projects";
import { ProjectDetailPage } from "@/pages/ProjectDetail";
import { PromptsPage } from "@/pages/Prompts";
import { ConfigPage } from "@/pages/Config";
import { EnvelopesPage } from "@/pages/Envelopes";
import { LoginPage, hasToken } from "@/pages/Login";
import { Separator } from "@/components/ui/separator";

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 !h-4" />
          <span className="text-sm text-muted-foreground">Hi-Boss Management</span>
        </header>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:name" element={<AgentDetailPage />} />
            <Route path="/agents/:name/chat" element={<AgentChatPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/envelopes" element={<EnvelopesPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
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
