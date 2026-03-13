import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { AgentSummary } from "@/api/client";
import type { AgentCardStatus } from "./AgentCatalogCard";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PixelAgentData {
  agent: AgentSummary;
  status?: AgentCardStatus;
}

interface PixelOfficeSceneProps {
  agents: PixelAgentData[];
  onAgentClick: (name: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Desk grid layout — each agent gets their own desk                  */
/*  Columns adapt to agent count and center horizontally.              */
/* ------------------------------------------------------------------ */

const MAX_COLS = 4;
const DESK_WIDTH = 22; // % width per desk slot

function layoutGrid(agentCount: number) {
  if (agentCount === 0) return { cols: 1, rows: 1, offsetX: 50, startY: 55, stepY: 34 };
  const cols = Math.min(agentCount, MAX_COLS);
  const rows = Math.max(1, Math.ceil(agentCount / cols));
  const totalW = cols * DESK_WIDTH;
  const offsetX = (100 - totalW) / 2 + DESK_WIDTH / 2;
  const startY = 55; // agents sit lower so they're clearly below the desk top
  const stepY = 34;
  return { cols, rows, offsetX, startY, stepY };
}

function deskPosition(index: number, agentCount: number) {
  const { cols, offsetX, startY, stepY } = layoutGrid(agentCount);
  const row = Math.floor(index / cols);
  const colsInRow = row < Math.floor((agentCount - 1) / cols) ? cols : ((agentCount - 1) % cols) + 1;
  const col = index % cols;
  const rowOffsetX = colsInRow < cols ? ((cols - colsInRow) * DESK_WIDTH) / 2 : 0;
  return {
    x: offsetX + col * DESK_WIDTH + rowOffsetX,
    y: startY + row * stepY,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PixelOfficeScene({ agents, onAgentClick }: PixelOfficeSceneProps) {
  const positioned = useMemo(() => {
    return agents.map((a, i) => {
      const pos = deskPosition(i, agents.length);
      return { ...a, pos };
    });
  }, [agents]);

  const handleClick = useCallback(
    (name: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      onAgentClick(name);
    },
    [onAgentClick],
  );

  // Calculate scene aspect ratio — tight around desks, no excess floor
  const grid = layoutGrid(agents.length);
  const sceneHeight = Math.max(7, 4 + grid.rows * 4);

  // Wall decorations spread evenly across the full wall width
  const wallDecorations = useMemo(() => {
    const items: Array<{ type: "bookshelf" | "lamp" | "plant"; x: number }> = [];
    // Place decorations evenly across the wall regardless of desk positions
    const decorCount = Math.max(agents.length * 2, 4);
    const spacing = 90 / (decorCount + 1);
    for (let i = 0; i < decorCount; i++) {
      const x = 5 + spacing * (i + 1);
      const types: Array<"bookshelf" | "lamp" | "plant"> = ["bookshelf", "lamp", "plant"];
      items.push({ type: types[i % 3], x });
    }
    return items;
  }, [agents.length]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border-4 border-[#2a2a3d] shadow-[4px_4px_0_#1a1a2e]"
      style={{ aspectRatio: `16/${sceneHeight}`, imageRendering: "auto" }}
    >
      {/* Floor */}
      <div className="absolute inset-0 bg-[#3a6e5c]" />
      {/* Floor tile pattern */}
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(45deg, #2d5a4a 25%, transparent 25%, transparent 75%, #2d5a4a 75%), linear-gradient(45deg, #2d5a4a 25%, transparent 25%, transparent 75%, #2d5a4a 75%)",
          backgroundSize: "24px 24px",
          backgroundPosition: "0 0, 12px 12px",
        }}
      />

      {/* ---- Wall (taller to fill proportionally) ---- */}
      <Wall x={0} y={0} w={100} h={30} />

      {/* Zone label */}
      <ZoneLabel x={2} y={2} label="工作区" />

      {/* ---- Wall decorations (spread evenly) ---- */}
      {wallDecorations.map((d, i) =>
        d.type === "bookshelf" ? (
          <Bookshelf key={`wd-${i}`} x={d.x} y={4} />
        ) : d.type === "lamp" ? (
          <Lamp key={`wd-${i}`} x={d.x} y={5} />
        ) : (
          <Plant key={`wd-${i}`} x={d.x} y={7} size="lg" />
        ),
      )}
      {/* Clock centered */}
      <WallClock x={49} y={5} />

      {/* ---- Desks (one per agent, centered on agent x) ---- */}
      {positioned.map((_, i) => {
        const pos = deskPosition(i, agents.length);
        return <Desk key={`desk-${i}`} x={pos.x - 9} y={pos.y - 14} />;
      })}

      {/* ---- Decorative elements ---- */}
      {grid.rows > 1 && <Plant x={96} y={35} size="sm" />}
      {grid.rows > 1 && <WaterCooler x={96} y={50} />}

      {/* ---- Agent characters ---- */}
      {positioned.map((a) => (
        <AgentCharacter
          key={a.agent.name}
          name={a.agent.name}
          role={a.agent.role}
          description={a.agent.description}
          state={a.status?.state}
          health={a.status?.health}
          pending={a.status?.pending}
          x={a.pos.x}
          y={a.pos.y}
          onClick={handleClick(a.agent.name)}
        />
      ))}

      {/* Bottom status bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center"
        style={{ height: "6%" }}
      >
        <div className="flex items-center gap-2 rounded-t-lg bg-[#3d2b1f]/90 px-4 py-1 shadow-md">
          <span className="text-[10px] font-bold text-amber-300" style={{ fontFamily: "monospace" }}>
            ★
          </span>
          <span className="text-[10px] font-bold text-amber-100/90 tracking-wider" style={{ fontFamily: "monospace" }}>
            智能体办公室
          </span>
          <span className="text-[10px] font-bold text-amber-300" style={{ fontFamily: "monospace" }}>
            ★
          </span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Agent Character                                                    */
/* ================================================================== */

function AgentCharacter({
  name,
  role,
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

  // Bubble text based on state
  const bubbleText = isRunning
    ? "工作中..."
    : isError
      ? "出错了!"
      : pending && pending > 0
        ? `${pending}条待处理`
        : description
          ? description
          : "休息中~";

  return (
    <div
      className="absolute cursor-pointer transition-all duration-700 ease-in-out group/agent"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)", zIndex: 20 }}
      onClick={onClick}
    >
      {/* Speech bubble */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover/agent:opacity-100 transition-opacity duration-200">
        <div
          className="relative rounded bg-white/95 px-1.5 py-0.5 text-[8px] font-medium text-zinc-700 shadow-sm"
          style={{ fontFamily: "monospace", maxWidth: "100px" }}
        >
          <span className="block truncate">{bubbleText}</span>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-l-[3px] border-r-[3px] border-t-[4px] border-l-transparent border-r-transparent border-t-white/95" />
        </div>
      </div>

      {/* Character body */}
      <div className="relative flex flex-col items-center">
        {/* Chair (behind character) */}
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
          {/* Character face */}
          <div className="relative" style={{ width: "18px", height: "18px" }}>
            {/* Eyes */}
            {!isRunning && !isError ? (
              <>
                {/* Sleepy eyes (idle) */}
                <div className="absolute top-[5px] left-[3px] h-[1px] w-[4px] bg-zinc-600" />
                <div className="absolute top-[5px] right-[3px] h-[1px] w-[4px] bg-zinc-600" />
              </>
            ) : (
              <>
                {/* Open eyes */}
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
              /* Sleeping mouth - small line */
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

          {/* Health indicator */}
          <div className={cn(
            "absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full border border-white",
            health === "ok" && "bg-emerald-400",
            health === "degraded" && "bg-amber-400",
            health === "error" && "bg-red-400 animate-pulse",
            (!health || health === "unknown") && "bg-zinc-400",
          )} />

          {/* Running animation - typing dots */}
          {isRunning && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-[2px]">
              <span className="h-[2px] w-[2px] animate-bounce rounded-full bg-amber-600 [animation-delay:0ms]" />
              <span className="h-[2px] w-[2px] animate-bounce rounded-full bg-amber-600 [animation-delay:150ms]" />
              <span className="h-[2px] w-[2px] animate-bounce rounded-full bg-amber-600 [animation-delay:300ms]" />
            </div>
          )}

          {/* Sleeping Zzz for idle */}
          {!isRunning && !isError && (
            <div className="absolute -top-3 -right-3 flex flex-col items-start">
              <span className="text-[7px] font-bold text-sky-300/80 animate-pulse [animation-delay:0ms]" style={{ fontFamily: "monospace" }}>z</span>
              <span className="text-[5px] font-bold text-sky-300/60 animate-pulse [animation-delay:300ms] -mt-1 -ml-1" style={{ fontFamily: "monospace" }}>z</span>
            </div>
          )}
        </div>

        {/* Name label */}
        <div
          className="mt-1 rounded bg-[#3d2b1f]/80 px-1 py-[1px] text-center"
          style={{ fontFamily: "monospace" }}
        >
          <span className="text-[7px] font-bold leading-none text-amber-100 whitespace-nowrap">
            {name.length > 10 ? `${name.slice(0, 9)}…` : name}
          </span>
        </div>

        {/* State label */}
        <div
          className={cn(
            "mt-[1px] rounded px-1 py-[0.5px] text-center text-[6px] font-bold",
            isError ? "bg-red-500/80 text-white" :
            isRunning ? "bg-blue-500/80 text-white" :
            "bg-emerald-600/70 text-white",
          )}
          style={{ fontFamily: "monospace" }}
        >
          {isError ? "异常" : isRunning ? "工作中" : "空闲"}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Furniture & Decorations                                            */
/* ================================================================== */

function Wall({ x, w, h, y }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="absolute"
      style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
    >
      <div className="h-full w-full bg-[#8B6F5C]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 8px, #7a6050 8px, #7a6050 9px), repeating-linear-gradient(90deg, transparent, transparent 16px, #7a6050 16px, #7a6050 17px)",
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#5a4030]" />
    </div>
  );
}

function Desk({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "18%", height: "12%", zIndex: 5 }}>
      {/* Desktop surface */}
      <div className="absolute inset-x-0 top-0 h-[40%] rounded-t-sm bg-[#8B7355] border-2 border-[#6d5a43] shadow-[2px_2px_0_#4a3c2e]" />
      {/* Monitor */}
      <div className="absolute top-[-20%] left-[30%] h-[28%] w-[40%] rounded-sm bg-[#2a2a3d] border-2 border-[#1a1a2e]">
        <div className="m-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] bg-[#1a3a2a]">
          <div className="h-full w-full bg-gradient-to-b from-[#2a5a3a] to-[#1a3a2a] opacity-80" />
        </div>
      </div>
      {/* Monitor stand */}
      <div className="absolute top-[5%] left-[45%] h-[8%] w-[10%] bg-[#3a3a4d]" />
      {/* Keyboard */}
      <div className="absolute top-[8%] left-[25%] h-[6%] w-[30%] rounded-sm bg-[#4a4a5d] border border-[#3a3a4d]" />
      {/* Coffee mug */}
      <div className="absolute top-[4%] right-[12%] h-[8px] w-[8px] rounded-sm bg-white border border-zinc-300">
        <div className="m-[1px] h-[3px] w-[3px] rounded-full bg-[#6a4a30]" />
      </div>
      {/* Desk legs */}
      <div className="absolute bottom-0 left-[8%] h-[60%] w-[6%] bg-[#6d5a43]" />
      <div className="absolute bottom-0 right-[8%] h-[60%] w-[6%] bg-[#6d5a43]" />
    </div>
  );
}

function Bookshelf({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "10%", height: "15%", zIndex: 6 }}>
      <div className="absolute inset-0 bg-[#5a4030] border-2 border-[#3d2b1f] rounded-sm">
        <div className="absolute top-[32%] inset-x-0 h-[2px] bg-[#3d2b1f]" />
        <div className="absolute top-[64%] inset-x-0 h-[2px] bg-[#3d2b1f]" />
        <div className="absolute top-[5%] left-[8%] h-[25%] w-[18%] bg-[#c44]" />
        <div className="absolute top-[5%] left-[30%] h-[25%] w-[14%] bg-[#48a]" />
        <div className="absolute top-[5%] left-[48%] h-[25%] w-[18%] bg-[#6a4]" />
        <div className="absolute top-[5%] left-[70%] h-[22%] w-[16%] bg-[#a84]" />
        <div className="absolute top-[36%] left-[10%] h-[26%] w-[20%] bg-[#84a]" />
        <div className="absolute top-[36%] left-[35%] h-[26%] w-[16%] bg-[#a64]" />
        <div className="absolute top-[36%] left-[55%] h-[22%] w-[22%] bg-[#4a8]" />
        <div className="absolute top-[68%] left-[8%] h-[25%] w-[16%] bg-[#c84]" />
        <div className="absolute top-[68%] left-[28%] h-[28%] w-[20%] bg-[#48c]" />
        <div className="absolute top-[68%] left-[54%] h-[24%] w-[18%] bg-[#8c4]" />
      </div>
    </div>
  );
}

function Plant({ x, y, size }: { x: number; y: number; size: "sm" | "lg" }) {
  const s = size === "lg" ? 4 : 2.5;
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 8 }}>
      <div
        className="rounded-b-sm bg-[#b85c38] border border-[#944a2c]"
        style={{ width: `${s * 1.2}%`, height: `${s * 0.6}vh`, marginTop: "-2px" }}
      />
      <div
        className="absolute rounded-full bg-[#4a8c5c] border border-[#3a7a4c]"
        style={{
          width: `${s * 2}%`,
          height: `${s * 1.5}vh`,
          bottom: "60%",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />
      {size === "lg" && (
        <div
          className="absolute rounded-full bg-[#5a9c6c] border border-[#4a8c5c]"
          style={{
            width: `${s * 1.4}%`,
            height: `${s * 1.2}vh`,
            bottom: "80%",
            left: "30%",
            transform: "translateX(-50%)",
          }}
        />
      )}
    </div>
  );
}

function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 7 }}>
      <div className="h-3 w-4 rounded-t-full bg-[#f0c060] border border-[#d4a040] shadow-[0_0_8px_#f0c060aa]" />
      <div className="mx-auto h-4 w-[2px] bg-[#8a7a60]" />
      <div className="mx-auto h-[2px] w-3 rounded bg-[#8a7a60]" />
    </div>
  );
}

function WallClock({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 7 }}>
      <div className="h-5 w-5 rounded-full bg-white border-2 border-[#5a4030] shadow-[1px_1px_0_#3d2b1f]">
        {/* Hour hand */}
        <div className="absolute top-[50%] left-[50%] h-[5px] w-[1px] -translate-x-1/2 origin-bottom -rotate-45 bg-zinc-800" style={{ bottom: "50%" }} />
        {/* Minute hand */}
        <div className="absolute top-[25%] left-[50%] h-[7px] w-[1px] -translate-x-1/2 origin-bottom rotate-90 bg-zinc-600" style={{ bottom: "50%" }} />
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[2px] w-[2px] rounded-full bg-red-500" />
      </div>
    </div>
  );
}

function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      {/* Tank */}
      <div className="h-4 w-3 rounded-t-full bg-[#a0d4e8] border border-[#80b4c8] mx-auto" />
      {/* Body */}
      <div className="h-5 w-4 bg-[#e0e0e0] border border-[#c0c0c0] mx-auto rounded-b-sm">
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-[3px] w-[3px] rounded-full bg-blue-400" />
      </div>
    </div>
  );
}

function ZoneLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div
      className="absolute"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: 30 }}
    >
      <span
        className="rounded bg-[#1a1a2e]/70 px-1.5 py-0.5 text-[8px] font-bold text-amber-200/80 tracking-wider"
        style={{ fontFamily: "monospace" }}
      >
        [{label}]
      </span>
    </div>
  );
}
