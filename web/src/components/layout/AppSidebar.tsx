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
  { title: "Dashboard", path: "/", icon: "◉" },
  { title: "Agents", path: "/agents", icon: "⬡" },
  { title: "Projects", path: "/projects", icon: "◈" },
  { title: "Envelopes", path: "/envelopes", icon: "✉" },
  { title: "Prompts", path: "/prompts", icon: "¶" },
  { title: "CLI", path: "/cli", icon: ">" },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">Hi-Boss</span>
          <span className="text-xs text-muted-foreground">Web</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.path}
                      className={({ isActive }) =>
                        isActive ? "font-semibold" : ""
                      }
                    >
                      <span className="mr-2">{item.icon}</span>
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
