// Hot numeric voxel loops: index-signature strictness is disabled here for readability.
// @ts-nocheck
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  LOG: 4,
  LEAVES: 5,
  SAND: 6,
  PLANKS: 7,
  COBBLE: 8,
  BRICK: 9,
  GLASS: 10,
  BEDROCK: 11,
  TALLGRASS: 12,
  BOULDER: 13,
  WATER: 14,
  FLOWER: 15,
  REED: 16,
  ALOE: 17,
  JUNGLE_GRASS: 18,
  FERN: 19,
} as const;

export type Tool = "pickaxe" | "axe" | "shovel";

export interface BlockDef {
  name: string;
  hardness: number; // seconds by hand
  tool: Tool | null;
  tiles: [number, number, number]; // top, side, bottom
  drop: number;
  transparent?: boolean;
}

export const BLOCKS: Record<number, BlockDef> = {
  [B.GRASS]: { name: "Savanna Grass", hardness: 0.9, tool: "shovel", tiles: [0, 1, 2], drop: B.DIRT },
  [B.DIRT]: { name: "Red Laterite", hardness: 0.75, tool: "shovel", tiles: [2, 2, 2], drop: B.DIRT },
  [B.STONE]: { name: "Kopje Granite", hardness: 4, tool: "pickaxe", tiles: [3, 3, 3], drop: B.COBBLE },
  [B.LOG]: { name: "Acacia Log", hardness: 2.5, tool: "axe", tiles: [5, 4, 5], drop: B.LOG },
  [B.LEAVES]: { name: "Acacia Leaves", hardness: 0.3, tool: null, tiles: [6, 6, 6], drop: 0, transparent: true },
  [B.SAND]: { name: "Sand", hardness: 0.75, tool: "shovel", tiles: [7, 7, 7], drop: B.SAND },
  [B.PLANKS]: { name: "Iroko Planks", hardness: 2, tool: "axe", tiles: [8, 8, 8], drop: B.PLANKS },
  [B.COBBLE]: { name: "Granite Rubble", hardness: 4.5, tool: "pickaxe", tiles: [9, 9, 9], drop: B.COBBLE },
  [B.BRICK]: { name: "Terracotta Brick", hardness: 5, tool: "pickaxe", tiles: [10, 10, 10], drop: B.BRICK },
  [B.GLASS]: { name: "Glass", hardness: 0.4, tool: null, tiles: [11, 11, 11], drop: 0, transparent: true },
  [B.BEDROCK]: { name: "Bedrock", hardness: Infinity, tool: null, tiles: [12, 12, 12], drop: 0 },
  [B.TALLGRASS]: { name: "Tall Grass", hardness: 0.05, tool: null, tiles: [16, 16, 16], drop: 0, transparent: true },
  [B.BOULDER]: { name: "Boulder", hardness: 3, tool: "pickaxe", tiles: [3, 3, 3], drop: B.COBBLE, transparent: true },
  [B.WATER]: { name: "Water", hardness: Infinity, tool: null, tiles: [20, 20, 20], drop: 0, transparent: true },
  [B.FLOWER]: { name: "Wildflowers", hardness: 0.05, tool: null, tiles: [17, 17, 17], drop: 0, transparent: true },
  [B.REED]: { name: "Papyrus Reeds", hardness: 0.05, tool: null, tiles: [18, 18, 18], drop: 0, transparent: true },
  [B.ALOE]: { name: "Aloe", hardness: 0.1, tool: null, tiles: [19, 19, 19], drop: 0, transparent: true },
  [B.JUNGLE_GRASS]: { name: "Rainforest Grass", hardness: 0.9, tool: "shovel", tiles: [21, 22, 2], drop: B.DIRT },
  [B.FERN]: { name: "Fern", hardness: 0.05, tool: null, tiles: [23, 23, 23], drop: 0, transparent: true },
};

export type Item =
  | { kind: "tool"; tool: Tool; name: string; tile: number; damage: number }
  | { kind: "block"; block: number; name: string; tile: number };

export const HOTBAR: Item[] = [
  { kind: "tool", tool: "pickaxe", name: "Pickaxe", tile: 13, damage: 4 },
  { kind: "tool", tool: "axe", name: "Axe", tile: 14, damage: 5 },
  { kind: "tool", tool: "shovel", name: "Shovel", tile: 15, damage: 3 },
  { kind: "block", block: B.DIRT, name: "Red Laterite", tile: 2 },
  { kind: "block", block: B.COBBLE, name: "Granite Rubble", tile: 9 },
  { kind: "block", block: B.LOG, name: "Acacia Log", tile: 4 },
  { kind: "block", block: B.PLANKS, name: "Iroko Planks", tile: 8 },
  { kind: "block", block: B.SAND, name: "Sand", tile: 7 },
  { kind: "block", block: B.BRICK, name: "Terracotta Brick", tile: 10 },
];

export const isTransparent = (id: number) => id === 0 || !!BLOCKS[id]?.transparent;
/** blocks the player walks through (air + plants) */
export const isPlant = (id: number) => id === B.TALLGRASS || id === B.FLOWER || id === B.REED || id === B.ALOE || id === B.FERN;
export const isPassable = (id: number) => id === 0 || id === B.WATER || isPlant(id);
/** natural terrain that gets smoothed into organic shapes */
export const isNatural = (id: number) => id === B.GRASS || id === B.DIRT || id === B.STONE || id === B.SAND || id === B.JUNGLE_GRASS;


// ---------- Procedural texture atlas (4x4 tiles, 16px each) ----------
export const ATLAS_COLS = 5;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

// Tileable value noise (period p) for realistic surface detail.
function makeNoise(seed: number) {
  const r = rng(seed);
  const g = new Float32Array(256 * 256).map(() => r());
  const at = (x: number, y: number, p: number) => g[((((y % p) + p) % p) << 8) | (((x % p) + p) % p)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const n = (x: number, y: number, p: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
    const a = at(xi, yi, p), b = at(xi + 1, yi, p), c = at(xi, yi + 1, p), d = at(xi + 1, yi + 1, p);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // fbm over u,v in [0,1)
  return (u: number, v: number, base = 4, oct = 4) => {
    let s = 0, amp = 0.5, tot = 0, f = base;
    for (let o = 0; o < oct; o++) { s += n(u * f, v * f, f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  };
}

export function drawAtlas(): HTMLCanvasElement {
  const T = 64;
  const c = document.createElement("canvas");
  c.width = c.height = T * ATLAS_COLS;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  const r = rng(1337);
  const N = makeNoise(7), M = makeNoise(99);
  // f receives u,v in [0,1), per-pixel random n
  const put = (tile: number, f: (u: number, v: number, n: number) => number[] | null) => {
    const ox = (tile % ATLAS_COLS) * T, oy = Math.floor(tile / ATLAS_COLS) * T;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const col = f(x / T, y / T, r());
        if (!col) continue;
        const i = ((oy + y) * c.width + ox + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, col[0]));
        img.data[i + 1] = Math.max(0, Math.min(255, col[1]));
        img.data[i + 2] = Math.max(0, Math.min(255, col[2]));
        img.data[i + 3] = col[3] ?? 255;
      }
  };
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
  const mul = (a: number[], k: number) => a.map((v) => v * k);

  const grassCol = (u: number, v: number, n: number) => {
    const big = N(u, v, 2, 3), fine = M(u, v, 16, 2);
    let col = mix([168, 132, 52], [214, 182, 92], big);
    col = mix(col, [130, 128, 58], Math.max(0, fine - 0.6) * 2);
    return mul(col, 0.82 + fine * 0.3 + (n - 0.5) * 0.12);
  };
  const dirtCol = (u: number, v: number, n: number) => {
    const big = N(u + 0.3, v, 4, 4), peb = M(u, v, 16, 1);
    let col = mix([128, 52, 30], [176, 82, 44], big);
    if (peb > 0.72) col = mix(col, [196, 120, 70], (peb - 0.72) * 4);
    return mul(col, 0.88 + (n - 0.5) * 0.18);
  };
  const stoneCol = (u: number, v: number, n: number) => {
    const big = N(u, v + 0.5, 3, 5), cr = Math.abs(M(u, v, 4, 3) - 0.5);
    let col = mix([128, 108, 92], [184, 162, 138], big);
    if (cr < 0.025) col = mul(col, 0.6);
    return mul(col, 0.9 + (n - 0.5) * 0.12);
  };
  put(0, grassCol);
  put(1, (u, v, n) => {
    const edge = 0.14 + N(u, 0.5, 8, 2) * 0.16;
    if (v < edge) return grassCol(u, v, n);
    const d = dirtCol(u, v, n);
    return v < edge + 0.05 ? mul(d, 0.75) : d;
  });
  put(2, dirtCol);
  put(3, stoneCol);
  // bark: vertical grain
  put(4, (u, v, n) => {
    const g = N(u * 1, v * 0.15, 8, 3), ridge = Math.abs(Math.sin((u * 6 + g * 1.5) * Math.PI));
    return mul(mix([78, 68, 58], [134, 120, 102], ridge * 0.8 + g * 0.3), 0.9 + (n - 0.5) * 0.15);
  });
  // log top: rings
  put(5, (u, v, n) => {
    const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy) + N(u, v, 4, 2) * 0.04;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.44) return mul([96, 82, 66], 0.9 + (n - 0.5) * 0.2);
    const ring = 0.5 + 0.5 * Math.sin(d * 70);
    return mul(mix([168, 96, 60], [206, 140, 92], ring), 0.95 + (n - 0.5) * 0.1);
  });
  put(6, (u, v, n) => {
    // dense acacia foliage: small leaflet clusters, only a few tiny gaps
    const l = M(u, v, 16, 3), big = N(u, v, 4, 2);
    if (l < 0.22 && n > 0.4) return [0, 0, 0, 0];
    const base = mix([86, 112, 40], [150, 160, 70], big);
    return mul(base, 0.8 + l * 0.4 + (n - 0.5) * 0.18);
  });
  put(7, (u, v, n) => mul(mix([214, 170, 112], [236, 200, 140], N(u, v, 8, 3)), 0.94 + (n - 0.5) * 0.14));
  put(8, (u, v, n) => {
    const row = Math.floor(v * 4), fv = v * 4 - row;
    if (fv > 0.93) return [70, 34, 22];
    const seam = (row % 2 ? 0.3 : 0.8);
    if (Math.abs(u - seam) < 0.012) return [82, 40, 26];
    const grain = N(u * 0.2 + row * 0.37, v * 3, 8, 3);
    return mul(mix([132, 64, 38], [176, 96, 58], grain), 0.92 + (n - 0.5) * 0.08);
  });
  put(9, (u, v, n) => {
    // irregular cobbles via cellular-ish noise
    const a = M(u, v, 4, 1), b = N(u, v, 8, 2);
    const edge = Math.abs(a - 0.5) < 0.04;
    const col = mix([120, 98, 80], [180, 156, 128], b);
    return mul(edge ? mul(col, 0.45) : col, 0.9 + (n - 0.5) * 0.15);
  });
  put(10, (u, v, n) => {
    const row = Math.floor(v * 8), off = row % 2 ? 0.125 : 0;
    const fv = v * 8 - row, fu = ((u + off) * 4) % 1;
    if (fv > 0.84 || fu > 0.94) return mul([196, 164, 120], 0.9 + N(u, v, 16, 2) * 0.2);
    const tint = M(Math.floor((u + off) * 4) / 4, row / 8, 4, 1);
    return mul(mix([168, 82, 44], [206, 118, 66], tint), 0.85 + N(u, v, 16, 3) * 0.3);
  });
  put(11, (u, v) => {
    const b = 1 / 16;
    if (u < b || v < b || u > 1 - b || v > 1 - b) return [200, 225, 232, 255];
    if (Math.abs(u - v - 0.1) < 0.03 && u > 0.15 && u < 0.45) return [240, 250, 255, 255];
    return [0, 0, 0, 0];
  });
  put(12, (u, v, n) => mul(mix([30, 30, 32], [90, 90, 90], N(u, v, 4, 4)), 0.9 + (n - 0.5) * 0.3));
  // tools: original 16px pixel art scaled up
  const px = (f: (x: number, y: number) => number[] | null) => (u: number, v: number) => f(Math.floor(u * 16), Math.floor(v * 16));
  const handle = (x: number, y: number) => x + y === 15 && x >= 2 && x <= 11;
  put(13, px((x, y) => {
    if ((y === 2 && x >= 6 && x <= 14) || (x === 13 && y >= 2 && y <= 9) || (y === 3 && x >= 8 && x <= 13) || (x === 12 && y >= 3 && y <= 7))
      return [170, 180, 190, 255];
    if (handle(x, y)) return [120, 85, 45, 255];
    return [0, 0, 0, 0];
  }));
  put(14, px((x, y) => {
    if (x >= 8 && x <= 13 && y >= 1 && y <= 6 && x + y >= 11) return [170, 180, 190, 255];
    if (handle(x, y)) return [120, 85, 45, 255];
    return [0, 0, 0, 0];
  }));
  put(15, px((x, y) => {
    if (x >= 10 && x <= 14 && y >= 1 && y <= 5 && Math.abs(x - 12) + Math.abs(y - 3) <= 3) return [170, 180, 190, 255];
    if (handle(x, y)) return [120, 85, 45, 255];
    return [0, 0, 0, 0];
  }));
  // tall savanna grass: tapered blades with alpha cut-out
  const blades = Array.from({ length: 14 }, (_, i) => ({ x: 0.05 + (i / 14) * 0.9 + (r() - 0.5) * 0.05, h: 0.45 + r() * 0.55, w: 0.025 + r() * 0.02, lean: (r() - 0.5) * 0.25, t: r() }));
  put(16, (u, v, n) => {
    const y = 1 - v; // 0 bottom .. 1 top
    for (const b of blades) {
      if (y > b.h) continue;
      const k = y / b.h, cx = b.x + b.lean * k * k, w = b.w * (1 - k * 0.85);
      if (Math.abs(u - cx) < w) {
        const base = mix([110, 120, 40], [214, 186, 96], k * 0.7 + b.t * 0.4);
        return [...mul(base, 0.85 + (n - 0.5) * 0.15), 255];
      }
    }
    return [0, 0, 0, 0];
  });
  // plant sprite helper: tapered stems with optional heads
  const sprite = (tile: number, n0: number, stem: number[], head: ((k: number) => number[]) | null, hmin: number, hmax: number, wid: number) => {
    const st = Array.from({ length: n0 }, (_, i) => ({ x: 0.08 + (i / n0) * 0.84 + (r() - 0.5) * 0.06, h: hmin + r() * (hmax - hmin), w: wid * (0.7 + r() * 0.6), lean: (r() - 0.5) * 0.3, k: r() }));
    put(tile, (u, v, n) => {
      const y = 1 - v;
      for (const b of st) {
        if (y > b.h + 0.08) continue;
        const k = Math.min(1, y / b.h), cx = b.x + b.lean * k * k;
        if (head && y > b.h - 0.06 && Math.hypot((u - cx) * 1.2, y - b.h) < 0.075) return [...head(b.k).map((c) => c * (0.85 + (n - 0.5) * 0.2)), 255];
        if (y <= b.h && Math.abs(u - cx) < b.w * (1 - k * 0.6)) return [...mul(stem, 0.8 + k * 0.35 + (n - 0.5) * 0.15), 255];
      }
      return [0, 0, 0, 0];
    });
  };
  const petals = [[220, 50, 40], [245, 200, 40], [90, 120, 220], [240, 240, 230], [230, 110, 30]];
  sprite(17, 9, [80, 120, 40], (k) => petals[Math.floor(k * petals.length)], 0.3, 0.7, 0.018);
  sprite(18, 8, [96, 132, 50], () => [150, 160, 80], 0.75, 0.98, 0.022);
  // aloe: fleshy rosette of spiky leaves fanning from the base
  put(19, (u, v, n) => {
    const y = 1 - v, dx = u - 0.5;
    for (let i = 0; i < 7; i++) {
      const ang = -1.2 + (i / 6) * 2.4, len = 0.55 + ((i * 37) % 5) * 0.06;
      const t = (dx * Math.sin(ang) + y * Math.cos(ang)) / len, off = Math.abs(dx * Math.cos(ang) - y * Math.sin(ang));
      if (t > 0 && t < 1 && off < 0.07 * (1 - t)) return [...mul(mix([70, 110, 80], [120, 150, 100], t), 0.85 + (n - 0.5) * 0.2), 255];
    }
    if (y > 0.5 && y < 0.95 && Math.abs(dx - 0.05) < 0.012) return [120, 100, 60, 255];
    if (y > 0.85 && y < 0.98 && Math.abs(dx - 0.05) < 0.04) return [230, 90, 40, 255];
    return [0, 0, 0, 0];
  });
  put(20, (u, v, n) => {
    const w = N(u, v, 4, 3), rip = 0.5 + 0.5 * Math.sin((u + w * 0.6) * Math.PI * 8);
    return [...mul(mix([40, 110, 150], [80, 170, 200], w * 0.7 + rip * 0.3), 0.95 + (n - 0.5) * 0.06), 255];
  });
  const jgCol = (u: number, v: number, n: number) => {
    const big = N(u, v, 2, 3), fine = M(u, v, 16, 2);
    return mul(mix([46, 104, 34], [86, 150, 50], big), 0.82 + fine * 0.3 + (n - 0.5) * 0.12);
  };
  put(21, jgCol);
  put(22, (u, v, n) => {
    const edge = 0.16 + N(u, 0.5, 8, 2) * 0.18;
    return v < edge ? jgCol(u, v, n) : dirtCol(u, v, n);
  });
  // fern: arching fronds with leaflets
  put(23, (u, v, n) => {
    const y = 1 - v, dx = u - 0.5;
    for (let i = 0; i < 5; i++) {
      const ang = -1.0 + (i / 4) * 2.0;
      const t = (dx * Math.sin(ang) + y * Math.cos(ang)) / 0.8, off = dx * Math.cos(ang) - y * Math.sin(ang);
      if (t <= 0 || t >= 1) continue;
      const bend = off + t * t * 0.15 * Math.sign(ang || 1);
      if (Math.abs(bend) < 0.012) return [60, 100, 30, 255];
      if (Math.abs(bend) < 0.09 * (1 - t) && Math.sin(t * 60) > -0.2) return [...mul([60, 130, 45], 0.8 + t * 0.4 + (n - 0.5) * 0.15), 255];
    }
    return [0, 0, 0, 0];
  });
  ctx.putImageData(img, 0, 0);
  return c;
}
