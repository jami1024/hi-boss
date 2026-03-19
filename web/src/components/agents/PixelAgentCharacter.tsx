import { cn } from "@/lib/utils";

export function AgentCharacter({
  name,
  role,
  provider,
  description,
  state,
  health,
  pending,
  x,
  y,
  onClick,
}: {
  name: string;
  role: string | null;
  provider?: string | null;
  description?: string | null;
  state?: string;
  health?: string;
  pending?: number;
  x: number;
  y: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isRunning = state === "running";
  const isError = health === "error";

  const bubbleText = isRunning
    ? "工作中..."
    : isError
      ? "出错了!"
      : pending && pending > 0
        ? `${pending}条待处理`
        : description
          ? description
          : "休息中~";

  const healthValue =
    health === "ok" ? 100 :
    health === "degraded" ? 50 :
    health === "error" ? 20 : 80;

  return (
    <div
      className="absolute cursor-pointer transition-all duration-700 ease-in-out group/agent"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)", zIndex: 20 }}
      onClick={onClick}
    >
      {/* Speech bubble (hover) */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover/agent:opacity-100 transition-opacity duration-200">
        <div
          className="relative rounded bg-white/95 px-1.5 py-0.5 text-[8px] font-medium text-zinc-700 shadow-sm"
          style={{ fontFamily: "monospace", maxWidth: "100px" }}
        >
          <span className="block truncate">{bubbleText}</span>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-l-[3px] border-r-[3px] border-t-[4px] border-l-transparent border-r-transparent border-t-white/95" />
        </div>
      </div>

      <div className="relative flex flex-col items-center">
        {/* Chair */}
        <div className="absolute top-[2px] left-1/2 -translate-x-1/2" style={{ zIndex: -1 }}>
          <div className="h-[20px] w-[32px] rounded-t-lg bg-[#5a4030] border-2 border-[#3d2b1f]" />
        </div>

        {/* Character sprite */}
        <div
          className={cn(
            "relative flex items-center justify-center rounded-sm border-2 shadow-[2px_2px_0_rgba(0,0,0,0.3)]",
            "transition-colors duration-300",
            isError
              ? "border-red-400 bg-red-100"
              : isRunning
                ? "border-amber-500 bg-amber-100"
                : "border-emerald-500 bg-emerald-100",
          )}
          style={{ width: "28px", height: "28px", imageRendering: "pixelated" }}
        >
          <div className="relative" style={{ width: "18px", height: "18px" }}>
            {/* Eyes */}
            {!isRunning && !isError ? (
              <>
                <div className="absolute top-[5px] left-[3px] h-[1px] w-[4px] bg-zinc-600" />
                <div className="absolute top-[5px] right-[3px] h-[1px] w-[4px] bg-zinc-600" />
              </>
            ) : (
              <>
                <div className="absolute top-[3px] left-[3px] h-[3px] w-[3px] rounded-full bg-zinc-800" />
                <div className="absolute top-[3px] right-[3px] h-[3px] w-[3px] rounded-full bg-zinc-800" />
              </>
            )}
            {/* Mouth */}
            {isError ? (
              <div className="absolute bottom-[2px] left-1/2 h-[2px] w-[8px] -translate-x-1/2 rounded-t-full border-t-2 border-red-500" />
            ) : isRunning ? (
              <div className="absolute bottom-[3px] left-1/2 h-[4px] w-[6px] -translate-x-1/2 rounded-b-full bg-zinc-700" />
            ) : (
              <div className="absolute bottom-[4px] left-1/2 h-[2px] w-[4px] -translate-x-1/2 bg-zinc-400" />
            )}
            {/* Blush */}
            <div className="absolute bottom-[5px] left-[1px] h-[3px] w-[3px] rounded-full bg-pink-300/60" />
            <div className="absolute bottom-[5px] right-[1px] h-[3px] w-[3px] rounded-full bg-pink-300/60" />
          </div>

          {/* Role hat */}
          {role === "speaker" && (
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-[5px] w-[16px] rounded-t-sm bg-sky-500 border border-sky-600" />
          )}
          {role === "leader" && (
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-[5px] w-[16px] rounded-t-sm bg-violet-500 border border-violet-600" />
          )}

          {/* Health dot */}
          <div className={cn(
            "absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full border border-white",
            health === "ok" && "bg-emerald-400",
            health === "degraded" && "bg-amber-400",
            health === "error" && "bg-red-400 animate-pulse",
            (!health || health === "unknown") && "bg-zinc-400",
          )} />

          {/* Running typing dots */}
          {isRunning && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-[2px]">
              <span className="h-[2px] w-[2px] animate-bounce rounded-full bg-amber-600 [animation-delay:0ms]" />
              <span className="h-[2px] w-[2px] animate-bounce rounded-full bg-amber-600 [animation-delay:150ms]" />
              <span className="h-[2px] w-[2px] animate-bounce rounded-full bg-amber-600 [animation-delay:300ms]" />
            </div>
          )}

          {/* Zzz for idle */}
          {!isRunning && !isError && (
            <div className="absolute -top-3 -right-3 flex flex-col items-start">
              <span className="text-[7px] font-bold text-sky-300/80 animate-pulse" style={{ fontFamily: "monospace" }}>z</span>
              <span className="text-[5px] font-bold text-sky-300/60 animate-pulse [animation-delay:300ms] -mt-1 -ml-1" style={{ fontFamily: "monospace" }}>z</span>
            </div>
          )}
        </div>

        {/* Name label */}
        <div className="mt-1 rounded bg-[#3d2b1f]/80 px-1 py-[1px] text-center" style={{ fontFamily: "monospace" }}>
          <span className="text-[7px] font-bold leading-none text-amber-100 whitespace-nowrap">
            {name.length > 10 ? `${name.slice(0, 9)}…` : name}
          </span>
        </div>

        {/* Mini Status HUD panel */}
        <div className="mt-1 w-[90px] rounded bg-[#1a1a2e]/85 border border-[#3a3a5d]/60 px-1.5 py-1 backdrop-blur-sm">
          {/* State + Role row */}
          <div className="flex items-center justify-between mb-0.5">
            <span
              className={cn(
                "rounded px-1 py-[0.5px] text-[5px] font-bold",
                isError ? "bg-red-500/80 text-white" :
                isRunning ? "bg-emerald-500/80 text-white" :
                "bg-zinc-600/80 text-zinc-200",
              )}
              style={{ fontFamily: "monospace" }}
            >
              {isError ? "ERR" : isRunning ? "RUN" : "IDLE"}
            </span>
            {role && (
              <span
                className={cn(
                  "rounded px-1 py-[0.5px] text-[5px] font-bold",
                  role === "speaker" ? "bg-sky-500/70 text-white" :
                  role === "leader" ? "bg-violet-500/70 text-white" :
                  "bg-zinc-500/70 text-zinc-200",
                )}
                style={{ fontFamily: "monospace" }}
              >
                {role}
              </span>
            )}
          </div>

          {/* HP bar */}
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[5px] text-red-400 font-bold" style={{ fontFamily: "monospace" }}>HP</span>
            <div className="flex-1 h-[4px] bg-[#2a2a3d] rounded-sm overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  healthValue > 60 ? "bg-red-500" : healthValue > 30 ? "bg-amber-500" : "bg-red-700",
                )}
                style={{ width: `${healthValue}%` }}
              />
            </div>
          </div>

          {/* Pending bar */}
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[5px] text-amber-400 font-bold" style={{ fontFamily: "monospace" }}>MP</span>
            <div className="flex-1 h-[4px] bg-[#2a2a3d] rounded-sm overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-500"
                style={{ width: `${Math.min(100, (pending ?? 0) * 20)}%` }}
              />
            </div>
            {(pending ?? 0) > 0 && (
              <span className="text-[5px] text-amber-200/50" style={{ fontFamily: "monospace" }}>
                {pending}
              </span>
            )}
          </div>

          {/* Provider */}
          <div className="text-[5px] text-amber-200/40 text-center" style={{ fontFamily: "monospace" }}>
            {provider ?? "claude"}
          </div>
        </div>
      </div>
    </div>
  );
}
