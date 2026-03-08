import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type ProjectSummary } from "@/api/client";
import {
  useWebSocket,
  type ChatMessage,
  type AgentWsStatus,
} from "@/hooks/useWebSocket";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { cn } from "@/lib/utils";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isBoss = msg.fromBoss || msg.from === "channel:web:boss";

  return (
    <div className={cn("flex", isBoss ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-4 py-2 text-sm",
          isBoss
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
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
          {msg.status === "pending" && (
            <span className="italic">sending...</span>
          )}
        </div>
      </div>
    </div>
  );
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

  // Track message IDs to avoid duplicates
  const messageIdsRef = useRef(new Set<string>());

  const addMessage = useCallback((msg: ChatMessage) => {
    if (messageIdsRef.current.has(msg.id)) return;
    messageIdsRef.current.add(msg.id);
    setMessages((prev) => {
      const merged = [...prev, msg];
      merged.sort((a, b) => a.createdAt - b.createdAt);
      return merged;
    });
  }, []);

  const handleWsMessage = useCallback(
    (msg: ChatMessage) => {
      addMessage(msg);
    },
    [addMessage]
  );

  const handleWsError = useCallback((err: string) => {
    console.warn("WebSocket error:", err);
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
          setMessages([]);
          setLoading(false);
          return;
        }

        const { messages: msgs } = await api.getChatMessages(name, {
          limit: 100,
        });
        if (cancelled) return;

        messageIdsRef.current.clear();
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
    if (!name || !input.trim() || sending || boundProjects.length > 0) return;

    const text = input.trim();
    setInput("");
    setSending(true);

    try {
      if (authenticated) {
        wsSend(text);
      } else {
        await api.sendChatMessage(name, text);
        // Reload messages
        const { messages: msgs } = await api.getChatMessages(name, {
          limit: 100,
        });
        messageIdsRef.current.clear();
        for (const m of msgs) {
          messageIdsRef.current.add(m.id);
        }
        setMessages(msgs);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
        <p className="text-destructive">Error: {error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/agents")}
        >
          Back to Agents
        </Button>
      </div>
    );
  }

  if (!loading && agentRole !== "speaker") {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-muted-foreground">
          Leader agents cannot be chatted with directly.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Only speaker agents support direct chat. Leader agents receive tasks through project orchestration.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate(`/agents/${encodeURIComponent(name ?? "")}`)}
        >
          Back to Agent
        </Button>
      </div>
    );
  }

  if (!loading && boundProjects.length > 0) {
    return (
      <div className="p-6 text-center py-12 space-y-3">
        <p className="text-muted-foreground">
          Speaker <span className="font-semibold">{name}</span> is bound to project chat.
        </p>
        <p className="text-sm text-muted-foreground">
          Open one of the project chat rooms below instead of using direct agent chat.
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
            Back to Agent
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/agents/${encodeURIComponent(name ?? "")}`)}
          >
            &larr;
          </Button>
          <h2 className="text-lg font-semibold">Chat with {name}</h2>
          {agentStatus && (
            <Badge
              variant={
                agentStatus.state === "running" ? "default" : "secondary"
              }
            >
              {agentStatus.state}
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
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {loading ? (
          <p className="text-center text-muted-foreground">
            Loading messages...
          </p>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Card className="max-w-sm">
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">
                  No messages yet. Send a message to start chatting with{" "}
                  <span className="font-semibold">{name}</span>.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${name}... (Enter to send, Shift+Enter for newline)`}
            rows={1}
            className="min-h-[40px] max-h-[120px] resize-none"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="self-end"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
