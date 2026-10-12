import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { B } from "./blocks";
import { World, type Edits } from "./world";

const SAVE_KEY = "voxelcraft-save-v1";
export const MAX_HEALTH = 20;

export const ui = {
  health: MAX_HEALTH,
  selected: 0,
  counts: { [B.DIRT]: 0, [B.COBBLE]: 0, [B.LOG]: 0, [B.PLANKS]: 32, [B.SAND]: 0, [B.BRICK]: 32 } as Record<number, number>,
  time: 0.05,
  breakProgress: 0,
  locked: false,
  dead: false,
  hurt: 0,
  atlasUrl: "",
  lastSaved: 0,
};

let version = 0;
const listeners = new Set<() => void>();
export function emit() {
  version++;
  listeners.forEach((l) => l());
}
// For per-frame updates: re-render the HUD at most ~12 times a second.
let lastEmit = 0;
export function emitThrottled() {
  const now = performance.now();
  if (now - lastEmit < 80) return;
  lastEmit = now;
  emit();
}
export function useUI() {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
    () => version,
  );
  return ui;
}

export interface Zombie {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  cool: number;
  hurt: number;
}

export interface Game {
  world: World;
  spawn: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  zombies: Zombie[];
  lastHurt: number;
  controls: { lock: () => void } | null;
}

let game: Game | null = null;

export function getGame(): Game {
  if (game) return game;
  let saved: any = null;
  try {
    saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
  } catch {
    saved = null;
  }
  const seed = saved?.seed ?? Math.floor(Math.random() * 1e9);
  const world = new World(seed, (saved?.edits as Edits) ?? {});
  const spawn = new THREE.Vector3(8.5, world.surface(8, 8) + 0.5, 8.5);
  const pos = saved?.pos ? new THREE.Vector3(...saved.pos) : spawn.clone();
  if (saved) {
    ui.health = saved.health ?? MAX_HEALTH;
    ui.counts = { ...ui.counts, ...saved.counts };
    ui.time = saved.time ?? ui.time;
    ui.selected = saved.selected ?? 0;
    if (ui.health <= 0) ui.health = MAX_HEALTH;
  }
  game = { world, spawn, pos, vel: new THREE.Vector3(), zombies: [], lastHurt: 0, controls: null };
  return game;
}

export function saveGame() {
  if (!game) return;
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        seed: game.world.seed,
        edits: game.world.edits,
        pos: game.pos.toArray(),
        health: ui.health,
        counts: ui.counts,
        time: ui.time,
        selected: ui.selected,
      }),
    );
    ui.lastSaved = Date.now();
  } catch (e) {
    console.warn("Save failed", e);
  }
  emit();
}

export function newWorld() {
  localStorage.removeItem(SAVE_KEY);
  window.location.reload();
}

export function damage(n: number, now: number) {
  if (ui.dead) return;
  ui.health = Math.max(0, ui.health - n);
  ui.hurt = 1;
  if (game) game.lastHurt = now;
  if (ui.health <= 0) {
    ui.dead = true;
    document.exitPointerLock?.();
  }
  emit();
}

export function respawn() {
  if (!game) return;
  game.pos.copy(game.spawn);
  game.vel.set(0, 0, 0);
  game.zombies = [];
  ui.health = MAX_HEALTH;
  ui.dead = false;
  emit();
  saveGame();
}
