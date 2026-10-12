// Hot numeric voxel loops: index-signature strictness is disabled here for readability.
// @ts-nocheck
import * as THREE from "three";
import { B, BLOCKS, ATLAS_COLS, isTransparent, isPassable, isNatural } from "./blocks";

export const CH = 16;
export const H = 64;

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
  private computeHeight(x: number, z: number) {
    // rolling savanna hills: domain-warped broad swells
    const wx = x + (fbm(x / 90, z / 90, this.seed + 21, 2) - 0.5) * 40;
    const wz = z + (fbm(x / 90, z / 90, this.seed + 23, 2) - 0.5) * 40;
    const n = fbm(wx / 70, wz / 70, this.seed, 4);
    const m = fbm(wx / 220, wz / 220, this.seed + 7, 2);
    let h = 14 + n * 6 + m * 9;
    // mountain ranges: a continental mask gates ridged noise -> sharp crests & cliffs
    const mask = fbm(x / 340, z / 340, this.seed + 41, 2);
    const mt = Math.max(0, Math.min(1, (mask - 0.52) / 0.14));
    if (mt > 0) {
      let rid = 0, amp = 0.5, f = 1 / 60, w = 1;
      for (let o = 0; o < 4; o++) {
        const r = 1 - Math.abs(noise(wx * f, wz * f, this.seed + 51 + o * 7) * 2 - 1);
        const s = r * r * w;
        rid += s * amp; w = Math.min(1, s * 1.6); amp *= 0.5; f *= 2.1;
      }
      h += mt * mt * (3 - 2 * mt) * rid * 46;
    }
    // dry riverbeds (wadis)
    const r = Math.abs(fbm(wx / 120, wz / 120, this.seed + 31, 2) - 0.5);
    if (r < 0.04 && mt < 0.3) h -= (1 - r / 0.04) ** 2 * 3;
    // granite kopjes on the plains
    const k = fbm(x / 22, z / 22, this.seed + 11, 3);
    if (k > 0.6 && mt < 0.2) { const t = Math.min(1, (k - 0.6) / 0.12); h += t * t * (3 - 2 * t) * 10; }
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
    for (let z = 0; z < CH; z++)
      for (let x = 0; x < CH; x++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = this.height(wx, wz);
        heights[z * CH + x] = h;
        const beach = h <= 15;
        const slope = Math.max(
          Math.abs(this.height(wx + 1, wz) - h), Math.abs(this.height(wx - 1, wz) - h),
          Math.abs(this.height(wx, wz + 1) - h), Math.abs(this.height(wx, wz - 1) - h),
        );
        const rock = (this.isKopje(wx, wz) && !this.isMountain(wx, wz)) || slope >= 3 || h > 38 + hash2(wx, wz, this.seed + 61) * 4;
        const soil = h > 28 ? 2 : 4;
        for (let y = 0; y <= h; y++) {
          let id: number = B.STONE;
          if (y === 0) id = B.BEDROCK;
          else if (!rock && y >= h - soil) id = y === h ? (beach ? B.SAND : B.GRASS) : beach ? B.SAND : B.DIRT;
          c[idx(x, y, z)] = id;
        }
      }
    // ground cover: tall grass meadows + scattered boulders
    for (let z = 0; z < CH; z++)
      for (let x = 0; x < CH; x++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = heights[z * CH + x];
        if (h + 1 >= H) continue;
        const top = c[idx(x, h, z)];
        const rr = hash2(wx, wz, this.seed + 71);
        if (top === B.GRASS) {
          const meadow = fbm(wx / 28, wz / 28, this.seed + 81, 3);
          const dens = meadow > 0.55 ? 0.85 : meadow > 0.45 ? 0.25 : 0.03;
          if (rr < dens) c[idx(x, h + 1, z)] = B.TALLGRASS;
          else if (rr > 0.997) c[idx(x, h + 1, z)] = B.BOULDER;
        } else if (top === B.STONE && rr < 0.035) c[idx(x, h + 1, z)] = B.BOULDER;
      }

    const put = (x: number, y: number, z: number, id: number, force = false) => {
      if (x < 0 || z < 0 || x >= CH || z >= CH || y < 1 || y >= H) return;
      const i = idx(x, y, z);
      if (force || c[i] === 0) c[i] = id;
    };
    // flora (kept inside the chunk)
    for (let z = 4; z < CH - 4; z++)
      for (let x = 4; x < CH - 4; x++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = heights[z * CH + x];
        if (c[idx(x, h, z)] !== B.GRASS) continue;
        const r = hash2(wx, wz, this.seed + 3);
        if (r < 0.0025) {
          // Baobab: fat 2x2 swollen trunk, short branches, small crown
          const th = 8 + Math.floor(hash2(wx, wz, this.seed + 5) * 4);
          for (let y = h + 1; y <= h + th; y++)
            for (let dz = -1; dz <= 1; dz++)
              for (let dx = -1; dx <= 1; dx++) {
                const mid = y - h > 2 && y - h < th - 2;
                if (!mid && Math.abs(dx) + Math.abs(dz) === 2) continue;
                put(x + dx, y, z + dz, B.LOG, true);
              }
          const top = h + th;
          for (const [bx, bz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
            for (let s2 = 1; s2 <= 2; s2++) put(x + bx * (1 + s2), top + s2 - 1, z + bz * (1 + s2), B.LOG, true);
            const lx = x + bx * 3, lz = z + bz * 3, ly = top + 2;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { put(lx + dx, ly, lz + dz, B.LEAVES); if (!dx || !dz) put(lx + dx, ly + 1, lz + dz, B.LEAVES); }
          }
          c[idx(x, h, z)] = B.DIRT;
        } else if (r < 0.014) {
          // Acacia: straight trunk that forks into 2 rising limbs, each carrying a flat umbrella pad
          const th = 3 + Math.floor(hash2(wx, wz, this.seed + 5) * 2);
          for (let y = h + 1; y <= h + th; y++) put(x, y, z, B.LOG, true);
          const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          const d0 = Math.floor(hash2(wx, wz, this.seed + 9) * 4);
          const limbs = [DIRS[d0], DIRS[d0 ^ 1]]; // opposite directions
          if (hash2(wx, wz, this.seed + 13) > 0.6) limbs.push(DIRS[(d0 + 2) % 4]);
          const tips: number[][] = [];
          for (const [ldx, ldz] of limbs) {
            let bx = x, by = h + th, bz = z;
            for (let s2 = 0; s2 < 2; s2++) {
              bx += ldx; bz += ldz; put(bx, by, bz, B.LOG, true); // diagonal staircase stays connected
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
            const base = pos.length / 3;
            pos.push(wx + ax + j, y, wz + az + j2, wx + bx + j, y, wz + bz + j2, wx + ax + j, y + sc, wz + az + j2, wx + bx + j, y + sc, wz + bz + j2);
            tileUV(16, 0, 0); tileUV(16, 1, 0); tileUV(16, 0, 1); tileUV(16, 1, 1);
            for (const l of [0.7, 0.7, 1, 1]) col.push(l, l, l);
            ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3, base, base + 2, base + 1, base + 2, base + 3, base + 1);
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
    if (id !== 0) return { pos: [x, y, z] as [number, number, number], prev, id, dist: t };
    prev = [x, y, z];
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}
