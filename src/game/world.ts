// Hot numeric voxel loops: index-signature strictness is disabled here for readability.
// @ts-nocheck
import * as THREE from "three";
import { B, BLOCKS, ATLAS_COLS, isTransparent, isPassable, isNatural, isPlant } from "./blocks";

export const CH = 16;
export const H = 64;
export const WATER_LEVEL = 15;

export function hash2(x: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x: number, z: number, seed: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, seed: number, oct: number) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += noise(x * f, z * f, seed + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

const idx = (x: number, y: number, z: number) => (y * CH + z) * CH + x;
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

export type Edits = Record<string, Record<number, number>>;

export class World {
  chunks = new Map<string, Uint8Array>();
  versions = new Map<string, number>();
  constructor(public seed: number, public edits: Edits = {}) {}

  private hcache = new Map<number, number>();
  height(x: number, z: number) {
    const key = x * 100003 + z;
    let v = this.hcache.get(key);
    if (v === undefined) {
      v = this.computeHeight(x, z);
      if (this.hcache.size > 400000) this.hcache.clear();
      this.hcache.set(key, v);
    }
    return v;
  }
  /** 0 = desert, 1 = rainforest, in between = savanna (smooth weights) */
  biome(x: number, z: number) {
    const t = fbm(x / 420, z / 420, this.seed + 91, 3);
    const desert = Math.max(0, Math.min(1, (0.42 - t) / 0.07));
    const jungle = Math.max(0, Math.min(1, (t - 0.58) / 0.07));
    return { desert, jungle };
  }
  private computeHeight(x: number, z: number) {
    const { desert, jungle } = this.biome(x, z);
    // rolling savanna hills: domain-warped broad swells
    const wx = x + (fbm(x / 90, z / 90, this.seed + 21, 2) - 0.5) * 40;
    const wz = z + (fbm(x / 90, z / 90, this.seed + 23, 2) - 0.5) * 40;
    const n = fbm(wx / 70, wz / 70, this.seed, 4);
    const m = fbm(wx / 220, wz / 220, this.seed + 7, 2);
    let h = 15 + n * 6 + m * 9;
    // sinuous desert dunes (sharp crest ridges)
    if (desert > 0) {
      const dn = noise(wx / 26 + m * 3, wz / 60, this.seed + 95);
      const dune = 16 + Math.pow(1 - Math.abs(dn * 2 - 1), 2) * 11 + n * 3;
      h += (dune - h) * desert;
    }
    // rainforest: lower, lumpier valleys
    if (jungle > 0) h += (13 + n * 9 + fbm(wx / 30, wz / 30, this.seed + 97, 3) * 5 - h) * jungle;
    // mountain ranges: a continental mask gates ridged noise -> sharp crests & cliffs
    const mask = fbm(x / 340, z / 340, this.seed + 41, 2);
    const mt = Math.max(0, Math.min(1, (mask - 0.52) / 0.14)) * (1 - desert);
    if (mt > 0) {
      let rid = 0, amp = 0.5, f = 1 / 60, w = 1;
      for (let o = 0; o < 4; o++) {
        const r = 1 - Math.abs(noise(wx * f, wz * f, this.seed + 51 + o * 7) * 2 - 1);
        const s = r * r * w;
        rid += s * amp; w = Math.min(1, s * 1.6); amp *= 0.5; f *= 2.1;
      }
      h += mt * mt * (3 - 2 * mt) * rid * 46;
    }
    // rivers (deep & wet in the rainforest, dry wadis elsewhere)
    const r = Math.abs(fbm(wx / 120, wz / 120, this.seed + 31, 2) - 0.5);
    const rw = 0.04 + jungle * 0.02;
    if (r < rw && mt < 0.3) h -= (1 - r / rw) ** 2 * (3 + jungle * 5);
    // watering holes & oases
    const p = fbm(x / 55, z / 55, this.seed + 101, 3);
    if (p > 0.66 && mt < 0.2) { const t = Math.min(1, (p - 0.66) / 0.08); h -= t * t * (3 - 2 * t) * (6 + desert * 6); }
    // granite kopjes on the savanna plains
    const k = fbm(x / 22, z / 22, this.seed + 11, 3);
    const sav = 1 - Math.max(desert, jungle);
    if (k > 0.6 && mt < 0.2) { const t = Math.min(1, (k - 0.6) / 0.12); h += t * t * (3 - 2 * t) * 10 * sav; }
    return Math.max(4, Math.min(H - 6, Math.floor(h)));
  }
  isKopje(x: number, z: number) {
    return fbm(x / 22, z / 22, this.seed + 11, 3) > 0.64;
  }
  isMountain(x: number, z: number) {
    return fbm(x / 340, z / 340, this.seed + 41, 2) > 0.56;
  }

  getChunk(cx: number, cz: number) {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = this.generate(cx, cz);
      this.chunks.set(k, c);
    }
    return c;
  }

  private generate(cx: number, cz: number) {
    const c = new Uint8Array(CH * H * CH);
    const heights: number[] = [];
    const biomes: number[] = []; // 0 savanna, 1 desert, 2 jungle
    for (let z = 0; z < CH; z++)
      for (let x = 0; x < CH; x++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = this.height(wx, wz);
        heights[z * CH + x] = h;
        const bm = this.biome(wx, wz);
        const kind = bm.desert > 0.5 ? 1 : bm.jungle > 0.5 ? 2 : 0;
        biomes[z * CH + x] = kind;
        const beach = h <= WATER_LEVEL + 1;
        const slope = Math.max(
          Math.abs(this.height(wx + 1, wz) - h), Math.abs(this.height(wx - 1, wz) - h),
          Math.abs(this.height(wx, wz + 1) - h), Math.abs(this.height(wx, wz - 1) - h),
        );
        const rock = kind !== 1 && ((kind === 0 && this.isKopje(wx, wz) && !this.isMountain(wx, wz)) || slope >= 3 || h > 38 + hash2(wx, wz, this.seed + 61) * 4);
        const soil = kind === 1 ? 6 : h > 28 ? 2 : 4;
        const topId = kind === 1 || beach ? B.SAND : kind === 2 ? B.JUNGLE_GRASS : B.GRASS;
        for (let y = 0; y <= h; y++) {
          let id: number = B.STONE;
          if (y === 0) id = B.BEDROCK;
          else if (!rock && y >= h - soil) id = y === h ? topId : kind === 1 || beach ? B.SAND : B.DIRT;
          c[idx(x, y, z)] = id;
        }
        for (let y = h + 1; y <= WATER_LEVEL; y++) c[idx(x, y, z)] = B.WATER;
      }
    const put = (x: number, y: number, z: number, id: number, force = false) => {
      if (x < 0 || z < 0 || x >= CH || z >= CH || y < 1 || y >= H) return;
      const i = idx(x, y, z);
      if (force || c[i] === 0 || isPlant(c[i])) c[i] = id;
    };
    // ground cover
    for (let z = 0; z < CH; z++)
      for (let x = 0; x < CH; x++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = heights[z * CH + x], kind = biomes[z * CH + x];
        if (h + 3 >= H) continue;
        const top = c[idx(x, h, z)], above = c[idx(x, h + 1, z)];
        const rr = hash2(wx, wz, this.seed + 71), r2 = hash2(wx, wz, this.seed + 73);
        if (above === B.WATER) {
          // papyrus in shallow water
          if (h === WATER_LEVEL - 1 && rr < 0.45) c[idx(x, h + 1, z)] = B.REED;
          continue;
        }
        if (top === B.SAND && h <= WATER_LEVEL + 2 && kind !== 1 ? rr < 0.25 : top === B.SAND && h <= WATER_LEVEL + 1 && rr < 0.35) { c[idx(x, h + 1, z)] = B.REED; continue; }
        if (top === B.GRASS) {
          const meadow = fbm(wx / 28, wz / 28, this.seed + 81, 3);
          const dens = meadow > 0.55 ? 0.8 : meadow > 0.45 ? 0.25 : 0.04;
          if (rr < dens) c[idx(x, h + 1, z)] = B.TALLGRASS;
          else if (r2 < 0.05 && meadow > 0.4) c[idx(x, h + 1, z)] = B.FLOWER;
          else if (rr > 0.997) c[idx(x, h + 1, z)] = B.BOULDER;
          else if (rr > 0.9955 && x > 0 && z > 0 && x < CH - 1 && z < CH - 1) {
            // termite mound: tapered red-clay spire (smoothing rounds it off)
            const mh = 2 + Math.floor(r2 * 3);
            for (let y = 1; y <= mh; y++) put(x, h + y, z, B.DIRT, true);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, h + 1, z + dz, B.DIRT, true);
          }
        } else if (top === B.JUNGLE_GRASS) {
          if (rr < 0.35) c[idx(x, h + 1, z)] = B.FERN;
          else if (rr < 0.6) c[idx(x, h + 1, z)] = B.TALLGRASS;
          else if (rr < 0.63) c[idx(x, h + 1, z)] = B.FLOWER;
        } else if (top === B.SAND && kind === 1) {
          if (rr < 0.004) c[idx(x, h + 1, z)] = B.ALOE;
          else if (rr > 0.9985) c[idx(x, h + 1, z)] = B.BOULDER;
        } else if (top === B.STONE) {
          if (rr < 0.035) c[idx(x, h + 1, z)] = B.BOULDER;
          else if (rr < 0.07 && kind === 0) c[idx(x, h + 1, z)] = B.ALOE;
        }
      }

    const blob = (tx: number, ty: number, tz: number, rx: number, ry: number) => {
      for (let dy = -ry; dy <= ry; dy++)
        for (let dz = -rx; dz <= rx; dz++)
          for (let dx = -rx; dx <= rx; dx++)
            if ((dx * dx + dz * dz) / (rx * rx + 0.5) + (dy * dy) / (ry * ry + 0.5) <= 1) put(tx + dx, ty + dy, tz + dz, B.LEAVES);
    };
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // flora (kept inside the chunk)
    for (let z = 4; z < CH - 4; z++)
      for (let x = 4; x < CH - 4; x++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = heights[z * CH + x], kind = biomes[z * CH + x];
        const top = c[idx(x, h, z)];
        if (h + 14 >= H || c[idx(x, h + 1, z)] === B.WATER) continue;
        const r = hash2(wx, wz, this.seed + 3);
        const hr = hash2(wx, wz, this.seed + 5);
        // date palms around oases and shores
        const shore = h <= WATER_LEVEL + 3 && top === B.SAND;
        if ((shore && r < 0.03) || (kind === 2 && top === B.JUNGLE_GRASS && r > 0.992)) {
          const th = 5 + Math.floor(hr * 3);
          const [ldx, ldz] = DIRS[Math.floor(hash2(wx, wz, this.seed + 9) * 4)];
          let px = x, pz = z;
          for (let y = 1; y <= th; y++) {
            if (y === Math.floor(th * 0.6)) { px += ldx; pz += ldz; } // gentle lean
            put(px, h + y, pz, B.LOG, true);
          }
          const ty = h + th;
          put(px, ty + 1, pz, B.LEAVES);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            put(px + dx, ty + 1, pz + dz, B.LEAVES);
            put(px + dx * 2, ty, pz + dz * 2, B.LEAVES);
            if (!dx || !dz) put(px + dx * 3, ty - 1, pz + dz * 3, B.LEAVES);
          }
          c[idx(x, h, z)] = top === B.SAND ? B.SAND : B.DIRT;
          continue;
        }
        if (top === B.JUNGLE_GRASS && r < 0.045) {
          // rainforest giant: tall straight trunk, buttress roots, layered round canopy
          const th = 7 + Math.floor(hr * 5);
          for (let y = 1; y <= th; y++) put(x, h + y, z, B.LOG, true);
          for (const [dx, dz] of DIRS) put(x + dx, h + 1, z + dz, B.LOG, true);
          blob(x, h + th + 1, z, 3, 2);
          const [bx, bz] = DIRS[Math.floor(hash2(wx, wz, this.seed + 9) * 4)];
          blob(x + bx * 2, h + th - 2, z + bz * 2, 2, 1);
          c[idx(x, h, z)] = B.DIRT;
          continue;
        }
        if (top !== B.GRASS) continue;
        if (r < 0.0025) {
          // Baobab: fat swollen bottle trunk, stubby branches, small tufted crowns
          const th = 7 + Math.floor(hr * 4);
          for (let y = h + 1; y <= h + th; y++) {
            const k = (y - h) / th, rad = k < 0.75 ? 1.6 : 0.9;
            for (let dz = -2; dz <= 2; dz++)
              for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= rad * rad) put(x + dx, y, z + dz, B.LOG, true);
          }
          const top2 = h + th;
          for (const [bx, bz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
            for (let s2 = 1; s2 <= 2; s2++) put(x + bx * (1 + s2), top2 + s2 - 1, z + bz * (1 + s2), B.LOG, true);
            blob(x + bx * 3, top2 + 2, z + bz * 3, 1, 1);
          }
          c[idx(x, h, z)] = B.DIRT;
        } else if (r < 0.014) {
          // Umbrella acacia: trunk forks into rising limbs, each carrying a wide flat canopy
          const th = 3 + Math.floor(hr * 2);
          for (let y = h + 1; y <= h + th; y++) put(x, y, z, B.LOG, true);
          const d0 = Math.floor(hash2(wx, wz, this.seed + 9) * 4);
          const limbs = [DIRS[d0], DIRS[d0 ^ 1]];
          if (hash2(wx, wz, this.seed + 13) > 0.6) limbs.push(DIRS[(d0 + 2) % 4]);
          const tips: number[][] = [];
          for (const [ldx, ldz] of limbs) {
            let bx = x, by = h + th, bz = z;
            for (let s2 = 0; s2 < 2; s2++) {
              bx += ldx; bz += ldz; put(bx, by, bz, B.LOG, true);
              by++; put(bx, by, bz, B.LOG, true);
            }
            tips.push([bx, by, bz]);
          }
          for (const [tx, ty, tz] of tips)
            for (let dz = -3; dz <= 3; dz++)
              for (let dx = -3; dx <= 3; dx++) {
                const d = dx * dx + dz * dz;
                if (d <= 8) put(tx + dx, ty + 1, tz + dz, B.LEAVES);
                if (d <= 3) put(tx + dx, ty + 2, tz + dz, B.LEAVES);
              }
          c[idx(x, h, z)] = B.DIRT;
        }
      }
    const e = this.edits[chunkKey(cx, cz)];
    if (e) for (const k in e) c[+k] = e[k];
    return c;
  }

  get(x: number, y: number, z: number) {
    if (y < 0) return B.BEDROCK;
    if (y >= H) return 0;
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    return this.getChunk(cx, cz)[idx(x - cx * CH, y, z - cz * CH)];
  }

  set(x: number, y: number, z: number, id: number) {
    if (y < 1 || y >= H) return;
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    const lx = x - cx * CH, lz = z - cz * CH;
    const k = chunkKey(cx, cz);
    const i = idx(lx, y, lz);
    this.getChunk(cx, cz)[i] = id;
    (this.edits[k] ??= {})[i] = id;
    this.bump(cx, cz);
    if (lx === 0) this.bump(cx - 1, cz);
    if (lx === CH - 1) this.bump(cx + 1, cz);
    if (lz === 0) this.bump(cx, cz - 1);
    if (lz === CH - 1) this.bump(cx, cz + 1);
  }

  bump(cx: number, cz: number) {
    const k = chunkKey(cx, cz);
    this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
  }
  version(cx: number, cz: number) {
    return this.versions.get(chunkKey(cx, cz)) ?? 0;
  }

  surface(x: number, z: number) {
    for (let y = H - 1; y > 0; y--) if (this.get(x, y, z) !== 0) return y + 1;
    return H;
  }
}

// ---------- Meshing ----------
const FACES = [
  { d: [-1, 0, 0], s: 0.8, c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { d: [1, 0, 0], s: 0.8, c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { d: [0, -1, 0], s: 0.5, c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { d: [0, 1, 0], s: 1, c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { d: [0, 0, -1], s: 0.65, c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { d: [0, 0, 1], s: 0.65, c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

const AO = [1, 0.78, 0.6, 0.45];
const solid = (id: number) => (id !== 0 && !isTransparent(id) ? 1 : 0);

// unit rock template: icosphere (non-indexed triangles)
const ROCK = new THREE.IcosahedronGeometry(0.5, 1).getAttribute("position").array as Float32Array;

/** Smooth natural terrain: pull convex edges in, push concave corners out (watertight: depends only on lattice point). */
function smoothOffset(world: World, X: number, Y: number, Z: number, out: number[]) {
  let cnt = 0, sx = 0, sy = 0, sz = 0;
  for (let dy = -1; dy <= 0; dy++)
    for (let dz = -1; dz <= 0; dz++)
      for (let dx = -1; dx <= 0; dx++) {
        const id = world.get(X + dx, Y + dy, Z + dz);
        if (id === 0 || isPassable(id) || id === B.BOULDER || id === B.LEAVES) continue;
        if (!isNatural(id)) { out[0] = out[1] = out[2] = 0; return; }
        cnt++; sx += dx + 0.5; sy += dy + 0.5; sz += dz + 0.5;
      }
  if (cnt === 0 || cnt === 8 || cnt === 4) { out[0] = out[1] = out[2] = 0; return; }
  const k = ((4 - cnt) / 4) / cnt * 0.85;
  out[0] = sx * k; out[1] = sy * k; out[2] = sz * k;
}

export function buildChunkGeometry(world: World, cx: number, cz: number) {
  const chunk = world.getChunk(cx, cz);
  const pos: number[] = [], uv: number[] = [], col: number[] = [], ind: number[] = [];
  const ox = cx * CH, oz = cz * CH;
  const eps = 0.001;
  const off = [0, 0, 0];
  const tileUV = (tile: number, u: number, v: number) => {
    const tc = tile % ATLAS_COLS, tr = Math.floor(tile / ATLAS_COLS);
    u = Math.min(1 - eps, Math.max(eps, u)); v = Math.min(1 - eps, Math.max(eps, v));
    uv.push((tc + u) / ATLAS_COLS, 1 - (tr + 1 - v) / ATLAS_COLS);
  };
  for (let y = 0; y < H; y++)
    for (let z = 0; z < CH; z++)
      for (let x = 0; x < CH; x++) {
        const id = chunk[idx(x, y, z)];
        if (!id) continue;
        const def = BLOCKS[id];
        const wx = ox + x, wz = oz + z;
        if (id === B.TALLGRASS) {
          // two crossed double-sided blades
          const j = (hash2(wx, wz, 5) - 0.5) * 0.3, j2 = (hash2(wx, wz, 9) - 0.5) * 0.3;
          const sc = 0.8 + hash2(wx, wz, 13) * 0.45;
          const quads = [[[0.1, 0.1], [0.9, 0.9]], [[0.1, 0.9], [0.9, 0.1]]];
          for (const [[ax, az], [bx, bz]] of quads) {
            for (let side = 0; side < 2; side++) {
              // separate vertices per side so normals don't cancel out (dark blades)
              const base = pos.length / 3;
              pos.push(wx + ax + j, y, wz + az + j2, wx + bx + j, y, wz + bz + j2, wx + ax + j, y + sc, wz + az + j2, wx + bx + j, y + sc, wz + bz + j2);
              tileUV(16, 0, 0); tileUV(16, 1, 0); tileUV(16, 0, 1); tileUV(16, 1, 1);
              for (const l of [0.75, 0.75, 1.1, 1.1]) col.push(l, l, l);
              if (side) ind.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
              else ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            }
          }
          continue;
        }
        if (id === B.BOULDER) {
          const s = 0.75 + hash2(wx, wz + y, 17) * 0.4, sy = 0.6 + hash2(wx, wz, 19) * 0.3;
          const rot = hash2(wx, wz, 23) * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
          const base = pos.length / 3;
          for (let i = 0; i < ROCK.length; i += 3) {
            const px = ROCK[i], py = ROCK[i + 1], pz = ROCK[i + 2];
            const q = Math.round(px * 97) * 7 + Math.round(py * 97) * 131 + Math.round(pz * 97) * 977;
            const d = 0.8 + hash2(q, wx * 31 + wz, y) * 0.4;
            const rx = (px * cr - pz * sr) * d * s, rz = (px * sr + pz * cr) * d * s, ry = py * d * sy;
            pos.push(wx + 0.5 + rx, y + Math.max(-0.05, ry + sy * 0.4), wz + 0.5 + rz);
            tileUV(3, rx + 0.5, ry + rz + 0.5);
            const l = 0.75 + 0.25 * (py + 0.5);
            col.push(l, l, l);
            ind.push(base + i / 3);
          }
          continue;
        }
        const nat = isNatural(id);
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.d[0], ny = y + F.d[1], nz = z + F.d[2];
          const n =
            nx >= 0 && nx < CH && nz >= 0 && nz < CH
              ? ny < 0 ? 1 : ny >= H ? 0 : chunk[idx(nx, ny, nz)]
              : world.get(ox + nx, ny, oz + nz);
          if (!(isTransparent(n) && n !== id)) continue;
          const tile = f === 3 ? def.tiles[0] : f === 2 ? def.tiles[2] : def.tiles[1];
          const tc = tile % ATLAS_COLS, tr = Math.floor(tile / ATLAS_COLS);
          const base = pos.length / 3;
          const ao: number[] = [];
          for (const c of F.c) {
            // vertex ambient occlusion: sample the 3 neighbours around this corner on the face's outer side
            const sx = c[0] * 2 - 1, sy = c[1] * 2 - 1, sz = c[2] * 2 - 1;
            const ax = F.d[0] ? 0 : sx, ay = F.d[1] ? 0 : sy, az = F.d[2] ? 0 : sz;
            const bx = ox + nx, by = ny, bz = oz + nz;
            // two tangent axes
            const t1 = F.d[0] ? [0, ay, 0] : [ax, 0, 0];
            const t2 = F.d[2] ? [0, ay, 0] : [0, 0, az];
            const s1 = solid(world.get(bx + t1[0], by + t1[1], bz + t1[2]));
            const s2 = solid(world.get(bx + t2[0], by + t2[1], bz + t2[2]));
            const sc = solid(world.get(bx + t1[0] + t2[0], by + t1[1] + t2[1], bz + t1[2] + t2[2]));
            const occ = s1 && s2 ? 3 : s1 + s2 + sc;
            ao.push(AO[occ]);
          }
          let k = 0;
          for (const c of F.c) {
            const X = ox + x + c[0], Y = y + c[1], Z = oz + z + c[2];
            if (nat) smoothOffset(world, X, Y, Z, off); else off[0] = off[1] = off[2] = 0;
            pos.push(X + off[0], Y + off[1], Z + off[2]);
            const u = (tc + (c[3] ? 1 - eps : eps)) / ATLAS_COLS;
            const v = 1 - (tr + 1 - (c[4] ? 1 - eps : eps)) / ATLAS_COLS;
            uv.push(u, v);
            // foliage scatters light through itself, so its undersides never go pitch black
            const l = id === B.LEAVES ? 0.9 + 0.1 * F.s * ao[k++] + 0.25 : (0.82 + 0.18 * F.s) * ao[k++];
            col.push(l, l, l);
          }
          // flip quad diagonal to avoid anisotropic AO artifacts
          if (ao[0] + ao[3] < ao[1] + ao[2]) ind.push(base, base + 1, base + 3, base, base + 3, base + 2);
          else ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------- Physics helpers ----------
export function collides(world: World, p: THREE.Vector3, hw: number, h: number) {
  const e = 0.001;
  for (let x = Math.floor(p.x - hw + e); x <= Math.floor(p.x + hw - e); x++)
    for (let y = Math.floor(p.y + e); y <= Math.floor(p.y + h - e); y++)
      for (let z = Math.floor(p.z - hw + e); z <= Math.floor(p.z + hw - e); z++)
        if (!isPassable(world.get(x, y, z))) return true;
  return false;
}

export function moveEntity(world: World, p: THREE.Vector3, v: THREE.Vector3, dt: number, hw: number, h: number, canStep = false) {
  let onGround = false, hitWall = false, stepped = 0;
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt) / 0.2));
  const sdt = dt / steps;
  // grounded check before moving, so step-up only happens while walking
  p.y -= 0.05;
  const grounded = collides(world, p, hw, h);
  p.y += 0.05;
  for (let s = 0; s < steps; s++)
    for (const a of ["x", "y", "z"] as const) {
      const d = v[a] * sdt;
      if (!d) continue;
      p[a] += d;
      if (collides(world, p, hw, h)) {
        if (a !== "y" && canStep && grounded) {
          // auto step-up onto a single block ledge
          const oy = p.y;
          p.y = Math.floor(p.y + 0.001) + 1.001;
          if (p.y - oy <= 1.05 && !collides(world, p, hw, h)) { stepped += p.y - oy; continue; }
          p.y = oy;
        }
        p[a] -= d;
        if (a === "y") {
          if (v.y < 0) onGround = true;
        } else hitWall = true;
        v[a] = 0;
      }
    }
  if (stepped) onGround = true;
  return { onGround, hitWall, stepped };
}

export function raycast(world: World, o: THREE.Vector3, d: THREE.Vector3, max: number) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
  let tx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
  let ty = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
  let tz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
  let prev: [number, number, number] = [x, y, z];
  let t = 0;
  while (t <= max) {
    const id = world.get(x, y, z);
    if (id !== 0 && id !== B.WATER) return { pos: [x, y, z] as [number, number, number], prev, id, dist: t };
    prev = [x, y, z];
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}
