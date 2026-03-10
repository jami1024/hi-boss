import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { api, type EnvelopeSummary, type EnvelopeDetail } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function formatAddress(addr: string): string {
  if (addr.startsWith("agent:")) return addr.slice(6);
  if (addr.startsWith("channel:")) {
    const parts = addr.split(":");
    return `${parts[1]}:${parts.slice(2).join(":")}`;
  }
  return addr;
}

function addressBadgeVariant(addr: string): "default" | "secondary" | "outline" {
  if (addr.startsWith("agent:")) return "default";
  if (addr.startsWith("channel:")) return "secondary";
  return "outline";
}

function statusLabel(status: string): string {
  if (status === "pending") return "待处理";
  if (status === "done") return "已完成";
  return status;
}

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.03, duration: 0.2 },
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
        <h1 className="text-2xl font-bold">信封</h1>
        <Badge variant="outline">共 {total} 条</Badge>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pending">待处理</SelectItem>
            <SelectItem value="done">已完成</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="按智能体名称筛选..."
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-64"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadEnvelopes()}
          disabled={loading}
        >
          刷新
        </Button>
      </div>

      {/* Envelope list */}
      <div className="space-y-2">
        {envelopes.map((env, i) => (
          <motion.div
            key={env.id}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
          >
            <Card
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => handleViewDetail(env.id)}
            >
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={addressBadgeVariant(env.from)} className="text-xs">
                        {formatAddress(env.from)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">&rarr;</span>
                      <Badge variant={addressBadgeVariant(env.to)} className="text-xs">
                        {formatAddress(env.to)}
                      </Badge>
                      {env.fromBoss && (
                        <Badge variant="outline" className="text-xs">
                          Boss
                        </Badge>
                      )}
                      {env.hasAttachments && (
                        <Badge variant="outline" className="text-xs">
                          附件
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {env.text || "（无文本）"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant={env.status === "pending" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {statusLabel(env.status)}
                    </Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(env.createdAt)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {env.id.replace(/-/g, "").slice(0, 8)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {envelopes.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">没有找到信封。</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-4">
          <p className="text-muted-foreground">加载中...</p>
        </div>
      )}

      {envelopes.length > 0 && envelopes.length < total && (
        <div className="text-center py-4">
          <Button variant="outline" onClick={handleLoadMore} disabled={loading}>
            加载更多
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <EnvelopeDetailDialog
        envelope={selectedEnvelope}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}

function EnvelopeDetailDialog({
  envelope,
  open,
  onOpenChange,
}: {
  envelope: EnvelopeDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!envelope) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            信封 {envelope.id.replace(/-/g, "").slice(0, 8)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Metadata */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">详情</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-xs">{envelope.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">来源</span>
                  <Badge variant={addressBadgeVariant(envelope.from)} className="text-xs">
                    {envelope.from}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">目标</span>
                  <Badge variant={addressBadgeVariant(envelope.to)} className="text-xs">
                    {envelope.to}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <Badge
                    variant={envelope.status === "pending" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {statusLabel(envelope.status)}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">来自 Boss</span>
                  <span>{envelope.fromBoss ? "是" : "否"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">创建时间</span>
                  <span>{formatTime(envelope.createdAt)}</span>
                </div>
                {envelope.deliverAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">投递时间</span>
                    <span>{formatTime(envelope.deliverAt)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Content */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">内容</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm whitespace-pre-wrap break-words bg-muted p-3 rounded-md max-h-[40vh] overflow-y-auto">
                {envelope.content?.text || "（无文本）"}
              </pre>
              {envelope.content?.attachments && envelope.content.attachments.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium mb-1">附件</p>
                  <div className="space-y-1">
                    {envelope.content.attachments.map((att) => (
                      <div key={`${att.source}:${att.filename ?? ""}`} className="text-xs text-muted-foreground font-mono">
                        {att.filename || att.source}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          {envelope.metadata && Object.keys(envelope.metadata).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">元数据</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap break-words bg-muted p-3 rounded-md max-h-[30vh] overflow-y-auto">
                  {JSON.stringify(envelope.metadata, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
