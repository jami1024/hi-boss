import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import type { RemoteSkillRecord, RemoteSkillRefreshSummary } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RemoteSkillManagerProps {
  title: string;
  description?: string;
  loading: boolean;
  error: string;
  skills: RemoteSkillRecord[];
  onRefresh: () => Promise<void>;
  onAdd: (
    input: { skillName: string; sourceUrl: string; ref?: string }
  ) => Promise<{ refresh?: RemoteSkillRefreshSummary } | undefined>;
  onUpdate: (
    input: { skillName: string; sourceUrl?: string; ref?: string }
  ) => Promise<{ refresh?: RemoteSkillRefreshSummary } | undefined>;
  onRemove: (skillName: string) => Promise<{ refresh?: RemoteSkillRefreshSummary } | undefined>;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatRefreshMessage(refresh?: RemoteSkillRefreshSummary): string {
  if (!refresh || refresh.count <= 0) {
    return "技能操作完成。";
  }
  const targets = refresh.requested
    .map((entry) =>
      entry.scope === "project" && entry.projectId
        ? `${entry.agentName}:${entry.projectId}`
        : entry.agentName
    )
    .join(", ");
  return `技能操作完成，已触发 ${refresh.count} 个会话刷新：${targets}`;
}

function formatActionError(err: unknown): string {
  if (err instanceof ApiError) {
    const codePart = err.errorCode ? ` [${err.errorCode}]` : "";
    const hintPart = err.hint ? ` 建议：${err.hint}` : "";
    return `${err.message}${codePart}${hintPart}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function RemoteSkillManager(props: RemoteSkillManagerProps) {
  const [skillName, setSkillName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [pendingAction, setPendingAction] = useState<string>("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [updateSourceBySkill, setUpdateSourceBySkill] = useState<Record<string, string>>({});
  const [updateRefBySkill, setUpdateRefBySkill] = useState<Record<string, string>>({});

  const sortedSkills = useMemo(
    () => [...props.skills].sort((a, b) => a.skillName.localeCompare(b.skillName)),
    [props.skills]
  );

  const handleAdd = async () => {
    if (!skillName.trim() || !sourceUrl.trim()) return;
    const actionKey = `add:${skillName.trim().toLowerCase()}`;
    setPendingAction(actionKey);
    setActionError("");
    setActionSuccess("");
    try {
      const result = await props.onAdd({
        skillName: skillName.trim(),
        sourceUrl: sourceUrl.trim(),
        ref: sourceRef.trim() || undefined,
      });
      setActionSuccess(formatRefreshMessage(result?.refresh));
      setSkillName("");
      setSourceUrl("");
      setSourceRef("");
    } catch (err) {
      setActionError(formatActionError(err));
    } finally {
      setPendingAction("");
    }
  };

  const handleUpdate = async (name: string) => {
    const actionKey = `update:${name}`;
    setPendingAction(actionKey);
    setActionError("");
    setActionSuccess("");
    try {
      const sourceUrl = updateSourceBySkill[name]?.trim();
      const ref = updateRefBySkill[name]?.trim();
      const result = await props.onUpdate({
        skillName: name,
        sourceUrl: sourceUrl || undefined,
        ref: ref || undefined,
      });
      setActionSuccess(formatRefreshMessage(result?.refresh));
    } catch (err) {
      setActionError(formatActionError(err));
    } finally {
      setPendingAction("");
    }
  };

  const handleRemove = async (name: string) => {
    const actionKey = `remove:${name}`;
    setPendingAction(actionKey);
    setActionError("");
    setActionSuccess("");
    try {
      const result = await props.onRemove(name);
      setActionSuccess(formatRefreshMessage(result?.refresh));
    } catch (err) {
      setActionError(formatActionError(err));
    } finally {
      setPendingAction("");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{props.title}</CardTitle>
            {props.description && (
              <p className="text-xs text-muted-foreground mt-1">{props.description}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={props.loading || pendingAction !== ""}
            onClick={() => void props.onRefresh()}
          >
            {props.loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="remoteSkillName">Skill Name</Label>
            <Input
              id="remoteSkillName"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="code-review"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="remoteSkillSource">Source URL</Label>
            <Input
              id="remoteSkillSource"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://github.com/org/repo/tree/main/skills/code-review"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remoteSkillRef">Ref (optional)</Label>
            <Input
              id="remoteSkillRef"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="main"
            />
          </div>
          <div className="flex items-end md:col-span-2">
            <Button
              onClick={handleAdd}
              disabled={
                props.loading ||
                pendingAction !== "" ||
                !skillName.trim() ||
                !sourceUrl.trim()
              }
            >
              {pendingAction.startsWith("add:") ? "Adding..." : "Add Remote Skill"}
            </Button>
          </div>
        </div>

        {(props.error || actionError) && (
          <p className="text-sm text-destructive">{actionError || props.error}</p>
        )}

        {actionSuccess && (
          <p className="text-sm text-green-700">{actionSuccess}</p>
        )}

        {sortedSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground">No remote skills installed yet.</p>
        ) : (
          <div className="space-y-3">
            {sortedSkills.map((skill) => (
              <div key={skill.skillName} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{skill.skillName}</span>
                    <Badge variant="outline" className="text-xs">
                      {skill.status}
                    </Badge>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {skill.commit.slice(0, 12)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.loading || pendingAction !== ""}
                      onClick={() => void handleUpdate(skill.skillName)}
                    >
                      {pendingAction === `update:${skill.skillName}` ? "Updating..." : "Update"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={props.loading || pendingAction !== ""}
                      onClick={() => void handleRemove(skill.skillName)}
                    >
                      {pendingAction === `remove:${skill.skillName}` ? "Removing..." : "Remove"}
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1 break-words">
                  <p>source: {skill.sourceUrl}</p>
                  <p>ref: {skill.sourceRef} · path: {skill.sourcePath || "."}</p>
                  <p>files: {skill.fileCount} · checksum: {skill.checksum.slice(0, 16)}...</p>
                  <p>
                    added: {formatDate(skill.addedAt)} · updated: {formatDate(skill.lastUpdated)}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Input
                    value={updateSourceBySkill[skill.skillName] ?? ""}
                    onChange={(e) =>
                      setUpdateSourceBySkill((prev) => ({
                        ...prev,
                        [skill.skillName]: e.target.value,
                      }))
                    }
                    placeholder="Optional source URL override"
                  />
                  <Input
                    value={updateRefBySkill[skill.skillName] ?? ""}
                    onChange={(e) =>
                      setUpdateRefBySkill((prev) => ({
                        ...prev,
                        [skill.skillName]: e.target.value,
                      }))
                    }
                    placeholder="Optional ref override"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
