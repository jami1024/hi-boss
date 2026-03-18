import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { AgentSummary, EnvelopeSummary, ProjectSummary } from "@/api/client";
import type { AgentCardStatus } from "./AgentCatalogCard";
import {
  Wall, Desk, Bookshelf, Plant, Lamp, WallClock, WaterCooler,
  Rug, Printer, FileCabinet, Whiteboard, Sofa, TrashCan,
  CoffeeMachine, OfficeCat, ZoneLabel,
} from "./PixelFurniture";
import { AgentCharacter } from "./PixelAgentCharacter";

import "@/components/ui/8bit/styles/retro.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PixelAgentData {
  agent: AgentSummary;
  status?: AgentCardStatus;
}

interface PixelOfficeSceneProps {
  agents: PixelAgentData[];
  recentMessages?: EnvelopeSummary[];
  recentProjects?: ProjectSummary[];
  onAgentClick: (name: string) => void;
  onViewAllMessages?: () => void;
  onProjectClick?: (id: string) => void;
  onViewAllProjects?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Desk grid layout                                                   */
/* ------------------------------------------------------------------ */

const MAX_COLS = 4;
const DESK_WIDTH = 22;

function layoutGrid(agentCount: number) {
  if (agentCount === 0) return { cols: 1, rows: 1, offsetX: 50, startY: 52, stepY: 34 };
  const cols = Math.min(agentCount, MAX_COLS);
  const rows = Math.max(1, Math.ceil(agentCount / cols));
  const totalW = cols * DESK_WIDTH;
  const offsetX = (100 - totalW) / 2 + DESK_WIDTH / 2;
  return { cols, rows, offsetX, startY: 52, stepY: 34 };
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

export function PixelOfficeScene({ agents, recentMessages, recentProjects, onAgentClick, onViewAllMessages, onProjectClick, onViewAllProjects }: PixelOfficeSceneProps) {
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

  const grid = layoutGrid(agents.length);
  const sceneHeight = Math.max(6, 3.5 + grid.rows * 3);

  const wallDecorations = useMemo(() => {
    const items: Array<{ type: "bookshelf" | "lamp" | "plant"; x: number }> = [];
    const decorCount = Math.max(agents.length * 2, 4);
    const spacing = 90 / (decorCount + 1);
    for (let i = 0; i < decorCount; i++) {
      const x = 5 + spacing * (i + 1);
      const types: Array<"bookshelf" | "lamp" | "plant"> = ["bookshelf", "lamp", "plant"];
      items.push({ type: types[i % 3], x });
    }
    return items;
  }, [agents.length]);

  const hasMessages = recentMessages && recentMessages.length > 0;
  const hasProjects = recentProjects && recentProjects.length > 0;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border-4 border-[#2a2a3d] shadow-[4px_4px_0_#1a1a2e]"
      style={{ aspectRatio: `16/${sceneHeight}`, imageRendering: "auto" }}
    >
      {/* Floor */}
      <div className="absolute inset-0 bg-[#3a6e5c]" />
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(45deg, #2d5a4a 25%, transparent 25%, transparent 75%, #2d5a4a 75%), linear-gradient(45deg, #2d5a4a 25%, transparent 25%, transparent 75%, #2d5a4a 75%)",
          backgroundSize: "24px 24px",
          backgroundPosition: "0 0, 12px 12px",
        }}
      />

      {/* Wall */}
      <Wall x={0} y={0} w={100} h={25} />
      <ZoneLabel x={2} y={2} label="工作区" />

      {/* Wall decorations */}
      {wallDecorations.map((d, i) =>
        d.type === "bookshelf" ? (
          <Bookshelf key={`wd-${i}`} x={d.x} y={3} />
        ) : d.type === "lamp" ? (
          <Lamp key={`wd-${i}`} x={d.x} y={4} />
        ) : (
          <Plant key={`wd-${i}`} x={d.x} y={6} size="lg" />
        ),
      )}
      <WallClock x={49} y={4} />

      {/* Desks */}
      {positioned.map((_, i) => {
        const pos = deskPosition(i, agents.length);
        return <Desk key={`desk-${i}`} x={pos.x - 9} y={pos.y - 12} />;
      })}

      {/* Floor decorations */}
      <Rug x={35} y={38} w={30} h={15} />
      <WaterCooler x={3} y={35} />
      <Printer x={95} y={36} />
      <Plant x={2} y={28} size="lg" />
      <Plant x={96} y={28} size="lg" />
      <FileCabinet x={6} y={34} />
      <Whiteboard x={42} y={3} />
      <Sofa x={3} y={45} />
      <TrashCan x={93} y={48} />
      <CoffeeMachine x={97} y={34} />
      <Plant x={15} y={42} size="sm" />
      <Plant x={85} y={42} size="sm" />
      <OfficeCat x={50} y={88} />

      {/* Agent characters with mini status HUD */}
      {positioned.map((a) => (
        <AgentCharacter
          key={a.agent.name}
          name={a.agent.name}
          role={a.agent.role}
          provider={a.agent.provider}
          description={a.agent.description}
          state={a.status?.state}
          health={a.status?.health}
          pending={a.status?.pending}
          x={a.pos.x}
          y={a.pos.y}
          onClick={handleClick(a.agent.name)}
        />
      ))}

      {/* Recent Messages Log Panel (bottom-right overlay) */}
      {hasMessages && (
        <div
          className="absolute rounded-lg bg-[#1a1a2e]/90 border border-[#3a3a5d] backdrop-blur-sm overflow-hidden"
          style={{ right: "1.5%", bottom: "8%", width: "28%", maxHeight: "38%", zIndex: 30 }}
        >
          <div className="flex items-center justify-between px-2 py-1 bg-[#2a2a3d]/80 border-b border-[#3a3a5d]">
            <span className="retro text-[6px] text-amber-200/70 tracking-wider">
              MSG LOG
            </span>
            {onViewAllMessages && (
              <button
                className="retro text-[5px] text-amber-200/40 hover:text-amber-200/70 transition-colors"
                onClick={onViewAllMessages}
              >
                ALL &gt;&gt;
              </button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100% - 22px)" }}>
            {recentMessages.slice(0, 6).map((env) => (
              <MiniMessageRow key={env.id} envelope={env} />
            ))}
          </div>
        </div>
      )}

      {/* Projects Board Panel (bottom-left overlay) */}
      {hasProjects && (
        <div
          className="absolute rounded-lg bg-[#1a1a2e]/90 border border-[#3a3a5d] backdrop-blur-sm overflow-hidden"
          style={{ left: "1.5%", bottom: "8%", width: "28%", maxHeight: "38%", zIndex: 30 }}
        >
          <div className="flex items-center justify-between px-2 py-1 bg-[#2a2a3d]/80 border-b border-[#3a3a5d]">
            <span className="retro text-[6px] text-amber-200/70 tracking-wider">
              PROJECTS
            </span>
            {onViewAllProjects && (
              <button
                className="retro text-[5px] text-amber-200/40 hover:text-amber-200/70 transition-colors"
                onClick={onViewAllProjects}
              >
                ALL &gt;&gt;
              </button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100% - 22px)" }}>
            {recentProjects.slice(0, 3).map((proj) => (
              <MiniProjectRow
                key={proj.id}
                project={proj}
                onClick={() => onProjectClick?.(proj.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom status bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center"
        style={{ height: "5%" }}
      >
        <div className="flex items-center gap-2 rounded-t-lg bg-[#3d2b1f]/90 px-4 py-1 shadow-md">
          <span className="text-[10px] font-bold text-amber-300" style={{ fontFamily: "monospace" }}>*</span>
          <span className="text-[10px] font-bold text-amber-100/90 tracking-wider" style={{ fontFamily: "monospace" }}>
            智能体办公室
          </span>
          <span className="text-[10px] font-bold text-amber-300" style={{ fontFamily: "monospace" }}>*</span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Mini Message Row                                                    */
/* ================================================================== */

function MiniMessageRow({ envelope }: { envelope: EnvelopeSummary }) {
  const isBoss = envelope.fromBoss;
  const shortAddr = (addr: string) => {
    const name = addr.replace(/^(agent|channel|boss):/, "");
    return name.length > 8 ? name.slice(0, 7) + ".." : name;
  };
  const text = envelope.text || "(no content)";
  const diff = Date.now() - envelope.createdAt;
  const time = diff < 60_000 ? "now" :
    diff < 3_600_000 ? `${Math.floor(diff / 60_000)}m` :
    diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}h` :
    `${Math.floor(diff / 86_400_000)}d`;

  return (
    <div className="flex items-start gap-1.5 px-2 py-1 border-b border-[#2a2a3d]/30 last:border-0 hover:bg-[#2a2a3d]/30">
      <div className={cn(
        "mt-[3px] size-[5px] shrink-0 rounded-full",
        isBoss ? "bg-sky-400" : "bg-emerald-400",
      )} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-[6px] font-bold text-amber-200/70" style={{ fontFamily: "monospace" }}>
            {shortAddr(envelope.from)}
          </span>
          <span className="text-[5px] text-amber-200/30">→</span>
          <span className="text-[6px] text-amber-200/40" style={{ fontFamily: "monospace" }}>
            {shortAddr(envelope.to)}
          </span>
          <span className="ml-auto text-[5px] text-amber-200/25" style={{ fontFamily: "monospace" }}>
            {time}
          </span>
        </div>
        <p className="text-[6px] text-amber-100/40 truncate leading-tight" style={{ fontFamily: "monospace" }}>
          {text}
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Mini Project Row                                                    */
/* ================================================================== */

function MiniProjectRow({ project, onClick }: { project: ProjectSummary; onClick: () => void }) {
  const diff = Date.now() - (project.updatedAt ?? project.createdAt);
  const time = diff < 60_000 ? "now" :
    diff < 3_600_000 ? `${Math.floor(diff / 60_000)}m` :
    diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}h` :
    `${Math.floor(diff / 86_400_000)}d`;

  const leaderCount = project.leaders?.length ?? 0;

  return (
    <div
      className="flex items-start gap-1.5 px-2 py-1.5 border-b border-[#2a2a3d]/30 last:border-0 hover:bg-[#2a2a3d]/40 cursor-pointer transition-colors"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <div className="mt-[2px] shrink-0">
        <div className="w-[8px] h-[6px] bg-amber-500/70 rounded-t-sm" />
        <div className="w-[10px] h-[7px] bg-amber-500/50 rounded-b-sm -mt-[1px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-[6px] font-bold text-amber-200/80 truncate" style={{ fontFamily: "monospace" }}>
            {project.name}
          </span>
          <span className="ml-auto text-[5px] text-amber-200/25 shrink-0" style={{ fontFamily: "monospace" }}>
            {time}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-[1px]">
          <span className="text-[5px] text-sky-400/60" style={{ fontFamily: "monospace" }}>
            {project.speakerAgent}
          </span>
          {leaderCount > 0 && (
            <span className="text-[5px] text-violet-400/50" style={{ fontFamily: "monospace" }}>
              +{leaderCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

