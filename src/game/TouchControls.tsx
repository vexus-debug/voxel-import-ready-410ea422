import { useRef, useState } from "react";
import { touch } from "./touch";
import { saveGame, ui, emit } from "./state";

const R = 55;

export function TouchControls() {
  const joyId = useRef<number | null>(null);
  const joyOrigin = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });

  // When the game frame is rotated (portrait screen playing landscape), pointer
  // coordinates arrive in page space but the game lives in the rotated local
  // space: local x = page y, local y = page width - page x.
  const local = (e: React.PointerEvent) => {
    if (window.innerHeight > window.innerWidth) {
      return { x: e.clientY, y: window.innerWidth - e.clientX };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const p = local(e);
    const wide = window.innerHeight > window.innerWidth ? window.innerHeight : window.innerWidth;
    const leftHalf = p.x < wide / 2;
    if (leftHalf && joyId.current === null) {
      joyId.current = e.pointerId;
      joyOrigin.current = p;
      setKnob({ x: 0, y: 0, ox: p.x, oy: p.y });
    } else if (!leftHalf && lookId.current === null) {
      lookId.current = e.pointerId;
      lookLast.current = p;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (e.pointerId === joyId.current) {
      let dx = p.x - joyOrigin.current.x, dy = p.y - joyOrigin.current.y;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      touch.moveX = dx / R;
      touch.moveY = -dy / R;
      touch.sprint = len > R * 1.4;
      setKnob((k) => (k ? { ...k, x: dx, y: dy } : k));
    } else if (e.pointerId === lookId.current) {
      touch.lookDX += p.x - lookLast.current.x;
      touch.lookDY += p.y - lookLast.current.y;
      lookLast.current = p;
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId === joyId.current) {
      joyId.current = null;
      touch.moveX = touch.moveY = 0;
      touch.sprint = false;
      setKnob(null);
    } else if (e.pointerId === lookId.current) lookId.current = null;
  };

  const btn = "pointer-events-auto flex items-center justify-center rounded-full border-2 border-border bg-background/50 text-lg active:bg-foreground/30 select-none touch-none";

  return (
    <div className="pointer-events-none fixed inset-0 z-20 font-pixel text-foreground">
      <div
        className="pointer-events-auto absolute inset-x-0 top-14 bottom-28 touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {knob && (
        <div className="absolute rounded-full border-2 border-border bg-background/30" style={{ width: R * 2, height: R * 2, left: knob.ox - R, top: knob.oy - R }}>
          <div className="absolute rounded-full bg-foreground/50" style={{ width: 44, height: 44, left: R - 22 + knob.x, top: R - 22 + knob.y }} />
        </div>
      )}
      <button
        className={`${btn} absolute right-4 top-4 h-11 w-11`}
        onClick={() => { ui.locked = false; emit(); saveGame(); }}
      >
        II
      </button>
      <div className="absolute bottom-32 right-4 flex flex-col items-end gap-3">
        <button
          className={`${btn} h-16 w-16`}
          onPointerDown={(e) => { e.preventDefault(); touch.primaryDown(); }}
          onPointerUp={() => touch.primaryUp()}
          onPointerCancel={() => touch.primaryUp()}
          onPointerLeave={() => touch.primaryUp()}
        >
          ⛏
        </button>
        <div className="flex gap-3">
          <button className={`${btn} h-16 w-16`} onPointerDown={(e) => { e.preventDefault(); touch.place(); }}>
            ▣
          </button>
          <button
            className={`${btn} h-16 w-16`}
            onPointerDown={(e) => { e.preventDefault(); touch.jump = true; }}
            onPointerUp={() => (touch.jump = false)}
            onPointerCancel={() => (touch.jump = false)}
            onPointerLeave={() => (touch.jump = false)}
          >
            ▲
          </button>
        </div>
      </div>
    </div>
  );
}
