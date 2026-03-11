import { Bot } from "lucide-react";

interface TypingIndicatorProps {
  agentName: string;
  visible: boolean;
}

export function TypingIndicator({ agentName, visible }: TypingIndicatorProps) {
  if (!visible) return null;

  return (
    <div className="flex items-start gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground border border-border/60 shadow-sm">
        <Bot className="size-4" />
      </div>
      <div className="flex flex-col items-start">
        <span className="mb-1 text-xs font-medium text-muted-foreground">
          {agentName}
        </span>
        <div className="rounded-2xl rounded-tl-md border border-border/50 bg-card px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
            <span className="ml-2 text-xs text-muted-foreground">正在执行...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
