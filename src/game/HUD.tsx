import { ATLAS_COLS, HOTBAR } from "./blocks";
import { touch, isTouchDevice } from "./touch";
import { emit, ui as uiState } from "./state";
import { getGame, newWorld, respawn, saveGame, useUI, MAX_HEALTH } from "./state";

function Icon({ tile, url, size = 36 }: { tile: number; url: string; size?: number }) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const step = 100 / (ATLAS_COLS - 1);
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: `${ATLAS_COLS * 100}%`,
        backgroundPosition: `${col * step}% ${row * step}%`,
        imageRendering: "pixelated",
      }}
    />
  );
}

function clockLabel(t: number) {
  const hours = (t * 24 + 6) % 24;
  const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function HUD() {
  const ui = useUI();
  const item = HOTBAR[ui.selected]!;
  const isNight = Math.sin(ui.time * Math.PI * 2) < -0.1;
  const lock = () => {
    if (isTouchDevice()) {
      touch.enabled = true;
      uiState.locked = true;
      emit();
      document.documentElement.requestFullscreen?.().catch(() => {});
      // Try to hold the device in landscape; the rotated frame handles it if unsupported.
      const so = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      so?.lock?.("landscape")?.catch?.(() => {});
    } else getGame().controls?.lock();
  };

  return (
    <div className="dark pointer-events-none fixed inset-0 z-10 font-pixel text-foreground">
      {/* hurt flash */}
      <div className="absolute inset-0 bg-destructive" style={{ opacity: ui.hurt * 0.35 }} />

      {/* top bar */}
      <div className="absolute left-4 top-4 rounded-md bg-background/60 px-3 py-1.5 text-xl leading-none">
        {isNight ? "☾ Night" : "☀ Day"} · {clockLabel(ui.time)}
      </div>

      {/* crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl leading-none drop-shadow">+</div>
      {ui.breakProgress > 0 && (
        <div className="absolute left-1/2 top-1/2 mt-6 h-1.5 w-16 -translate-x-1/2 overflow-hidden rounded bg-background/70">
          <div className="h-full bg-primary" style={{ width: `${Math.min(1, ui.breakProgress) * 100}%` }} />
        </div>
      )}

      {/* bottom: hearts + hotbar */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="text-lg leading-none">{item.name}</div>
        <div className="flex gap-0.5 self-start text-2xl leading-none drop-shadow">
          {Array.from({ length: MAX_HEALTH / 2 }, (_, i) => {
            const v = ui.health - i * 2;
            return (
              <span key={i} className={v > 0 ? "text-destructive" : "text-muted-foreground/60"}>
                {v === 1 ? "❥" : "♥"}
              </span>
            );
          })}
        </div>
        <div className="flex gap-1 rounded-md bg-background/60 p-1">
          {HOTBAR.map((it, i) => (
            <div
              key={i}
              onPointerDown={() => { uiState.selected = i; emit(); }}
              className={`pointer-events-auto relative flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded border-2 ${
                i === ui.selected ? "border-foreground bg-foreground/15" : "border-border"
              }`}
            >
              <Icon tile={it.tile} url={ui.atlasUrl} />
              <span className="absolute left-1 top-0 text-sm text-muted-foreground">{i + 1}</span>
              {it.kind === "block" && (
                <span className="absolute bottom-0 right-1 text-lg leading-none drop-shadow">{ui.counts[it.block] ?? 0}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* pause menu */}
      {!ui.locked && !ui.dead && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="w-[min(92vw,460px)] rounded-lg border border-border bg-card p-6 text-center text-card-foreground">
            <h1 className="text-5xl leading-none tracking-wide text-primary">VOXELCRAFT</h1>
            <p className="mt-2 text-lg text-muted-foreground">Survive the night. Build anything.</p>
            <button onClick={lock} className="mt-5 w-full rounded-md bg-primary py-3 text-2xl text-primary-foreground hover:opacity-90">
              {isTouchDevice() ? "Tap to play" : "Click to play"}
            </button>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-left text-lg">
              <span className="text-muted-foreground">WASD</span><span>Move</span>
              <span className="text-muted-foreground">Mouse</span><span>Look</span>
              <span className="text-muted-foreground">Space / Shift</span><span>Jump / Sprint</span>
              <span className="text-muted-foreground">Hold left click</span><span>Break / attack</span>
              <span className="text-muted-foreground">Right click</span><span>Place block</span>
              <span className="text-muted-foreground">1–9 / wheel</span><span>Select item</span>
              <span className="text-muted-foreground">Esc</span><span>Pause</span>
              <span className="text-muted-foreground">Mobile</span><span>Left: move · Right: look</span>
            </div>
            <p className="mt-3 text-base text-muted-foreground">
              Use the right tool to mine faster. Zombies come out at night.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={saveGame} className="flex-1 rounded-md border border-border py-2 text-lg hover:bg-accent">
                Save now
              </button>
              <button
                onClick={() => confirm("Delete this world and start a new one?") && newWorld()}
                className="flex-1 rounded-md border border-border py-2 text-lg text-destructive hover:bg-accent"
              >
                New world
              </button>
            </div>
            {ui.lastSaved > 0 && <p className="mt-2 text-sm text-muted-foreground">World saved automatically</p>}
          </div>
        </div>
      )}

      {/* death screen */}
      {ui.dead && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-5 bg-destructive/40">
          <h2 className="text-6xl drop-shadow">You died!</h2>
          <button
            onClick={() => {
              respawn();
              lock();
            }}
            className="rounded-md bg-primary px-10 py-3 text-2xl text-primary-foreground hover:opacity-90"
          >
            Respawn
          </button>
        </div>
      )}
    </div>
  );
}
