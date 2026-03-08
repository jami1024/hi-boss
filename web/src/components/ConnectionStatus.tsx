import { cn } from "@/lib/utils";

interface ConnectionStatusProps {
  connected: boolean;
  authenticated: boolean;
  size?: "default" | "compact";
  className?: string;
}

export function ConnectionStatus({
  connected,
  authenticated,
  size = "default",
  className,
}: ConnectionStatusProps) {
  const isLive = connected && authenticated;
  const isConnecting = connected && !authenticated;
  const containerClass =
    size === "compact"
      ? "flex items-center gap-1.5 text-[11px] text-muted-foreground"
      : "flex items-center gap-2 text-xs text-muted-foreground";
  const dotClass =
    size === "compact"
      ? "inline-block h-1.5 w-1.5 rounded-full"
      : "inline-block h-2 w-2 rounded-full";

  return (
    <div className={cn(containerClass, className)}>
      <span
        className={cn(
          dotClass,
          isLive ? "bg-green-500" : isConnecting ? "bg-yellow-500" : "bg-red-500"
        )}
      />
      <span>{isLive ? "Live" : isConnecting ? "Connecting..." : "Offline"}</span>
    </div>
  );
}
