import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type Conversation, type ConversationMessage, type ProjectSummary } from "@/api/client";
import { MessageBubble, type ChatMessageData } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ConversationList } from "@/components/chat/ConversationList";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type AgentWsStatus, useWebSocket } from "@/hooks/useWebSocket";

export function ProjectChatPage() {
  const { id, conversationId } = useParams<{ id: string; conversationId?: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [destructiveConfirm, setDestructiveConfirm] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendLockRef = useRef(false);
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;

  // Load project info
  useEffect(() => {
    if (!id) return;
    api.getProject(id).then((res) => setProject(res.project)).catch(() => undefined);
  }, [id]);

  // Load conversation and its messages
  const loadConversation = useCallback(async () => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      const [convRes, msgsRes] = await Promise.all([
        api.getConversation(conversationId),
        api.listConversationMessages(conversationId, { limit: 100 }),
      ]);
      setConversation(convRes.conversation);
      setMessages(msgsRes.messages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    void loadConversation();
  }, [loadConversation]);

  // Poll for new messages
  useEffect(() => {
    if (!conversationId) return;
    const interval = setInterval(() => {
      void loadConversation().catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [conversationId, loadConversation]);

  // WebSocket for real-time updates
  const handleWsMessage = useCallback(() => {
    void loadConversation().catch(() => undefined);
  }, [loadConversation]);

  const handleStatusUpdate = useCallback((status: AgentWsStatus) => {
    setAgentRunning(status.agentState === "running");
  }, []);

  const speakerAgent = project?.speakerAgent ?? conversation?.agentName ?? "";
  const { connected, authenticated } = useWebSocket({
    agentName: speakerAgent,
    enabled: Boolean(speakerAgent && conversationId),
    onMessage: handleWsMessage,
    onStatusUpdate: handleStatusUpdate,
    onError: useCallback((err: string) => console.warn("WS error:", err), []),
  });

  // Auto-scroll
  useEffect(() => {
    if (!lastMessageId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  const handleNewConversation = useCallback(async () => {
    if (!id || !project) return;
    try {
      const conv = await api.createConversation({
        agentName: project.speakerAgent,
        projectId: id,
      });
      navigate(`/projects/${encodeURIComponent(id)}/chat/${encodeURIComponent(conv.id)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id, project, navigate]);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      if (!id) return;
      navigate(`/projects/${encodeURIComponent(id)}/chat/${encodeURIComponent(conv.id)}`);
    },
    [id, navigate]
  );

  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText ?? input.trim();
    if (!conversationId || !textToSend || sendLockRef.current) return;
    if (!overrideText) setInput("");
    sendLockRef.current = true;
    setSending(true);
    try {
      await api.sendConversationMessage(conversationId, textToSend);
      await loadConversation();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message === "destructive-confirmation-required") {
        setDestructiveConfirm(textToSend);
      } else {
        setError((err as Error).message);
      }
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  const handleDestructiveConfirm = () => {
    if (!destructiveConfirm) return;
    const text = destructiveConfirm;
    setDestructiveConfirm(null);
    void handleSend(`确认执行：${text}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleGrantAccess = useCallback(
    async (msg: import("@/components/chat/MessageBubble").ChatMessageData) => {
      if (!conversationId) return;

      // Find the original boss message that triggered the failed run.
      // The failure envelope's replyToEnvelopeId points to the boss message.
      let retryText: string | undefined;
      if (msg.replyToEnvelopeId) {
        const original = messages.find((m) => m.id === msg.replyToEnvelopeId);
        if (original) {
          retryText = original.text;
        }
      }

      await api.grantConversationAccess(conversationId, retryText);
      await loadConversation();
    },
    [conversationId, messages, loadConversation]
  );

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate(`/projects/${encodeURIComponent(id ?? "")}`)}
        >
          返回项目
        </Button>
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full">
      {/* Conversation sidebar */}
      {project && (
        <ConversationList
          agentName={project.speakerAgent}
          projectId={id}
          activeConversationId={conversationId}
          onSelect={handleSelectConversation}
          onNew={() => void handleNewConversation()}
        />
      )}

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/projects/${encodeURIComponent(id ?? "")}`)}
            >
              &larr;
            </Button>
            <h2 className="text-lg font-semibold">
              {conversation?.title || (project ? `${project.name} 聊天` : "项目聊天")}
            </h2>
            {project && <Badge variant="outline">经由 {project.speakerAgent}</Badge>}
          </div>
          <ConnectionStatus connected={connected} authenticated={authenticated} />
        </div>

        {/* Messages */}
        {!conversationId ? (
          <div className="flex flex-1 items-center justify-center">
            <Card className="max-w-sm">
              <CardContent className="pt-6 text-center space-y-3">
                <p className="text-muted-foreground">选择一个对话或创建新对话开始聊天</p>
                <Button onClick={() => void handleNewConversation()} disabled={!project}>
                  新建对话
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
              {loading ? (
                <p className="text-center text-muted-foreground">加载消息中...</p>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <Card className="max-w-sm">
                    <CardContent className="pt-6 text-center">
                      <p className="text-muted-foreground">
                        还没有消息，发送第一条消息开始对话。
                      </p>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg as ChatMessageData}
                    agentName={speakerAgent}
                    onGrantAccess={handleGrantAccess}
                  />
                ))
              )}
              {speakerAgent && (
                <TypingIndicator agentName={speakerAgent} visible={agentRunning} />
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border/60 bg-background/85 p-4 backdrop-blur-sm">
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="发送消息...（回车发送，Shift+回车换行）"
                  rows={1}
                  className="min-h-[40px] max-h-[120px] resize-none"
                />
                <Button
                  onClick={() => void handleSend()}
                  disabled={!input.trim() || sending}
                  className="self-end"
                >
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

    <Dialog open={destructiveConfirm !== null} onOpenChange={(open) => { if (!open) setDestructiveConfirm(null); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>高风险操作确认</DialogTitle>
          <DialogDescription>
            检测到可能的破坏性操作（删除/清空/重置），请确认是否继续执行：
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">
          {destructiveConfirm}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDestructiveConfirm(null)}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleDestructiveConfirm}>
            确认执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
