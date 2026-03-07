import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import {
  useWebSocket,
  type ChatMessage,
  type AgentWsStatus,
} from "@/hooks/useWebSocket";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [agentStatus, setAgentStatus] = useState<AgentWsStatus | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);

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

  const handleStatusUpdate = useCallback((status: AgentWsStatus) => {
    setAgentStatus(status);
  }, []);

  const handleWsError = useCallback((err: string) => {
    console.warn("WebSocket error:", err);
  }, []);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!name || !input.trim() || sending) return;

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
                agentStatus.agentState === "running" ? "default" : "secondary"
              }
            >
              {agentStatus.agentState}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              connected && authenticated
                ? "bg-green-500"
                : connected
                  ? "bg-yellow-500"
                  : "bg-red-500"
            )}
          />
          <span>
            {connected && authenticated
              ? "Live"
              : connected
                ? "Connecting..."
                : "Offline"}
          </span>
        </div>
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
