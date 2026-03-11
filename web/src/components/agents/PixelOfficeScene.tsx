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
/*  Zone assignment                                                    */
/* ------------------------------------------------------------------ */

type Zone = "desk" | "sofa" | "debug";

function agentZone(status?: AgentCardStatus): Zone {
  if (status?.health === "error") return "debug";
  if (status?.state === "running") return "desk";
  return "sofa";
}

/* ------------------------------------------------------------------ */
/*  Desk positions (work area, left side) - max 6 desks                */
/* ------------------------------------------------------------------ */

const DESK_SLOTS = [
  { x: 6, y: 32 },
  { x: 30, y: 32 },
  { x: 54, y: 32 },
  { x: 6, y: 62 },
  { x: 30, y: 62 },
  { x: 54, y: 62 },
];

/* Sofa positions (break area, right side) - max 6 */
const SOFA_SLOTS = [
  { x: 78, y: 28 },
  { x: 78, y: 48 },
  { x: 78, y: 68 },
  { x: 92, y: 28 },
  { x: 92, y: 48 },
  { x: 92, y: 68 },
];

/* Debug positions (bottom-right corner) - max 4 */
const DEBUG_SLOTS = [
  { x: 78, y: 82 },
  { x: 88, y: 82 },
  { x: 83, y: 90 },
  { x: 93, y: 90 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PixelOfficeScene({ agents, onAgentClick }: PixelOfficeSceneProps) {
  const positioned = useMemo(() => {
    const counters = { desk: 0, sofa: 0, debug: 0 };
    const slots = { desk: DESK_SLOTS, sofa: SOFA_SLOTS, debug: DEBUG_SLOTS };

    return agents.map((a) => {
      const zone = agentZone(a.status);
      const idx = counters[zone] % slots[zone].length;
      counters[zone]++;
      const pos = slots[zone][idx];
      return { ...a, zone, pos };
    });
  }, [agents]);

  const handleClick = useCallback(
    (name: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      onAgentClick(name);
    },
    [onAgentClick],
  );

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border-4 border-[#2a2a3d] shadow-[4px_4px_0_#1a1a2e]"
      style={{ aspectRatio: "16/9", imageRendering: "auto" }}
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

      {/* Water/pond areas */}
      <WaterPatch x={35} y={45} w={30} h={20} />
      <WaterPatch x={60} y={15} w={12} h={12} />

      {/* ---- Work Area (left) ---- */}
      <ZoneLabel x={2} y={2} label="工作区" />
      {/* Wall behind desks */}
      <Wall x={0} y={0} w={68} h={22} />
      {/* Desks */}
      <Desk x={4} y={22} />
      <Desk x={28} y={22} />
      <Desk x={52} y={22} />
      <Desk x={4} y={52} />
      <Desk x={28} y={52} />
      {/* Bookshelf */}
      <Bookshelf x={1} y={3} />
      <Bookshelf x={15} y={3} />
      {/* Plants */}
      <Plant x={24} y={5} size="lg" />
      <Plant x={48} y={8} size="sm" />
      {/* Lamp */}
      <Lamp x={62} y={3} />

      {/* ---- Break Area (right) ---- */}
      <ZoneLabel x={75} y={2} label="休息区" />
      {/* Wall behind break area */}
      <Wall x={72} y={0} w={28} h={22} />
      {/* Sofa */}
      <Sofa x={76} y={22} />
      {/* Coffee table */}
      <CoffeeTable x={82} y={40} />
      {/* Plants */}
      <Plant x={95} y={5} size="lg" />
      <Plant x={88} y={60} size="sm" />
      {/* Bed / rest */}
      <Bed x={85} y={22} />

      {/* ---- Debug Corner (bottom-right) ---- */}
      <ZoneLabel x={75} y={76} label="调试区" />
      {/* Server rack */}
      <ServerRack x={92} y={76} />
      <ServerRack x={96} y={76} />
      {/* Warning sign */}
      <WarningSign x={76} y={78} />

      {/* ---- Decorative elements ---- */}
      {/* Lily pads on water */}
      <LilyPad x={38} y={48} />
      <LilyPad x={45} y={52} />
      <LilyPad x={50} y={46} />
      <LilyPad x={42} y={56} />
      <LilyPad x={62} y={18} />
      {/* Flowers */}
      <Flower x={36} y={44} color="#ff69b4" />
      <Flower x={52} y={55} color="#dda0dd" />
      <Flower x={64} y={20} color="#ff69b4" />

      {/* ---- Agent characters ---- */}
      {positioned.map((a) => (
        <AgentCharacter
          key={a.agent.name}
          name={a.agent.name}
          role={a.agent.role}
          description={a.agent.description}
          zone={a.zone}
          state={a.status?.state}
          health={a.status?.health}
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
  zone,
  state,
  health,
  x,
  y,
  onClick,
}: {
  name: string;
  role: string | null;
  description?: string | null;
  zone: Zone;
  state?: string;
  health?: string;
  x: number;
  y: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  void zone;
  const isRunning = state === "running";
  const isError = health === "error";

  return (
    <div
      className="absolute cursor-pointer transition-all duration-700 ease-in-out"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)", zIndex: 20 }}
      onClick={onClick}
    >
      {/* Speech bubble */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <div
          className="relative rounded bg-white/95 px-1.5 py-0.5 text-[8px] font-medium text-zinc-700 shadow-sm"
          style={{ fontFamily: "monospace", maxWidth: "80px" }}
        >
          <span className="block truncate">
            {isRunning
              ? description || "工作中..."
              : isError
                ? "出错了!"
                : description || "休息中~"
            }
          </span>
          {/* Bubble tail */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-l-[3px] border-r-[3px] border-t-[4px] border-l-transparent border-r-transparent border-t-white/95" />
        </div>
      </div>

      {/* Character body */}
      <div className="relative flex flex-col items-center">
        {/* Character sprite (simplified pixel art) */}
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
            <div className="absolute top-[3px] left-[3px] h-[3px] w-[3px] rounded-full bg-zinc-800" />
            <div className="absolute top-[3px] right-[3px] h-[3px] w-[3px] rounded-full bg-zinc-800" />
            {/* Mouth - changes with state */}
            {isError ? (
              <div className="absolute bottom-[2px] left-1/2 h-[2px] w-[8px] -translate-x-1/2 rounded-t-full border-t-2 border-red-500" />
            ) : isRunning ? (
              <div className="absolute bottom-[3px] left-1/2 h-[4px] w-[6px] -translate-x-1/2 rounded-b-full bg-zinc-700" />
            ) : (
              <div className="absolute bottom-[4px] left-1/2 h-[2px] w-[6px] -translate-x-1/2 bg-zinc-600" />
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
      {/* Brick wall */}
      <div className="h-full w-full bg-[#8B6F5C]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 8px, #7a6050 8px, #7a6050 9px), repeating-linear-gradient(90deg, transparent, transparent 16px, #7a6050 16px, #7a6050 17px)",
        }}
      />
      {/* Wall base */}
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
          {/* Screen glow */}
          <div className="h-full w-full bg-gradient-to-b from-[#2a5a3a] to-[#1a3a2a] opacity-80" />
        </div>
      </div>
      {/* Monitor stand */}
      <div className="absolute top-[5%] left-[45%] h-[8%] w-[10%] bg-[#3a3a4d]" />
      {/* Desk legs */}
      <div className="absolute bottom-0 left-[8%] h-[60%] w-[6%] bg-[#6d5a43]" />
      <div className="absolute bottom-0 right-[8%] h-[60%] w-[6%] bg-[#6d5a43]" />
    </div>
  );
}

function Sofa({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "8%", height: "14%", zIndex: 5 }}>
      {/* Sofa body */}
      <div className="absolute inset-x-0 bottom-0 h-[70%] rounded-sm bg-[#c4956a] border-2 border-[#a07850]">
        {/* Cushion */}
        <div className="absolute inset-[2px] rounded-sm bg-[#d4a57a]" />
      </div>
      {/* Sofa back */}
      <div className="absolute inset-x-0 top-0 h-[40%] rounded-t-sm bg-[#a07850] border-2 border-[#8a6540]" />
    </div>
  );
}

function Bed({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "12%", height: "10%", zIndex: 5 }}>
      {/* Bed frame */}
      <div className="absolute inset-0 rounded-sm bg-[#6d5a43] border-2 border-[#4a3c2e]" />
      {/* Mattress */}
      <div className="absolute inset-[3px] rounded-sm bg-[#f0e6d4]" />
      {/* Pillow */}
      <div className="absolute top-[4px] left-[4px] h-[40%] w-[30%] rounded-sm bg-white border border-[#e0d6c4]" />
      {/* Blanket */}
      <div className="absolute bottom-[3px] right-[3px] h-[50%] w-[65%] rounded-sm bg-[#7a9ec4] border border-[#6088b0]" />
    </div>
  );
}

function Bookshelf({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "10%", height: "15%", zIndex: 6 }}>
      {/* Frame */}
      <div className="absolute inset-0 bg-[#5a4030] border-2 border-[#3d2b1f] rounded-sm">
        {/* Shelves */}
        <div className="absolute top-[32%] inset-x-0 h-[2px] bg-[#3d2b1f]" />
        <div className="absolute top-[64%] inset-x-0 h-[2px] bg-[#3d2b1f]" />
        {/* Books */}
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
      {/* Pot */}
      <div
        className="rounded-b-sm bg-[#b85c38] border border-[#944a2c]"
        style={{ width: `${s * 1.2}%`, height: `${s * 0.6}vh`, marginTop: "-2px" }}
      />
      {/* Leaves */}
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
      {/* Shade */}
      <div className="h-3 w-4 rounded-t-full bg-[#f0c060] border border-[#d4a040] shadow-[0_0_8px_#f0c060aa]" />
      {/* Stand */}
      <div className="mx-auto h-4 w-[2px] bg-[#8a7a60]" />
      {/* Base */}
      <div className="mx-auto h-[2px] w-3 rounded bg-[#8a7a60]" />
    </div>
  );
}

function CoffeeTable({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "8%", height: "6%", zIndex: 5 }}>
      <div className="absolute inset-0 rounded-sm bg-[#7a6050] border-2 border-[#5a4030]" />
      {/* Coffee cup */}
      <div className="absolute top-[-4px] right-[15%] h-[6px] w-[6px] rounded-sm bg-white border border-zinc-300">
        <div className="m-[1px] h-[2px] w-[2px] rounded-full bg-[#6a4a30]" />
      </div>
    </div>
  );
}

function ServerRack({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "3%", height: "16%", zIndex: 6 }}>
      <div className="h-full w-full rounded-sm bg-[#2a2a3d] border-2 border-[#1a1a2e]">
        {/* Server lights */}
        {[15, 30, 45, 60, 75].map((top) => (
          <div key={top} className="absolute left-[20%] flex gap-[1px]" style={{ top: `${top}%` }}>
            <div className="h-[2px] w-[2px] animate-pulse rounded-full bg-emerald-400" style={{ animationDelay: `${top * 20}ms` }} />
            <div className="h-[2px] w-[2px] rounded-full bg-amber-400" />
          </div>
        ))}
        {/* Ventilation lines */}
        {[20, 40, 60, 80].map((top) => (
          <div key={`v${top}`} className="absolute right-[15%] h-[1px] w-[40%] bg-[#3a3a4d]" style={{ top: `${top}%` }} />
        ))}
      </div>
    </div>
  );
}

function WarningSign({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 7 }}>
      <div className="flex h-5 w-7 items-center justify-center rounded-sm bg-amber-400 border-2 border-amber-600 shadow-[1px_1px_0_#92400e]">
        <span className="text-[8px] font-black text-amber-900" style={{ fontFamily: "monospace" }}>!</span>
      </div>
    </div>
  );
}

function WaterPatch({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="absolute rounded-lg opacity-60"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        background: "linear-gradient(135deg, #4a90a8 0%, #5aaccf 40%, #4a90a8 70%, #5aaccf 100%)",
        zIndex: 2,
      }}
    />
  );
}

function LilyPad({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="absolute h-2 w-2 rounded-full bg-[#4a8c5c] border border-[#3a7a4c]"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: 3 }}
    />
  );
}

function Flower({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div
      className="absolute h-2 w-2 rounded-full border"
      style={{ left: `${x}%`, top: `${y}%`, backgroundColor: color, borderColor: `${color}88`, zIndex: 4 }}
    />
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
