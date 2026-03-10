import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ProjectChatContext, type ProjectChatMessage } from "@/api/client";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBubble({ msg }: { msg: ProjectChatMessage }) {
  const isBoss = msg.fromBoss || msg.from === "channel:web:boss";
  const pendingHint =
    msg.status !== "pending"
      ? null
      : isBoss
        ? "排队中..."
        : "处理中...";
  return (
    <div className={cn("flex", isBoss ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          isBoss
            ? "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground"
            : "border border-border/70 bg-card text-foreground"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        <div
          className={cn(
            "mt-1 flex items-center gap-2 text-xs",
            isBoss ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          <span>{formatTime(msg.createdAt)}</span>
          {pendingHint && <span className="italic">{pendingHint}</span>}
        </div>
      </div>
    </div>
  );
}

export function ProjectChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectChatContext | null>(null);
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    if (!id) return;
    const response = await api.getProjectChatMessages(id, { limit: 100 });
    setProject(response.project);
    setMessages(response.messages);
  }, [id]);

  const handleWsMessage = useCallback(() => {
    void loadMessages().catch(() => undefined);
  }, [loadMessages]);

  const handleWsError = useCallback((err: string) => {
    console.warn("项目聊天 websocket 错误:", err);
  }, []);

  const { connected, authenticated } = useWebSocket({
    agentName: project?.speakerAgent ?? "",
    enabled: Boolean(project?.speakerAgent),
    onMessage: handleWsMessage,
    onError: handleWsError,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      try {
        await loadMessages();
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    };
    void load();

    const interval = setInterval(() => {
      void loadMessages().catch(() => undefined);
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, loadMessages]);

  const handleSend = async () => {
    if (!id || !input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    try {
      await api.sendProjectChatMessage(id, text);
      await loadMessages();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/projects/${encodeURIComponent(id ?? "")}`)}>
          返回项目
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projects/${encodeURIComponent(id ?? "")}`)}
          >
            &larr;
          </Button>
          <h2 className="text-lg font-semibold">{project ? `聊天：${project.name}` : "项目聊天"}</h2>
          {project && <Badge variant="outline">经由 {project.speakerAgent}</Badge>}
        </div>
        <ConnectionStatus connected={connected} authenticated={authenticated} />
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground border-b">
        {project
          ? `项目路径：${project.root} | 激活领队：${project.availableLeaders.join(", ") || "（无）"}`
          : "加载项目上下文中..."}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-center text-muted-foreground">加载消息中...</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Card className="max-w-sm">
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">还没有消息，发送第一条消息开始项目对话。</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border/60 bg-background/85 p-4 backdrop-blur-sm">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="发送给项目发言智能体...（回车发送，Shift+回车换行）"
            rows={1}
            className="min-h-[40px] max-h-[120px] resize-none"
          />
          <Button onClick={() => void handleSend()} disabled={!input.trim() || sending} className="self-end">
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
