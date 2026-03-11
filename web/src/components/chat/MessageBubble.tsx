import { useState } from "react";
import { cn } from "@/lib/utils";
import { Bot, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ChatMessageData {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  text: string;
  status: string;
  createdAt: number;
  clientMessageId?: string;
  permissionEscalatable?: boolean;
  replyToEnvelopeId?: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractSenderName(from: string, isBoss: boolean): string {
  if (isBoss) return "Boss";
  const match = from.match(/^agent:(.+)$/);
  return match?.[1] ?? from;
}

interface MessageBubbleProps {
  msg: ChatMessageData;
  agentName?: string;
  onGrantAccess?: (msg: ChatMessageData) => Promise<void>;
}

export function MessageBubble({ msg, onGrantAccess }: MessageBubbleProps) {
  const [granting, setGranting] = useState(false);
  const isBoss = msg.fromBoss || msg.from === "channel:web:boss";
  const senderName = extractSenderName(msg.from, isBoss);

  const pendingHint =
    msg.status !== "pending"
      ? null
      : msg.id.startsWith("local:")
        ? "发送中..."
        : isBoss
          ? "排队中..."
          : "处理中...";

  return (
    <div className={cn("flex gap-2.5", isBoss ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium shadow-sm",
          isBoss
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground border border-border/60"
        )}
      >
        {isBoss ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      {/* Content */}
      <div className={cn("flex max-w-[70%] flex-col", isBoss ? "items-end" : "items-start")}>
        {/* Sender label */}
        <span
          className={cn(
            "mb-1 text-xs font-medium",
            isBoss ? "text-primary/80" : "text-muted-foreground"
          )}
        >
          {senderName}
        </span>

        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
            isBoss
              ? "rounded-tr-md bg-primary text-primary-foreground"
              : "rounded-tl-md border border-border/50 bg-card text-foreground"
          )}
        >
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        </div>

        {/* Permission escalation button */}
        {msg.permissionEscalatable && onGrantAccess && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950 dark:hover:text-amber-300"
            disabled={granting}
            onClick={async () => {
              setGranting(true);
              try {
                await onGrantAccess(msg);
              } finally {
                setGranting(false);
              }
            }}
          >
            <ShieldCheck className="size-3.5" />
            {granting ? "授权中..." : "授权完整访问并重试"}
          </Button>
        )}

        {/* Footer */}
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[11px]",
            isBoss ? "text-muted-foreground/70" : "text-muted-foreground/60"
          )}
        >
          <span>{formatTime(msg.createdAt)}</span>
          {pendingHint && (
            <span className="inline-flex items-center gap-1 italic text-amber-500/80">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-400" />
              {pendingHint}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
