import {
  Bot,
  MessagesSquare,
  Settings2,
  Sparkle,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "智能体", path: "/", icon: Bot },
  { title: "项目", path: "/projects", icon: MessagesSquare },
  { title: "信封", path: "/envelopes", icon: Sparkle },
  { title: "配置", path: "/cli", icon: Settings2 },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border/70 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-black/20">
            <Sparkle className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">Hi-Boss</p>
            <p className="text-[11px] text-sidebar-foreground/88">运维控制台</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/90">导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild className="rounded-xl text-sidebar-foreground hover:text-sidebar-foreground">
                    <NavLink
                      to={item.path}
                      className={({ isActive }) =>
                        isActive
                          ? "bg-sidebar-primary/30 text-sidebar-foreground font-semibold"
                          : "text-sidebar-foreground"
                      }
                    >
                      <item.icon className="size-4" />
                      {item.title}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
