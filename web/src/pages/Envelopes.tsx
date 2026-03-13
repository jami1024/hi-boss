import { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
  Filter,
  Inbox,
  Link2,
  MessageCircle,
  MessageSquareReply,
  Paperclip,
  RefreshCw,
  Search,
  Shield,
} from "lucide-react";
import { api, type EnvelopeSummary, type EnvelopeDetail } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatTime(ms: number | null | undefined): string {
  if (!ms) return "--";
  const d = new Date(ms);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) return d.toLocaleTimeString();
  return d.toLocaleString();
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

function formatAddress(addr: string): string {
  if (addr.startsWith("agent:")) return addr.slice(6);
  if (addr.startsWith("channel:")) {
    const parts = addr.split(":");
    return `${parts[1]}:${parts.slice(2).join(":")}`;
  }
  return addr;
}

function addressType(addr: string): "agent" | "channel" | "other" {
  if (addr.startsWith("agent:")) return "agent";
  if (addr.startsWith("channel:")) return "channel";
  return "other";
}

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

/** Extract conversationId from envelope metadata */
function getConversationId(env: EnvelopeSummary): string | undefined {
  const cid = env.metadata?.conversationId;
  return typeof cid === "string" && cid.trim() ? cid.trim() : undefined;
}

/** Extract replyToEnvelopeId from envelope metadata */
function getReplyToId(env: EnvelopeSummary): string | undefined {
  const rid = env.metadata?.replyToEnvelopeId;
  return typeof rid === "string" && rid.trim() ? rid.trim() : undefined;
}

/** A conversation thread groups envelopes sharing the same conversationId */
interface ConversationThread {
  conversationId: string;
  envelopes: EnvelopeSummary[];
}

const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.02, duration: 0.15 },
  }),
};

export function EnvelopesPage() {
  const [envelopes, setEnvelopes] = useState<EnvelopeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [viewMode, setViewMode] = useState<"flat" | "threaded">("threaded");

  // Detail dialog
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadEnvelopes = useCallback(async (before?: number) => {
    setLoading(true);
    try {
      const opts: { status?: string; agent?: string; limit?: number; before?: number } = {
        limit: 50,
      };
      if (statusFilter !== "all") opts.status = statusFilter;
      if (agentFilter.trim()) opts.agent = agentFilter.trim();
      if (before) opts.before = before;

      const result = await api.listEnvelopes(opts);

      if (before) {
        setEnvelopes((prev) => [...prev, ...result.envelopes]);
      } else {
        setEnvelopes(result.envelopes);
      }
      setTotal(result.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, agentFilter]);

  useEffect(() => {
    loadEnvelopes();
  }, [loadEnvelopes]);

  const handleLoadMore = () => {
    const last = envelopes[envelopes.length - 1];
    if (last) loadEnvelopes(last.createdAt);
  };

  const handleViewDetail = async (id: string) => {
    try {
      const result = await api.getEnvelope(id);
      setSelectedEnvelope(result.envelope);
      setDetailOpen(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Client-side text search
  const displayed = useMemo(() => {
    if (!textSearch.trim()) return envelopes;
    const q = textSearch.toLowerCase();
    return envelopes.filter(
      (env) =>
        env.text?.toLowerCase().includes(q) ||
        env.from.toLowerCase().includes(q) ||
        env.to.toLowerCase().includes(q) ||
        shortId(env.id).includes(q),
    );
  }, [envelopes, textSearch]);

  // Build conversation threads
  const { threads, standalone } = useMemo(() => {
    if (viewMode !== "threaded") return { threads: [], standalone: displayed };

    const convMap = new Map<string, EnvelopeSummary[]>();
    const standaloneList: EnvelopeSummary[] = [];
    const envelopeMap = new Map<string, EnvelopeSummary>();

    // Index all envelopes by id
    for (const env of displayed) {
      envelopeMap.set(env.id, env);
    }

    // Group by conversationId
    for (const env of displayed) {
      const cid = getConversationId(env);
      if (cid) {
        const list = convMap.get(cid);
        if (list) {
          list.push(env);
        } else {
          convMap.set(cid, [env]);
        }
      } else {
        standaloneList.push(env);
      }
    }

    // Build threads (only groups with >1 envelope are true threads)
    const threadList: ConversationThread[] = [];
    for (const [cid, envs] of convMap) {
      if (envs.length > 1) {
        // Sort newest first within thread
        envs.sort((a, b) => b.createdAt - a.createdAt);
        threadList.push({ conversationId: cid, envelopes: envs });
      } else {
        standaloneList.push(envs[0]);
      }
    }

    // Sort threads by most recent envelope (desc)
    threadList.sort((a, b) => {
      const aLatest = a.envelopes[a.envelopes.length - 1].createdAt;
      const bLatest = b.envelopes[b.envelopes.length - 1].createdAt;
      return bLatest - aLatest;
    });

    // Sort standalone by createdAt desc
    standaloneList.sort((a, b) => b.createdAt - a.createdAt);

    return { threads: threadList, standalone: standaloneList };
  }, [displayed, viewMode]);

  const pendingCount = envelopes.filter((e) => e.status === "pending").length;
  const doneCount = envelopes.filter((e) => e.status === "done").length;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">信封</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            追踪智能体间的消息路由与投递状态。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="gap-1">
              <Inbox className="size-3" />
              共 {total} 条
            </Badge>
            {pendingCount > 0 && (
              <Badge variant="default" className="gap-1">
                <Clock className="size-3" />
                {pendingCount} 待处理
              </Badge>
            )}
            {doneCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                {doneCount} 已完成
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
        <Filter className="size-4 text-muted-foreground shrink-0" />
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索内容、地址或 ID..."
            value={textSearch}
            onChange={(e) => setTextSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pending">待处理</SelectItem>
            <SelectItem value="done">已完成</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="按智能体筛选..."
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-40 h-9"
        />
        <div className="flex items-center rounded-lg border border-border/60 overflow-hidden">
          <button
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "threaded" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setViewMode("threaded")}
          >
            <MessageCircle className="size-3.5 inline-block mr-1 -mt-0.5" />
            对话
          </button>
          <button
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "flat" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setViewMode("flat")}
          >
            列表
          </button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadEnvelopes()}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* Content */}
      {viewMode === "threaded" ? (
        <ThreadedView
          threads={threads}
          standalone={standalone}
          loading={loading}
          textSearch={textSearch}
          onViewDetail={handleViewDetail}
        />
      ) : (
        <FlatView
          envelopes={displayed}
          loading={loading}
          textSearch={textSearch}
          onViewDetail={handleViewDetail}
        />
      )}

      {envelopes.length > 0 && envelopes.length < total && (
        <div className="text-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={loading} className="gap-1.5">
            加载更多（已加载 {envelopes.length} / {total}）
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <EnvelopeDetailDialog
        envelope={selectedEnvelope}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        allEnvelopes={envelopes}
        onViewDetail={handleViewDetail}
      />
    </div>
  );
}

/* ---- Threaded view ---- */

function ThreadedView({
  threads,
  standalone,
  loading,
  textSearch,
  onViewDetail,
}: {
  threads: ConversationThread[];
  standalone: EnvelopeSummary[];
  loading: boolean;
  textSearch: string;
  onViewDetail: (id: string) => void;
}) {
  const isEmpty = threads.length === 0 && standalone.length === 0;

  return (
    <div className="space-y-4">
      {/* Conversation threads */}
      {threads.map((thread, ti) => (
        <motion.div
          key={thread.conversationId}
          custom={ti}
          initial="hidden"
          animate="visible"
          variants={rowVariants}
        >
          <div className="rounded-xl border border-border/60 overflow-hidden">
            {/* Thread header */}
            <div className="flex items-center gap-2 px-4 py-2 bg-muted/40 border-b border-border/30">
              <MessageCircle className="size-3.5 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">
                对话 {shortId(thread.conversationId)}
              </span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {thread.envelopes.length} 条消息
              </Badge>
            </div>

            {/* Thread messages */}
            <div className="divide-y divide-border/20">
              {thread.envelopes.map((env, i) => (
                <EnvelopeRow
                  key={env.id}
                  env={env}
                  index={i}
                  isInThread
                  isQuestion={env.fromBoss}
                  onViewDetail={onViewDetail}
                />
              ))}
            </div>
          </div>
        </motion.div>
      ))}

      {/* Standalone envelopes */}
      {standalone.length > 0 && threads.length > 0 && (
        <div className="flex items-center gap-2 pt-2">
          <div className="h-px flex-1 bg-border/40" />
          <span className="text-xs text-muted-foreground">独立信封</span>
          <div className="h-px flex-1 bg-border/40" />
        </div>
      )}

      {standalone.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="divide-y divide-border/30">
            {standalone.map((env, i) => (
              <EnvelopeRow
                key={env.id}
                env={env}
                index={i}
                isInThread={false}
                onViewDetail={onViewDetail}
              />
            ))}
          </div>
        </div>
      )}

      <EmptyState isEmpty={isEmpty} loading={loading} textSearch={textSearch} />
    </div>
  );
}

/* ---- Flat view ---- */

function FlatView({
  envelopes,
  loading,
  textSearch,
  onViewDetail,
}: {
  envelopes: EnvelopeSummary[];
  loading: boolean;
  textSearch: string;
  onViewDetail: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[minmax(0,1fr)_140px_100px_120px] gap-4 px-4 py-2.5 bg-muted/40 text-xs font-medium text-muted-foreground border-b border-border/40">
        <span>路由</span>
        <span>内容预览</span>
        <span className="text-center">状态</span>
        <span className="text-right">时间</span>
      </div>

      <div className="divide-y divide-border/30">
        {envelopes.map((env, i) => (
          <EnvelopeRow
            key={env.id}
            env={env}
            index={i}
            isInThread={false}
            onViewDetail={onViewDetail}
          />
        ))}
      </div>

      <EmptyState isEmpty={envelopes.length === 0} loading={loading} textSearch={textSearch} />
    </div>
  );
}

/* ---- Shared row component ---- */

function EnvelopeRow({
  env,
  index,
  isInThread,
  isQuestion,
  onViewDetail,
}: {
  env: EnvelopeSummary;
  index: number;
  isInThread: boolean;
  isQuestion?: boolean;
  onViewDetail: (id: string) => void;
}) {
  const replyToId = getReplyToId(env);

  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="visible"
      variants={rowVariants}
    >
      <div
        className={`grid grid-cols-[minmax(0,1fr)_140px_100px_120px] gap-4 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/30 group ${isInThread ? "pl-5" : ""}`}
        onClick={() => onViewDetail(env.id)}
      >
        {/* Route: from -> to */}
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isInThread && isQuestion !== undefined && (
              <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold mr-0.5 ${
                isQuestion
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}>
                {isQuestion ? (
                  <><MessageCircle className="size-2.5" />问</>
                ) : (
                  <><MessageSquareReply className="size-2.5" />答</>
                )}
              </span>
            )}
            <AddressChip addr={env.from} />
            <ArrowRight className="size-3 text-muted-foreground shrink-0" />
            <AddressChip addr={env.to} />
            {env.fromBoss && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 border-amber-500/40 text-amber-600 dark:text-amber-400">
                <Shield className="size-2.5" />
                Boss
              </Badge>
            )}
            {env.hasAttachments && (
              <Paperclip className="size-3 text-muted-foreground" />
            )}
            {replyToId && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`回复 ${shortId(replyToId)}`}>
                <Link2 className="size-2.5" />
                {shortId(replyToId)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {shortId(env.id)}
          </p>
        </div>

        {/* Text preview */}
        <p className="text-sm text-muted-foreground truncate self-center">
          {env.text || "（无文本）"}
        </p>

        {/* Status */}
        <div className="flex items-center justify-center">
          <StatusDot status={env.status} />
        </div>

        {/* Time */}
        <div className="text-right self-center">
          <p className="text-xs text-foreground">{formatRelativeTime(env.createdAt)}</p>
          <p className="text-[10px] text-muted-foreground">{formatTime(env.createdAt)}</p>
        </div>
      </div>
    </motion.div>
  );
}

/* ---- Empty / loading states ---- */

function EmptyState({ isEmpty, loading, textSearch }: { isEmpty: boolean; loading: boolean; textSearch: string }) {
  if (loading) {
    return (
      <div className="text-center py-8">
        <RefreshCw className="size-5 text-muted-foreground animate-spin mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }
  if (!isEmpty) return null;
  return (
    <div className="text-center py-16">
      <Inbox className="size-10 text-muted-foreground/40 mx-auto mb-3" />
      <p className="text-muted-foreground">
        {textSearch.trim() ? "没有匹配的信封。" : "没有找到信封。"}
      </p>
    </div>
  );
}

/* ---- Sub-components ---- */

function AddressChip({ addr }: { addr: string }) {
  const type = addressType(addr);
  const label = formatAddress(addr);
  const colors =
    type === "agent"
      ? "bg-primary/10 text-primary border-primary/20"
      : type === "channel"
        ? "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20"
        : "bg-muted text-muted-foreground border-border";

  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${colors}`}>
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        </span>
        待处理
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <span className="inline-flex size-2 rounded-full bg-emerald-500" />
      已完成
    </span>
  );
}

/* ---- Detail dialog ---- */

function EnvelopeDetailDialog({
  envelope,
  open,
  onOpenChange,
  allEnvelopes,
  onViewDetail,
}: {
  envelope: EnvelopeDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allEnvelopes: EnvelopeSummary[];
  onViewDetail: (id: string) => void;
}) {
  if (!envelope) return null;

  const md = envelope.metadata as Record<string, unknown> | undefined;
  const conversationId = typeof md?.conversationId === "string" ? md.conversationId : undefined;
  const replyToId = typeof md?.replyToEnvelopeId === "string" ? md.replyToEnvelopeId : undefined;

  // Find related envelopes in the same conversation
  const relatedEnvelopes = conversationId
    ? allEnvelopes
        .filter((e) => getConversationId(e) === conversationId && e.id !== envelope.id)
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>信封详情</span>
            <Badge variant="outline" className="font-mono text-xs">
              {shortId(envelope.id)}
            </Badge>
            <StatusDot status={envelope.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Route visualization */}
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
            <div className="text-center flex-1">
              <p className="text-[10px] text-muted-foreground mb-1">来源</p>
              <AddressChip addr={envelope.from} />
            </div>
            <ArrowRight className="size-4 text-muted-foreground shrink-0" />
            <div className="text-center flex-1">
              <p className="text-[10px] text-muted-foreground mb-1">目标</p>
              <AddressChip addr={envelope.to} />
            </div>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
            <DetailRow label="ID" value={<span className="font-mono text-xs">{envelope.id}</span>} />
            <DetailRow label="来自 Boss" value={envelope.fromBoss ? "是" : "否"} />
            <DetailRow label="创建时间" value={formatTime(envelope.createdAt)} />
            {envelope.deliverAt && (
              <DetailRow label="投递时间" value={formatTime(envelope.deliverAt)} />
            )}
            {conversationId && (
              <DetailRow
                label="对话 ID"
                value={
                  <Badge variant="outline" className="font-mono text-xs gap-1">
                    <MessageCircle className="size-3" />
                    {shortId(conversationId)}
                  </Badge>
                }
              />
            )}
            {replyToId && (
              <DetailRow
                label="回复"
                value={
                  <button
                    className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                    onClick={() => {
                      onOpenChange(false);
                      setTimeout(() => onViewDetail(replyToId), 200);
                    }}
                  >
                    <Link2 className="size-3" />
                    {shortId(replyToId)}
                  </button>
                }
              />
            )}
          </div>

          {/* Content */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">内容</p>
            <pre className="text-sm whitespace-pre-wrap break-words bg-muted/40 border border-border/40 p-4 rounded-lg max-h-[40vh] overflow-y-auto">
              {envelope.content?.text || "（无文本）"}
            </pre>
          </div>

          {/* Attachments */}
          {envelope.content?.attachments && envelope.content.attachments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">附件</p>
              <div className="space-y-1.5">
                {envelope.content.attachments.map((att) => (
                  <div key={`${att.source}:${att.filename ?? ""}`} className="flex items-center gap-2 text-sm">
                    <Paperclip className="size-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs">{att.filename || att.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related conversation envelopes */}
          {relatedEnvelopes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                同对话中的其他信封（{relatedEnvelopes.length} 条）
              </p>
              <div className="space-y-1.5 rounded-lg border border-border/40 divide-y divide-border/20 overflow-hidden">
                {relatedEnvelopes.map((rel) => (
                  <button
                    key={rel.id}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      onOpenChange(false);
                      setTimeout(() => onViewDetail(rel.id), 200);
                    }}
                  >
                    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${
                      rel.fromBoss
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    }`}>
                      {rel.fromBoss ? (
                        <><MessageCircle className="size-2.5" />问</>
                      ) : (
                        <><MessageSquareReply className="size-2.5" />答</>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono shrink-0">{shortId(rel.id)}</span>
                    <span className="text-sm truncate flex-1">{rel.text || "（无文本）"}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeTime(rel.createdAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Raw metadata */}
          {envelope.metadata && Object.keys(envelope.metadata).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">元数据</p>
              <pre className="text-xs whitespace-pre-wrap break-words bg-muted/40 border border-border/40 p-4 rounded-lg max-h-[30vh] overflow-y-auto">
                {JSON.stringify(envelope.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
