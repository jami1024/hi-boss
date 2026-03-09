import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { api, type PromptFileEntry } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function FileTreeItem({
  entry,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: PromptFileEntry;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isSelected = entry.type === "file" && entry.path === selectedPath;

  if (entry.type === "directory") {
    return (
      <div>
        <button
          type="button"
          className="w-full text-left px-2 py-1 text-sm hover:bg-muted rounded flex items-center gap-1"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-muted-foreground">{expanded ? "\u25BE" : "\u25B8"}</span>
          <span className="font-medium">{entry.name}</span>
        </button>
        {expanded && entry.children?.map((child) => (
          <FileTreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`w-full text-left px-2 py-1 text-sm rounded truncate ${
        isSelected
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted"
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onSelect(entry.path)}
    >
      {entry.name}
    </button>
  );
}

export function PromptsPage() {
  const [tree, setTree] = useState<PromptFileEntry[]>([]);
  const [promptsDir, setPromptsDir] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState("");

  const loadTree = useCallback(async () => {
    try {
      const result = await api.listPrompts();
      setTree(result.tree);
      setPromptsDir(result.promptsDir);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const loadFile = async (path: string) => {
    setSelectedPath(path);
    setLoading(true);
    setSaveSuccess(false);
    try {
      const result = await api.getPrompt(path);
      setContent(result.content);
      setOriginalContent(result.content);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedPath) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      const result = await api.updatePrompt(selectedPath, content);
      setOriginalContent(result.content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setContent(originalContent);
  };

  const hasChanges = content !== originalContent;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">提示词模板</h1>
        {promptsDir && (
          <Badge variant="outline" className="font-mono text-xs">
            {promptsDir}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" style={{ minHeight: "70vh" }}>
        {/* File tree */}
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">模板树</CardTitle>
            </CardHeader>
            <CardContent className="p-2 overflow-auto max-h-[70vh]">
              {tree.map((entry) => (
                <FileTreeItem
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={loadFile}
                />
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* Editor */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {selectedPath || "请选择一个模板"}
                </CardTitle>
                {selectedPath && (
                  <div className="flex items-center gap-2">
                    {hasChanges && (
                      <Button variant="ghost" size="sm" onClick={handleReset}>
                        重置
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={saving || !hasChanges}
                    >
                      {saving ? "保存中..." : "保存"}
                    </Button>
                    {saveSuccess && (
                      <span className="text-sm text-green-600">已保存</span>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-muted-foreground">加载中...</p>
              ) : selectedPath ? (
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="font-mono text-sm min-h-[60vh] resize-none"
                  spellCheck={false}
                />
              ) : (
                <div className="flex items-center justify-center min-h-[60vh]">
                  <p className="text-muted-foreground">
                    从左侧模板树选择文件后可查看与编辑。
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
