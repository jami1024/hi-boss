import type { AgentSummary, ProjectLeaderInfo } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface ProjectLeaderManagerProps {
  leaders: ProjectLeaderInfo[];
  availableAgents: AgentSummary[];
  newLeaderName: string;
  newLeaderCaps: string;
  addingLeader: boolean;
  onNewLeaderNameChange: (value: string) => void;
  onNewLeaderCapsChange: (value: string) => void;
  onAddLeader: () => void;
  onToggleLeader: (leader: ProjectLeaderInfo) => void;
  formatTime: (ms: number | null | undefined) => string;
}

export function ProjectLeaderManager({
  leaders,
  availableAgents,
  newLeaderName,
  newLeaderCaps,
  addingLeader,
  onNewLeaderNameChange,
  onNewLeaderCapsChange,
  onAddLeader,
  onToggleLeader,
  formatTime,
}: ProjectLeaderManagerProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">领队管理</CardTitle>
          <Badge variant="outline">激活 {leaders.filter((l) => l.active).length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {leaders.length === 0 && (
          <p className="text-sm text-muted-foreground">尚未分配领队。</p>
        )}

        {leaders.map((leader) => (
          <div
            key={leader.agentName}
            className="flex items-center justify-between rounded-lg border border-border/70 p-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{leader.agentName}</span>
                <Badge variant={leader.active ? "default" : "secondary"} className="text-xs">
                  {leader.active ? "激活" : "停用"}
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
              <p className="text-xs text-muted-foreground">更新时间：{formatTime(leader.updatedAt)}</p>
            </div>
            <Switch
              checked={leader.active}
              onCheckedChange={() => onToggleLeader(leader)}
            />
          </div>
        ))}

        <div className="border-t border-border/70 pt-4">
          <p className="mb-3 text-sm font-medium">新增领队</p>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="newLeader">智能体</Label>
              {availableAgents.length > 0 ? (
                <Select value={newLeaderName} onValueChange={onNewLeaderNameChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择智能体..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAgents.map((agent) => (
                      <SelectItem key={agent.name} value={agent.name}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="newLeader"
                  value={newLeaderName}
                  onChange={(e) => onNewLeaderNameChange(e.target.value)}
                  placeholder="智能体名称"
                />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="newCaps">能力标签</Label>
              <Input
                id="newCaps"
                value={newLeaderCaps}
                onChange={(e) => onNewLeaderCapsChange(e.target.value)}
                placeholder="能力1, 能力2, ..."
              />
            </div>
            <Button onClick={onAddLeader} disabled={addingLeader || !newLeaderName.trim()}>
              {addingLeader ? "添加中..." : "添加"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
