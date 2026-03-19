/* ================================================================== */
/*  Pixel Office Furniture & Decoration Components                     */
/* ================================================================== */

export function Wall({ x, w, h, y }: { x: number; y: number; w: number; h: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}>
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

export function Desk({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "18%", height: "10%", zIndex: 5 }}>
      <div className="absolute inset-x-0 top-0 h-[40%] rounded-t-sm bg-[#8B7355] border-2 border-[#6d5a43] shadow-[2px_2px_0_#4a3c2e]" />
      <div className="absolute top-[-22%] left-[30%] h-[28%] w-[40%] rounded-sm bg-[#2a2a3d] border-2 border-[#1a1a2e]">
        <div className="m-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] bg-[#1a3a2a]">
          <div className="h-full w-full bg-gradient-to-b from-[#2a5a3a] to-[#1a3a2a] opacity-80" />
        </div>
      </div>
      <div className="absolute top-[5%] left-[45%] h-[8%] w-[10%] bg-[#3a3a4d]" />
      <div className="absolute top-[8%] left-[25%] h-[6%] w-[30%] rounded-sm bg-[#4a4a5d] border border-[#3a3a4d]" />
      <div className="absolute top-[4%] right-[12%] h-[8px] w-[8px] rounded-sm bg-white border border-zinc-300">
        <div className="m-[1px] h-[3px] w-[3px] rounded-full bg-[#6a4a30]" />
      </div>
      <div className="absolute bottom-0 left-[8%] h-[60%] w-[6%] bg-[#6d5a43]" />
      <div className="absolute bottom-0 right-[8%] h-[60%] w-[6%] bg-[#6d5a43]" />
    </div>
  );
}

export function Bookshelf({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "10%", height: "13%", zIndex: 6 }}>
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

export function Plant({ x, y, size }: { x: number; y: number; size: "sm" | "lg" }) {
  const s = size === "lg" ? 4 : 2.5;
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 8 }}>
      <div
        className="rounded-b-sm bg-[#b85c38] border border-[#944a2c]"
        style={{ width: `${s * 1.2}%`, height: `${s * 0.6}vh`, marginTop: "-2px" }}
      />
      <div
        className="absolute rounded-full bg-[#4a8c5c] border border-[#3a7a4c]"
        style={{ width: `${s * 2}%`, height: `${s * 1.5}vh`, bottom: "60%", left: "50%", transform: "translateX(-50%)" }}
      />
      {size === "lg" && (
        <div
          className="absolute rounded-full bg-[#5a9c6c] border border-[#4a8c5c]"
          style={{ width: `${s * 1.4}%`, height: `${s * 1.2}vh`, bottom: "80%", left: "30%", transform: "translateX(-50%)" }}
        />
      )}
    </div>
  );
}

export function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 7 }}>
      <div className="h-3 w-4 rounded-t-full bg-[#f0c060] border border-[#d4a040] shadow-[0_0_8px_#f0c060aa]" />
      <div className="mx-auto h-4 w-[2px] bg-[#8a7a60]" />
      <div className="mx-auto h-[2px] w-3 rounded bg-[#8a7a60]" />
    </div>
  );
}

export function WallClock({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 7 }}>
      <div className="h-5 w-5 rounded-full bg-white border-2 border-[#5a4030] shadow-[1px_1px_0_#3d2b1f]">
        <div className="absolute top-[50%] left-[50%] h-[5px] w-[1px] -translate-x-1/2 origin-bottom -rotate-45 bg-zinc-800" style={{ bottom: "50%" }} />
        <div className="absolute top-[25%] left-[50%] h-[7px] w-[1px] -translate-x-1/2 origin-bottom rotate-90 bg-zinc-600" style={{ bottom: "50%" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[2px] w-[2px] rounded-full bg-red-500" />
      </div>
    </div>
  );
}

export function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      <div className="h-4 w-3 rounded-t-full bg-[#a0d4e8] border border-[#80b4c8] mx-auto" />
      <div className="relative h-5 w-4 bg-[#e0e0e0] border border-[#c0c0c0] mx-auto rounded-b-sm">
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-[3px] w-[3px] rounded-full bg-blue-400" />
      </div>
    </div>
  );
}

export function Rug({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="absolute rounded-sm opacity-30"
      style={{
        left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, zIndex: 1,
        background: "repeating-linear-gradient(45deg, #8B4513, #8B4513 4px, #A0522D 4px, #A0522D 8px)",
        border: "2px solid #6B3410",
      }}
    />
  );
}

export function Printer({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      <div className="h-4 w-6 bg-[#d0d0d0] border border-[#a0a0a0] rounded-sm">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-4 bg-white border border-[#c0c0c0] rounded-t-sm" style={{ top: "-2px" }} />
        <div className="absolute top-[2px] left-[2px] h-[4px] w-[8px] bg-[#2a4a3a] rounded-[1px]" />
      </div>
      <div className="h-3 w-5 bg-[#b0b0b0] border border-[#909090] mx-auto rounded-b-sm" />
    </div>
  );
}

export function FileCabinet({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      <div className="h-8 w-5 bg-[#8a8a9a] border border-[#6a6a7a] rounded-sm">
        <div className="absolute top-[2px] inset-x-[2px] h-[8px] bg-[#9a9aaa] border-b border-[#6a6a7a]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[2px] w-[4px] bg-[#5a5a6a] rounded-full" />
        </div>
        <div className="absolute top-[12px] inset-x-[2px] h-[8px] bg-[#9a9aaa] border-b border-[#6a6a7a]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[2px] w-[4px] bg-[#5a5a6a] rounded-full" />
        </div>
        <div className="absolute top-[22px] inset-x-[2px] h-[8px] bg-[#9a9aaa]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[2px] w-[4px] bg-[#5a5a6a] rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function Whiteboard({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: "16%", height: "14%", zIndex: 7 }}>
      <div className="absolute inset-0 bg-white/90 border-2 border-[#8a8a9a] rounded-sm shadow-[1px_1px_0_#5a5a6a]">
        <div className="absolute top-[12%] left-[8%] h-[2px] w-[40%] bg-blue-400/50 rounded" />
        <div className="absolute top-[25%] left-[8%] h-[2px] w-[60%] bg-blue-400/40 rounded" />
        <div className="absolute top-[38%] left-[8%] h-[2px] w-[35%] bg-red-400/40 rounded" />
        <div className="absolute top-[51%] left-[8%] h-[2px] w-[55%] bg-emerald-400/40 rounded" />
        <div className="absolute top-[64%] left-[8%] h-[2px] w-[45%] bg-blue-400/30 rounded" />
        <div className="absolute top-[15%] right-[8%] h-[18%] w-[20%] bg-yellow-300/70 rounded-[1px] shadow-sm" />
        <div className="absolute top-[45%] right-[8%] h-[18%] w-[20%] bg-pink-300/60 rounded-[1px] shadow-sm" />
        <div className="absolute bottom-[10%] right-[8%] h-[18%] w-[20%] bg-sky-300/60 rounded-[1px] shadow-sm" />
      </div>
      <div className="absolute -bottom-[4px] left-[10%] right-[10%] h-[4px] bg-[#8a8a9a] rounded-b-sm" />
    </div>
  );
}

export function Sofa({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      <div className="h-3 w-10 bg-[#6a4a8a] border border-[#5a3a7a] rounded-t-md" />
      <div className="h-3 w-12 bg-[#7a5a9a] border border-[#5a3a7a] rounded-b-sm -mt-[1px]">
        <div className="absolute top-[2px] left-1/3 h-[6px] w-[1px] bg-[#6a4a8a]/50" />
        <div className="absolute top-[2px] left-2/3 h-[6px] w-[1px] bg-[#6a4a8a]/50" />
      </div>
      <div className="absolute top-0 -left-[3px] h-5 w-[4px] bg-[#5a3a7a] rounded-l-sm" />
      <div className="absolute top-0 -right-[3px] h-5 w-[4px] bg-[#5a3a7a] rounded-r-sm" />
      <div className="absolute top-[1px] left-[4px] h-[6px] w-[8px] bg-[#e8c0f0] rounded-sm border border-[#d0a0e0]" />
    </div>
  );
}

export function TrashCan({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      <div className="h-4 w-3 bg-[#7a7a8a] border border-[#5a5a6a] rounded-b-sm">
        <div className="absolute -top-[2px] -left-[1px] h-[3px] w-[calc(100%+2px)] bg-[#6a6a7a] rounded-t-sm border border-[#5a5a6a]" />
        <div className="absolute top-[4px] left-[3px] h-[5px] w-[1px] bg-[#5a5a6a]" />
        <div className="absolute top-[4px] left-[6px] h-[5px] w-[1px] bg-[#5a5a6a]" />
        <div className="absolute top-[4px] left-[9px] h-[5px] w-[1px] bg-[#5a5a6a]" />
      </div>
    </div>
  );
}

export function CoffeeMachine({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 6 }}>
      <div className="h-5 w-4 bg-[#2a2a2a] border border-[#1a1a1a] rounded-sm">
        <div className="absolute top-[2px] left-[2px] h-[4px] w-[10px] bg-[#4a8a5a] rounded-[1px]" />
        <div className="absolute bottom-[2px] left-1/2 -translate-x-1/2 h-[4px] w-[6px] bg-[#3a3a3a] rounded-b-sm" />
      </div>
      <div className="absolute -top-[4px] left-1/2 -translate-x-1/2 flex gap-[1px]">
        <div className="h-[3px] w-[1px] bg-white/30 animate-pulse" />
        <div className="h-[4px] w-[1px] bg-white/20 animate-pulse [animation-delay:200ms]" />
        <div className="h-[3px] w-[1px] bg-white/25 animate-pulse [animation-delay:400ms]" />
      </div>
    </div>
  );
}

export function OfficeCat({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 9 }}>
      <div className="relative">
        <div className="h-[6px] w-[14px] bg-[#e8a040] rounded-full border border-[#c08030]" />
        <div className="absolute -left-[4px] top-[-2px] h-[7px] w-[7px] bg-[#e8a040] rounded-full border border-[#c08030]">
          <div className="absolute -top-[3px] left-[0px] h-0 w-0 border-l-[2px] border-r-[2px] border-b-[3px] border-l-transparent border-r-transparent border-b-[#e8a040]" />
          <div className="absolute -top-[3px] right-[0px] h-0 w-0 border-l-[2px] border-r-[2px] border-b-[3px] border-l-transparent border-r-transparent border-b-[#e8a040]" />
          <div className="absolute top-[2px] left-[1px] h-[1px] w-[2px] bg-[#3a3a3a]" />
          <div className="absolute top-[2px] right-[1px] h-[1px] w-[2px] bg-[#3a3a3a]" />
        </div>
        <div className="absolute -right-[5px] top-[-3px] h-[4px] w-[6px] bg-[#e8a040] rounded-full border border-[#c08030]" style={{ transform: "rotate(-30deg)" }} />
        <div className="absolute -top-[6px] right-[-8px] flex flex-col items-start">
          <span className="text-[5px] font-bold text-amber-300/50 animate-pulse" style={{ fontFamily: "monospace" }}>z</span>
        </div>
      </div>
    </div>
  );
}

export function ZoneLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, zIndex: 30 }}>
      <span
        className="rounded bg-[#1a1a2e]/70 px-1.5 py-0.5 text-[8px] font-bold text-amber-200/80 tracking-wider"
        style={{ fontFamily: "monospace" }}
      >
        [{label}]
      </span>
    </div>
  );
}
