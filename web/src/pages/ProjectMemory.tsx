import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ProjectMemoryEntry, type ProjectSummary, type RemoteSkillRefreshSummary } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PROJECT_MEMORY_TEMPLATES,
  deriveTitleFromEntryName,
  suggestVersionedMemoryEntryName,
} from "@/lib/project-memory-utils";
import { computeProjectMemoryDiff } from "@/lib/project-memory-diff";

function formatTime(ms: number | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function formatRefreshMessage(refresh?: RemoteSkillRefreshSummary): string {
  if (!refresh || refresh.count <= 0) {
    return "项目记忆已保存。";
  }
  const targets = refresh.requested
    .map((entry) => (entry.projectId ? `${entry.agentName}:${entry.projectId}` : entry.agentName))
    .join(", ");
  return `保存成功，并触发 ${refresh.count} 个会话刷新：${targets}`;
}

export function ProjectMemoryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [newEntryName, setNewEntryName] = useState("");
  const [draftTitle, setDraftTitle] = useState("notes");
  const [content, setContent] = useState("");
  const [baselineContent, setBaselineContent] = useState("");
  const [entryFilter, setEntryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt - a.updatedAt),
    [entries]
  );
  const filteredEntries = useMemo(() => {
    const keyword = entryFilter.trim().toLowerCase();
    if (!keyword) return sortedEntries;
    return sortedEntries.filter((entry) => entry.name.toLowerCase().includes(keyword));
  }, [entryFilter, sortedEntries]);
  const existingEntryNames = useMemo(() => entries.map((entry) => entry.name), [entries]);
  const diffResult = useMemo(
    () => computeProjectMemoryDiff(baselineContent, content),
    [baselineContent, content]
  );
  const hasUnsavedChanges = baselineContent !== content;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [{ project: nextProject }, { entries: nextEntries }] = await Promise.all([
        api.getProject(id),
        api.listProjectMemoryEntries(id),
      ]);
      setProject(nextProject);
      setEntries(nextEntries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadEntry = useCallback(
    async (entryName: string) => {
      if (!id) return;
      setEntryLoading(true);
      setError("");
      try {
        const { entry } = await api.getProjectMemoryEntry(id, entryName);
        setSelectedName(entry.name);
        setNewEntryName("");
        setDraftTitle(deriveTitleFromEntryName(entry.name));
        const loadedContent = entry.content ?? "";
        setContent(loadedContent);
        setBaselineContent(loadedContent);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setEntryLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const activeEntryName = selectedName || newEntryName.trim();

  const handleCreateDraft = () => {
    const suggested = suggestVersionedMemoryEntryName({
      existingNames: existingEntryNames,
      title: draftTitle,
    });
    setSelectedName("");
    setNewEntryName(suggested);
    setContent("");
    setBaselineContent("");
    setSuccess("");
    setError("");
  };

  const handleSuggestVersionedName = () => {
    const suggested = suggestVersionedMemoryEntryName({
      existingNames: existingEntryNames,
      title: draftTitle || deriveTitleFromEntryName(selectedName || "notes.md"),
    });
    setSelectedName("");
    setNewEntryName(suggested);
  };

  const handleUseTemplate = (templateId: string) => {
    const template = PROJECT_MEMORY_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;

    const suggested = suggestVersionedMemoryEntryName({
      existingNames: existingEntryNames,
      title: template.defaultTitle,
    });
    setSelectedName("");
    setDraftTitle(template.defaultTitle);
    setNewEntryName(suggested);
    setContent(template.content);
    setBaselineContent("");
    setError("");
    setSuccess("");
  };

  const handleSave = async () => {
    if (!id) return;
    const name = activeEntryName.trim();
    if (!name) {
      setError("条目名称不能为空");
      return;
    }
    if (!name.endsWith(".md")) {
      setError("条目名称必须以 .md 结尾");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.upsertProjectMemoryEntry(id, name, content);
      setSelectedName(result.entry.name);
      setNewEntryName("");
      setDraftTitle(deriveTitleFromEntryName(result.entry.name));
      setBaselineContent(result.entry.content ?? content);
      setSuccess(formatRefreshMessage(result.refresh));
      const { entries: nextEntries } = await api.listProjectMemoryEntries(id);
      setEntries(nextEntries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !selectedName) return;
    setDeleting(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.deleteProjectMemoryEntry(id, selectedName);
      setSuccess(formatRefreshMessage(result.refresh));
      setSelectedName("");
      setNewEntryName("");
      setContent("");
      setBaselineContent("");
      const { entries: nextEntries } = await api.listProjectMemoryEntries(id);
      setEntries(nextEntries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">加载项目记忆中...</div>;
  }

  if (!project) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">{error || "未找到项目"}</p>
        <Button variant="outline" onClick={() => navigate("/projects")}>返回</Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}>
            &larr; 项目
          </Button>
          <h1 className="text-2xl font-bold">{project.name} · 项目记忆</h1>
          <Badge variant="outline" className="font-mono text-xs">{project.id}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>刷新</Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px,1fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">条目列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="memoryEntryFilter">搜索条目</Label>
              <Input
                id="memoryEntryFilter"
                value={entryFilter}
                onChange={(e) => setEntryFilter(e.target.value)}
                placeholder="按名称搜索..."
              />
              <p className="text-xs text-muted-foreground">
                显示 {filteredEntries.length} / {sortedEntries.length}
              </p>
            </div>

            {sortedEntries.length === 0 && (
              <p className="text-sm text-muted-foreground">还没有项目记忆条目。</p>
            )}
            {sortedEntries.length > 0 && filteredEntries.length === 0 && (
              <p className="text-sm text-muted-foreground">没有匹配搜索条件的条目。</p>
            )}
            {filteredEntries.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className={`w-full text-left border rounded-md p-2 space-y-1 ${selectedName === entry.name ? "border-primary" : ""}`}
                onClick={() => void loadEntry(entry.name)}
              >
                <p className="text-sm font-medium truncate">{entry.name}</p>
                <p className="text-xs text-muted-foreground">{entry.size} B · {formatTime(entry.updatedAt)}</p>
              </button>
            ))}

            <div className="border-t pt-3 space-y-2">
              <Label htmlFor="memoryDraftTitle">草稿标题</Label>
              <Input
                id="memoryDraftTitle"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="decision-record"
              />
              <Label htmlFor="newMemoryEntry">新建条目</Label>
              <Input
                id="newMemoryEntry"
                value={newEntryName}
                onChange={(e) => setNewEntryName(e.target.value)}
                placeholder="2026-03-08-notes-v1.md"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={handleSuggestVersionedName}>
                  生成版本化名称
                </Button>
                <Button variant="outline" size="sm" onClick={handleCreateDraft}>
                  开始草稿
                </Button>
              </div>
            </div>

            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-medium">快捷模板</p>
              {PROJECT_MEMORY_TEMPLATES.map((template) => (
                <div key={template.id} className="border rounded-md p-2 space-y-2">
                  <div>
                    <p className="text-sm font-medium">{template.label}</p>
                    <p className="text-xs text-muted-foreground">{template.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUseTemplate(template.id)}
                  >
                    使用模板
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">编辑器</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="memoryEntryName">条目名称</Label>
              <Input
                id="memoryEntryName"
                value={activeEntryName}
                onChange={(e) => {
                  if (selectedName) {
                    setSelectedName(e.target.value);
                  } else {
                    setNewEntryName(e.target.value);
                  }
                }}
                placeholder="2026-03-08-notes-v1.md"
              />
              <p className="text-xs text-muted-foreground">
                建议：使用“日期 + 主题 + 版本”，例如 <code>2026-03-08-decision-record-v1.md</code>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="memoryContent">内容</Label>
              <Textarea
                id="memoryContent"
                className="min-h-[320px] font-mono text-sm"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在这里记录项目记忆..."
              />
            </div>

            {hasUnsavedChanges && (
              <div className="space-y-2 border rounded-md p-3 bg-muted/30">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">未保存差异预览</p>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary">+{diffResult.added}</Badge>
                    <Badge variant="outline">-{diffResult.removed}</Badge>
                    {diffResult.truncated && <Badge variant="outline">已截断</Badge>}
                  </div>
                </div>
                <div className="max-h-64 overflow-auto border rounded bg-background">
                  <pre className="text-xs font-mono leading-5 p-2 whitespace-pre-wrap break-words">
                    {diffResult.lines.map((line) => {
                      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
                      const className =
                        line.type === "add"
                          ? "text-green-700"
                          : line.type === "remove"
                            ? "text-red-700"
                            : "text-muted-foreground";
                      return (
                        <span key={line.id} className={`block ${className}`}>
                          {prefix} {line.text}
                        </span>
                      );
                    })}
                  </pre>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving || entryLoading}>
                {saving ? "保存中..." : "保存条目"}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting || !selectedName}
              >
                {deleting ? "删除中..." : "删除条目"}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-700">{success}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
