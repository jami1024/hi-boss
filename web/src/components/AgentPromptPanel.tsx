import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AgentPromptPanelProps {
  agentName: string;
}

export function AgentPromptPanel({ agentName }: AgentPromptPanelProps) {
  const [promptContent, setPromptContent] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState("");

  const [soulContent, setSoulContent] = useState("");
  const [soulOriginal, setSoulOriginal] = useState("");
  const [soulLoading, setSoulLoading] = useState(false);
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulError, setSoulError] = useState("");
  const [soulSaveSuccess, setSoulSaveSuccess] = useState(false);

  const loadPrompt = useCallback(async () => {
    setPromptLoading(true);
    setPromptError("");
    try {
      const result = await api.getAgentPrompt(agentName);
      setPromptContent(result.prompt);
    } catch (err) {
      setPromptError((err as Error).message);
    } finally {
      setPromptLoading(false);
    }
  }, [agentName]);

  const loadSoul = useCallback(async () => {
    setSoulLoading(true);
    setSoulError("");
    try {
      const result = await api.getAgentSoul(agentName);
      setSoulContent(result.content);
      setSoulOriginal(result.content);
    } catch (err) {
      setSoulError((err as Error).message);
    } finally {
      setSoulLoading(false);
    }
  }, [agentName]);

  useEffect(() => {
    loadPrompt();
    loadSoul();
  }, [loadPrompt, loadSoul]);

  const handleSaveSoul = async () => {
    setSoulSaving(true);
    setSoulError("");
    setSoulSaveSuccess(false);
    try {
      await api.updateAgentSoul(agentName, soulContent);
      setSoulOriginal(soulContent);
      setSoulSaveSuccess(true);
      setTimeout(() => setSoulSaveSuccess(false), 2000);
      await loadPrompt();
    } catch (err) {
      setSoulError((err as Error).message);
    } finally {
      setSoulSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* SOUL.md Editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SOUL.md — 智能体个性化指令</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            编辑 <code>~/hiboss/agents/{agentName}/SOUL.md</code>，自定义该智能体的性格、行为偏好或额外指令。
            内容会注入到系统提示词的身份段落中。
          </p>
          {soulLoading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : (
            <>
              <Textarea
                value={soulContent}
                onChange={(e) => setSoulContent(e.target.value)}
                placeholder={"示例：你是一个严谨细致的代码审查专家，回复时使用中文。\n偏好：简洁、直接，避免冗余。"}
                rows={8}
                className="font-mono text-sm"
              />
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={handleSaveSoul}
                  disabled={soulSaving || soulContent === soulOriginal}
                >
                  {soulSaving ? "保存中..." : "保存 SOUL.md"}
                </Button>
                {soulSaveSuccess && (
                  <span className="text-sm text-green-600">已保存</span>
                )}
                {soulError && (
                  <span className="text-sm text-destructive">{soulError}</span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Rendered Prompt Preview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">渲染后的系统提示词（只读）</CardTitle>
          <Button variant="outline" size="sm" onClick={loadPrompt} disabled={promptLoading}>
            {promptLoading ? "加载中..." : "刷新预览"}
          </Button>
        </CardHeader>
        <CardContent>
          {promptError ? (
            <p className="text-sm text-destructive">{promptError}</p>
          ) : promptLoading && !promptContent ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : promptContent ? (
            <pre className="text-xs whitespace-pre-wrap bg-muted p-4 rounded-md max-h-[600px] overflow-y-auto font-mono">
              {promptContent}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">加载中...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
