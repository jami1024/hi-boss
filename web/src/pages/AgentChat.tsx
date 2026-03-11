import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ProjectSummary } from "@/api/client";
import { MessageBubble, type ChatMessageData } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";
import {
  type AgentWsStatus,
  type ChatMessage,
  useWebSocket,
} from "@/hooks/useWebSocket";

function stateLabel(state: string): string {
  if (state === "running") return "运行中";
  if (state === "idle") return "空闲";
  if (state === "stopped") return "已停止";
  return "未知";
}

export function AgentChatPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  const [agentRole, setAgentRole] = useState<string | null>(null);
  const [boundProjects, setBoundProjects] = useState<ProjectSummary[]>([]);
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;
  const sendLockRef = useRef(false);

  // Track message IDs to avoid duplicates
  const messageIdsRef = useRef(new Set<string>());
  const pendingLocalMessageIdsRef = useRef(new Map<string, string>());

  const addMessage = useCallback((msg: ChatMessage) => {
    if (messageIdsRef.current.has(msg.id)) return;
    messageIdsRef.current.add(msg.id);
    setMessages((prev) => {
      const merged = [...prev, msg];
      merged.sort((a, b) => a.createdAt - b.createdAt);
      return merged;
    });
  }, []);

  const removeMessage = useCallback((id: string) => {
    messageIdsRef.current.delete(id);
    setMessages((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleWsMessage = useCallback(
    (msg: ChatMessage) => {
      if (msg.clientMessageId) {
        const localId = pendingLocalMessageIdsRef.current.get(msg.clientMessageId);
        if (localId) {
          pendingLocalMessageIdsRef.current.delete(msg.clientMessageId);
          removeMessage(localId);
        }
      }
      addMessage(msg);
    },
    [addMessage, removeMessage]
  );

  const handleWsError = useCallback((err: string) => {
    console.warn("WebSocket 错误:", err);
  }, []);

  const feedAgentNames = useMemo(() => (name ? [name] : []), [name]);
  const {
    status: daemonStatus,
    mergeAgentStatus,
  } = useDaemonStatusFeed({
    pollMs: 5000,
    agentNamesOverride: feedAgentNames,
    websocketEnabled: false,
  });
  const agentStatus = useMemo(
    () => daemonStatus?.agents.find((agent) => agent.name === name),
    [daemonStatus, name]
  );

  const handleStatusUpdate = useCallback((status: AgentWsStatus) => {
    if (!name) return;
    mergeAgentStatus(name, status);
  }, [mergeAgentStatus, name]);

  const { connected, authenticated, sendMessage: wsSend } = useWebSocket({
    agentName: name ?? "",
    onMessage: handleWsMessage,
    onStatusUpdate: handleStatusUpdate,
    onError: handleWsError,
  });

  // Load initial messages
  useEffect(() => {
    if (!name) return;
    let cancelled = false;

    const load = async () => {
      try {
        // Check agent role first
        const detail = await api.getAgentStatus(name);
        if (cancelled) return;
        setAgentRole(detail.agent.role);
        if (detail.agent.role !== "speaker") {
          setBoundProjects([]);
          setLoading(false);
          return;
        }

        const { projects } = await api.listProjects({ limit: 500 });
        if (cancelled) return;
        const nextBoundProjects = projects.filter((project) => project.speakerAgent === detail.agent.name);
        setBoundProjects(nextBoundProjects);
        if (nextBoundProjects.length > 0) {
          messageIdsRef.current.clear();
          pendingLocalMessageIdsRef.current.clear();
          setMessages([]);
          setLoading(false);
          return;
        }

        const { messages: msgs } = await api.getChatMessages(name, {
          limit: 100,
        });
        if (cancelled) return;

        messageIdsRef.current.clear();
        pendingLocalMessageIdsRef.current.clear();
        for (const m of msgs) {
          messageIdsRef.current.add(m.id);
        }
        setMessages(msgs);
        setLoading(false);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    load();

    // Poll for new messages (fallback for when WebSocket is not connected)
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [name]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!lastMessageId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  const handleSend = async () => {
    if (!name || !input.trim() || sendLockRef.current || boundProjects.length > 0) return;

    const text = input.trim();
    setInput("");
    sendLockRef.current = true;
    setSending(true);

    try {
      if (authenticated) {
        const clientMessageId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const localId = `local:${clientMessageId}`;
        pendingLocalMessageIdsRef.current.set(clientMessageId, localId);
        addMessage({
          id: localId,
          from: "channel:web:boss",
          to: `agent:${name}`,
          fromBoss: true,
          text,
          status: "pending",
          createdAt: Date.now(),
          clientMessageId,
        });

        const sentViaWs = wsSend(text, clientMessageId);
        if (!sentViaWs) {
          pendingLocalMessageIdsRef.current.delete(clientMessageId);
          removeMessage(localId);
          await api.sendChatMessage(name, text);
          const { messages: msgs } = await api.getChatMessages(name, {
            limit: 100,
          });
          messageIdsRef.current.clear();
          pendingLocalMessageIdsRef.current.clear();
          for (const m of msgs) {
            messageIdsRef.current.add(m.id);
          }
          setMessages(msgs);
        }
      } else {
        await api.sendChatMessage(name, text);
        // Reload messages
        const { messages: msgs } = await api.getChatMessages(name, {
          limit: 100,
        });
        messageIdsRef.current.clear();
        pendingLocalMessageIdsRef.current.clear();
        for (const m of msgs) {
          messageIdsRef.current.add(m.id);
        }
        setMessages(msgs);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/agents")}
        >
          返回智能体列表
        </Button>
      </div>
    );
  }

  if (!loading && agentRole !== "speaker") {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-muted-foreground">
          领队智能体不支持直接聊天。
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          只有发言智能体支持直聊，领队智能体通过项目编排接收任务。
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate(`/agents/${encodeURIComponent(name ?? "")}`)}
        >
          返回智能体详情
        </Button>
      </div>
    );
  }

  if (!loading && boundProjects.length > 0) {
    return (
      <div className="p-6 text-center py-12 space-y-3">
        <p className="text-muted-foreground">
          发言智能体 <span className="font-semibold">{name}</span> 已绑定项目聊天。
        </p>
        <p className="text-sm text-muted-foreground">
          请从下方项目聊天室进入，不再使用直连智能体聊天。
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          {boundProjects.map((project) => (
            <Button
              key={project.id}
              variant="outline"
              size="sm"
              onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/chat`)}
            >
              {project.name} ({project.id})
            </Button>
          ))}
        </div>
        <div>
          <Button
            variant="ghost"
            onClick={() => navigate(`/agents/${encodeURIComponent(name ?? "")}`)}
          >
            返回智能体详情
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/agents/${encodeURIComponent(name ?? "")}`)}
          >
            &larr;
          </Button>
          <h2 className="text-lg font-semibold">与 {name} 对话</h2>
          {agentStatus && (
            <Badge
              variant={
                agentStatus.state === "running" ? "default" : "secondary"
              }
            >
              {stateLabel(agentStatus.state)}
            </Badge>
          )}
          {agentStatus?.currentRun?.projectId && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {agentStatus.currentRun.projectId}
            </Badge>
          )}
        </div>
        <ConnectionStatus connected={connected} authenticated={authenticated} />
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
      >
        {loading ? (
          <p className="text-center text-muted-foreground">
            加载消息中...
          </p>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Card className="max-w-sm">
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">
                  还没有消息，发送第一条消息与{" "}
                  <span className="font-semibold">{name}</span>.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg as ChatMessageData} agentName={name} />
          ))
        )}
        {name && <TypingIndicator agentName={name} visible={agentStatus?.state === "running"} />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border/60 bg-background/85 p-4 backdrop-blur-sm">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`发送给 ${name}...（回车发送，Shift+回车换行）`}
            rows={1}
            className="min-h-[40px] max-h-[120px] resize-none"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="self-end"
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
