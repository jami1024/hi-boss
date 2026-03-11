import { useCallback, useEffect, useState } from "react";
import { api, type Conversation } from "@/api/client";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Pencil, Trash2, Check, X } from "lucide-react";

interface ConversationListProps {
  agentName: string;
  projectId?: string;
  activeConversationId?: string;
  onSelect: (conversation: Conversation) => void;
  onNew: () => void;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  if (isYesterday) {
    return "昨天";
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function ConversationList({
  agentName,
  projectId,
  activeConversationId,
  onSelect,
  onNew,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.listConversations({ agentName, projectId, limit: 50 });
      setConversations(res.conversations);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [agentName, projectId]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await api.updateConversation(id, { title: editTitle.trim() });
      await load();
    } catch {
      // ignore
    }
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteConversation(id);
      await load();
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-border/60 bg-sidebar">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">
          对话列表
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNew} title="新建对话">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">加载中...</p>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">暂无对话</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onNew}>
              开始新对话
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5 p-1.5">
            {conversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              const isEditing = editingId === conv.id;

              return (
                <div
                  key={conv.id}
                  className={`group relative flex items-center rounded-md px-2.5 py-2 text-sm transition-colors cursor-pointer ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                  }`}
                  onClick={() => !isEditing && onSelect(conv)}
                >
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRename(conv.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-6 w-full rounded border border-border bg-background px-1.5 text-xs"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleRename(conv.id); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="truncate text-[13px] font-medium leading-tight">
                          {conv.title || "新对话"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatTime(conv.updatedAt)}
                        </p>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(conv.id);
                          setEditTitle(conv.title || "");
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                        title="重命名"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(conv.id);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
