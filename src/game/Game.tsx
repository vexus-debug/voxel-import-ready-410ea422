import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BLOCKS, HOTBAR, drawAtlas } from "./blocks";
import { CH, buildChunkGeometry, moveEntity, raycast, collides, type World } from "./world";
import { damage, emit, emitThrottled, getGame, saveGame, ui, MAX_HEALTH, type Zombie } from "./state";
import { HUD } from "./HUD";
import { touch, isTouchDevice } from "./touch";
import { TouchControls } from "./TouchControls";
import { useUI } from "./state";

const RADIUS = isTouchDevice() ? 3 : 4;
const SHADOW_RES = isTouchDevice() ? 1024 : 2048;
const WHITE = new THREE.Color(1, 1, 1);
const MOON_COL = new THREE.Color("#b4ceff");
const MOON_AMB = new THREE.Color("#3a5580");
const DAY_LENGTH = 480; // seconds per full day
const REACH = 5;

const budget = { t: -1, n: 0 };
function takeBudget(t: number) {
  if (budget.t !== t) {
    budget.t = t;
    budget.n = 2;
  }
  return budget.n-- > 0;
}

function ChunkMesh({ cx, cz, world, material }: { cx: number; cz: number; world: World; material: THREE.Material }) {
  const ref = useRef<THREE.Mesh>(null);
  const ver = useRef(-1);
  useFrame((s) => {
    const v = world.version(cx, cz);
    if (v === ver.current || !ref.current) return;
    if (ver.current === -1 && !takeBudget(s.clock.elapsedTime)) return;
    ver.current = v;
    const old = ref.current.geometry;
    ref.current.geometry = buildChunkGeometry(world, cx, cz);
    old.dispose();
  });
  useEffect(() => () => ref.current?.geometry.dispose(), []);
  return <mesh ref={ref} material={material} castShadow receiveShadow />;
}

function Chunks({ material }: { material: THREE.Material }) {
  const g = getGame();
  const [center, setCenter] = useState(() => [Math.floor(g.pos.x / CH), Math.floor(g.pos.z / CH)]);
  useFrame(() => {
    const cx = Math.floor(g.pos.x / CH), cz = Math.floor(g.pos.z / CH);
    if (cx !== center[0] || cz !== center[1]) setCenter([cx, cz]);
  });
  const list = useMemo(() => {
    const out: [number, number][] = [];
    for (let dz = -RADIUS; dz <= RADIUS; dz++)
      for (let dx = -RADIUS; dx <= RADIUS; dx++) if (dx * dx + dz * dz <= RADIUS * RADIUS + 1) out.push([center[0]! + dx, center[1]! + dz]);
    return out.sort((a, b) => Math.hypot(a[0] - center[0]!, a[1] - center[1]!) - Math.hypot(b[0] - center[0]!, b[1] - center[1]!));
  }, [center]);
  return (
    <>
      {list.map(([cx, cz]) => (
        <ChunkMesh key={`${cx},${cz}`} cx={cx} cz={cz} world={g.world} material={material} />
      ))}
    </>
  );
}

function Sky() {
  const { scene } = useThree();
  const amb = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const sunMesh = useRef<THREE.Mesh>(null);
  const moonMesh = useRef<THREE.Mesh>(null);
  const day = useMemo(() => new THREE.Color("#a9d6f5"), []);
  const zenDay = useMemo(() => new THREE.Color("#2c74d4"), []);
  const zen = useMemo(() => new THREE.Color(), []);
  const dusk = useMemo(() => new THREE.Color("#e8854a"), []);
  const night = useMemo(() => new THREE.Color("#120a2a"), []);
  const col = useMemo(() => new THREE.Color(), []);
  const acc = useRef(0);
  useFrame((_, delta) => {
    const g = getGame();
    const dt = Math.min(delta, 0.05);
    ui.time = (ui.time + dt / DAY_LENGTH) % 1;
    const a = ui.time * Math.PI * 2;
    const sy = Math.sin(a);
    const light = THREE.MathUtils.smoothstep(sy, -0.2, 0.3);
    const duskAmt = Math.max(0, 1 - Math.abs(sy) * 4) * 0.6;
    col.copy(night).lerp(day, light).lerp(dusk, duskAmt * light + duskAmt * 0.3);
    scene.background = col;
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(col);
    const moon = 1 - light;
    if (amb.current) {
      amb.current.intensity = 0.25 + 0.55 * light + 0.2 * moon;
      amb.current.color.copy(col).lerp(WHITE, 0.4).lerp(MOON_AMB, moon * 0.7);
    }
    if (sun.current) {
      const s = sun.current;
      // the same light acts as the sun by day and the moon (opposite side of the sky) by night
      const isMoon = sy < 0;
      const ly = isMoon ? -sy : sy;
      const lx = isMoon ? -Math.cos(a) : Math.cos(a);
      if (isMoon) {
        s.intensity = 0.75 * moon;
        s.color.copy(MOON_COL);
      } else {
        s.intensity = 2.4 * light;
        // warm low sun at dawn/dusk, neutral at noon
        s.color.setRGB(1, 0.7 + 0.22 * Math.min(1, sy * 2), 0.45 + 0.3 * Math.min(1, sy * 2));
      }
      // snap to texel-ish grid to reduce shadow shimmer while walking
      const px = Math.round(g.pos.x), py = Math.round(g.pos.y), pz = Math.round(g.pos.z);
      s.position.set(px + lx * 40, py + Math.max(ly, 0.15) * 50, pz + 15);
      s.target.position.set(px, py, pz);
      s.target.updateMatrixWorld();
      s.castShadow = s.intensity > 0.05;
    }
    // sky dome follows the camera; sun & moon are drawn as round discs with glow in its shader
    if (sunMesh.current) {
      sunMesh.current.position.set(g.pos.x, g.pos.y + 1.62, g.pos.z);
      const u = skyMat.uniforms as any;
      u.sunDir.value.set(Math.cos(a), sy, 0.25).normalize();
      zen.copy(night).lerp(zenDay, light).lerp(dusk, duskAmt * light * 0.35);
      u.zenith.value.copy(zen);
      u.time.value += dt;
      u.horizon.value.copy(col).lerp(WHITE, 0.18 * light);
      u.sunCol.value.setRGB(1, 0.75 + 0.2 * Math.min(1, Math.max(0, sy * 2)), 0.5 + 0.35 * Math.min(1, Math.max(0, sy * 2)));
      u.night.value = 1 - light;
    }
    acc.current += dt;
    if (acc.current > 1) {
      acc.current = 0;
      emit();
    }
  });
  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          sunDir: { value: new THREE.Vector3(1, 1, 0).normalize() },
          zenith: { value: new THREE.Color("#c98a4a") },
          horizon: { value: new THREE.Color("#f2c98a") },
          sunCol: { value: new THREE.Color("#fff2c0") },
          night: { value: 0 },
          time: { value: 0 },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 sunDir, zenith, horizon, sunCol; uniform float night, time; varying vec3 vDir;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
          void main(){
            vec3 d = normalize(vDir);
            float t = pow(clamp(d.y,0.0,1.0), 0.45);
            vec3 c = mix(horizon, zenith, t);
            if (d.y < 0.0) c = horizon * (1.0 + d.y*0.3);
            float s = dot(d, sunDir);
            float disc = smoothstep(0.9990, 0.9994, s);
            float glow = pow(max(s,0.0), 600.0)*1.2 + pow(max(s,0.0), 40.0)*0.35 + pow(max(s,0.0), 6.0)*0.12;
            c += sunCol * (disc*2.5 + glow) * (1.0 - night*0.9);
            float m = dot(d, -sunDir);
            float moon = smoothstep(0.9993, 0.9996, m);
            c = mix(c, vec3(0.88,0.9,0.95), moon * night);
            c += vec3(0.6,0.65,0.8) * pow(max(m,0.0), 200.0) * 0.25 * night;
            vec3 g = floor(d*400.0);
            float star = step(0.9975, h(g)) * night * smoothstep(0.0, 0.3, d.y);
            c += vec3(star);
            // drifting cumulus clouds projected on a high plane
            if (d.y > 0.0) {
              vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(time * 0.012, time * 0.005);
              float f = fbm(cp);
              float cov = smoothstep(0.48, 0.72, f);
              float under = fbm(cp + sunDir.xz * 0.06);
              float lit = clamp(0.75 + (f - under) * 3.0, 0.45, 1.15);
              vec3 dayCloud = mix(vec3(0.72,0.76,0.84), vec3(1.0), lit);
              dayCloud = mix(dayCloud, dayCloud * sunCol, 0.25);
              vec3 cc = mix(dayCloud, vec3(0.12,0.13,0.2), night);
              float fade = smoothstep(0.0, 0.18, d.y);
              c = mix(c, cc, cov * fade * 0.95);
            }
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );
  return (
    <>
      <fog attach="fog" args={["#a9d6f5", 18, RADIUS * CH - 4]} />
      <hemisphereLight ref={amb} args={["#ffe2b0", "#8a3a1e", 0.7]} />
      <directionalLight
        ref={sun}
        intensity={2}
        castShadow
        shadow-mapSize-width={SHADOW_RES}
        shadow-mapSize-height={SHADOW_RES}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      <mesh ref={sunMesh} material={skyMat} renderOrder={-1} frustumCulled={false}>
        <sphereGeometry args={[200, 32, 16]} />
      </mesh>
    </>
  );
}

function Zombies({ target }: { target: React.MutableRefObject<ZombieTarget> }) {
  const g = getGame();
  const [ids, setIds] = useState<number[]>([]);
  const groups = useRef(new Map<number, THREE.Group>());
  const nextId = useRef(1);
  const spawnTimer = useRef(0);
  useFrame((s, delta) => {
    const dt = Math.min(delta, 0.05);
    const isNight = Math.sin(ui.time * Math.PI * 2) < -0.1;
    let changed = false;
    if (isNight && !ui.dead) {
      spawnTimer.current -= dt;
      if (spawnTimer.current <= 0 && g.zombies.length < 6) {
        spawnTimer.current = 6;
        const ang = Math.random() * Math.PI * 2, r = 16 + Math.random() * 8;
        const x = Math.floor(g.pos.x + Math.cos(ang) * r), z = Math.floor(g.pos.z + Math.sin(ang) * r);
        g.zombies.push({ id: nextId.current++, pos: new THREE.Vector3(x + 0.5, g.world.surface(x, z), z + 0.5), vel: new THREE.Vector3(), hp: 12, cool: 0, hurt: 0 });
        changed = true;
      }
    } else if (!isNight && g.zombies.length) {
      g.zombies = g.zombies.filter((z) => Math.random() > dt * 0.5); // burn away at dawn
      changed = true;
    }
    const before = g.zombies.length;
    g.zombies = g.zombies.filter((z) => z.hp > 0 && z.pos.distanceTo(g.pos) < 60 && z.pos.y > -10);
    if (g.zombies.length !== before) changed = true;

    const now = s.clock.elapsedTime;
    for (const z of g.zombies) {
      const dx = g.pos.x - z.pos.x, dz = g.pos.z - z.pos.z;
      const dist = Math.hypot(dx, dz);
      const speed = dist < 28 && !ui.dead ? 2.3 : 0;
      if (z.hurt <= 0 && dist > 0.8) {
        z.vel.x = (dx / dist) * speed;
        z.vel.z = (dz / dist) * speed;
      } else {
        z.vel.x *= Math.exp(-4 * dt);
        z.vel.z *= Math.exp(-4 * dt);
      }
      z.vel.y -= 28 * dt;
      const res = moveEntity(g.world, z.pos, z.vel, dt, 0.3, 1.8);
      if (res.hitWall && res.onGround) z.vel.y = 8.5;
      z.cool -= dt;
      z.hurt -= dt;
      if (dist < 1.1 && Math.abs(g.pos.y - z.pos.y) < 1.5 && z.cool <= 0) {
        z.cool = 1;
        damage(3, now);
        g.vel.x += (dx / (dist || 1)) * 6;
        g.vel.z += (dz / (dist || 1)) * 6;
        g.vel.y = 5;
      }
      const grp = groups.current.get(z.id);
      if (grp) {
        grp.position.copy(z.pos);
        grp.rotation.y = Math.atan2(dx, dz);
        const legSwing = Math.sin(now * 8) * 0.5 * (speed ? 1 : 0);
        grp.children[2]!.rotation.x = legSwing;
        grp.children[3]!.rotation.x = -legSwing;
      }
    }
    target.current.zombies = g.zombies;
    if (changed) setIds(g.zombies.map((z) => z.id));
  });
  return (
    <>
      {ids.map((id) => (
        <group key={id} ref={(el) => (el ? groups.current.set(id, el) : groups.current.delete(id))}>
          <mesh position={[0, 1.15, 0]}>
            <boxGeometry args={[0.5, 0.7, 0.3]} />
            <meshLambertMaterial color="#2f6e8a" />
          </mesh>
          <mesh position={[0, 1.75, 0]}>
            <boxGeometry args={[0.5, 0.5, 0.5]} />
            <meshLambertMaterial color="#4d8f3b" />
          </mesh>
          <group position={[-0.12, 0.8, 0]}>
            <mesh position={[0, -0.4, 0]}>
              <boxGeometry args={[0.22, 0.8, 0.25]} />
              <meshLambertMaterial color="#3b3b7a" />
            </mesh>
          </group>
          <group position={[0.12, 0.8, 0]}>
            <mesh position={[0, -0.4, 0]}>
              <boxGeometry args={[0.22, 0.8, 0.25]} />
              <meshLambertMaterial color="#3b3b7a" />
            </mesh>
          </group>
          <mesh position={[0, 1.3, 0.35]}>
            <boxGeometry args={[0.6, 0.18, 0.5]} />
            <meshLambertMaterial color="#4d8f3b" />
          </mesh>
          <mesh position={[0.12, 1.8, 0.26]}>
            <boxGeometry args={[0.1, 0.08, 0.02]} />
            <meshBasicMaterial color="#111" />
          </mesh>
          <mesh position={[-0.12, 1.8, 0.26]}>
            <boxGeometry args={[0.1, 0.08, 0.02]} />
            <meshBasicMaterial color="#111" />
          </mesh>
        </group>
      ))}
    </>
  );
}

interface ZombieTarget {
  zombies: Zombie[];
}

function Player({ zt }: { zt: React.MutableRefObject<ZombieTarget> }) {
  const { camera } = useThree();
  const g = getGame();
  const keys = useRef<Record<string, boolean>>({});
  const breaking = useRef(false);
  const target = useRef<ReturnType<typeof raycast>>(null);
  const breakKey = useRef("");
  const onGround = useRef(false);
  const fallStart = useRef<number | null>(null);
  const regen = useRef(0);
  const highlight = useRef<THREE.LineSegments>(null);
  const clock = useRef(0);
  const eyeOff = useRef(0);
  const bobT = useRef(0);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.005, 1.005, 1.005)), []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code.startsWith("Digit")) {
        const n = +e.code.slice(5) - 1;
        if (n >= 0 && n < HOTBAR.length) {
          ui.selected = n;
          emit();
        }
      }
      if (e.code === "Space" && ui.locked) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => (keys.current[e.code] = false);
    const primary = () => {
      if (!ui.locked || ui.dead) return;
      {
        // attack zombies first
        camera.getWorldDirection(dir);
        const eye = camera.position;
        let best: Zombie | null = null, bestD = 3.5;
        for (const z of zt.current.zombies) {
          const c = z.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
          const to = c.sub(eye);
          const d = to.length();
          if (d < bestD && to.normalize().dot(dir) > 0.9) {
            best = z;
            bestD = d;
          }
        }
        if (best && (!target.current || target.current.dist > bestD)) {
          const item = HOTBAR[ui.selected]!;
          best.hp -= item.kind === "tool" ? item.damage : 2;
          best.hurt = 0.4;
          best.vel.set(dir.x * 7, 5, dir.z * 7);
          return;
        }
        breaking.current = true;
      }
    };
    const primaryUp = () => {
      breaking.current = false;
      ui.breakProgress = 0;
      emit();
    };
    touch.primaryDown = primary;
    touch.primaryUp = primaryUp;
    touch.place = () => { if (ui.locked && !ui.dead) place(); };
    const md = (e: MouseEvent) => {
      if (touch.enabled || !ui.locked || ui.dead) return;
      if (e.button === 0) primary();
      else if (e.button === 2) place();
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0 && !touch.enabled) primaryUp();
    };
    const wheel = (e: WheelEvent) => {
      if (!ui.locked) return;
      ui.selected = (ui.selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
      emit();
    };
    const cm = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("wheel", wheel);
    window.addEventListener("contextmenu", cm);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("contextmenu", cm);
    };
  }, []);

  function place() {
    const t = target.current;
    const item = HOTBAR[ui.selected]!;
    if (!t || item.kind !== "block" || (ui.counts[item.block] ?? 0) <= 0) return;
    // aiming at tall grass replaces it directly
    const [x, y, z] = t.id === 12 ? t.pos : t.prev;
    const cur = g.world.get(x, y, z);
    if (cur !== 0 && cur !== 12) return;
    g.world.set(x, y, z, item.block);
    if (collides(g.world, g.pos, 0.3, 1.8)) {
      g.world.set(x, y, z, 0);
      return;
    }
    ui.counts[item.block] = (ui.counts[item.block] ?? 1) - 1;
    emit();
  }

  useFrame((s, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current = s.clock.elapsedTime;
    const k = keys.current;
    const active = ui.locked && !ui.dead;

    // touch look
    if (touch.lookDX || touch.lookDY) {
      if (active) {
        const eu = new THREE.Euler(0, 0, 0, "YXZ").setFromQuaternion(camera.quaternion);
        eu.y -= touch.lookDX * 0.005;
        eu.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, eu.x - touch.lookDY * 0.005));
        camera.quaternion.setFromEuler(eu);
      }
      touch.lookDX = touch.lookDY = 0;
    }

    // movement
    camera.getWorldDirection(dir);
    const fwd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (active) {
      if (k["KeyW"]) wish.add(fwd);
      if (k["KeyS"]) wish.sub(fwd);
      if (k["KeyD"]) wish.add(right);
      if (k["KeyA"]) wish.sub(right);
      if (touch.moveX || touch.moveY) wish.addScaledVector(fwd, touch.moveY).addScaledVector(right, touch.moveX);
    }
    const mag = Math.min(1, wish.length());
    if (mag > 0.05) wish.normalize().multiplyScalar((k["ShiftLeft"] || touch.sprint ? 6.2 : 4.3) * (touch.enabled ? mag : 1));
    else wish.set(0, 0, 0);
    const blend = 1 - Math.exp(-(onGround.current ? 14 : 3) * dt);
    g.vel.x += (wish.x - g.vel.x) * blend;
    g.vel.z += (wish.z - g.vel.z) * blend;
    if (active && (k["Space"] || touch.jump) && onGround.current) g.vel.y = 8.6;
    g.vel.y = Math.max(-50, g.vel.y - 28 * dt);
    const res = moveEntity(g.world, g.pos, g.vel, dt, 0.3, 1.8, true);
    onGround.current = res.onGround;

    // fall damage
    if (!res.onGround && g.vel.y < 0 && fallStart.current === null) fallStart.current = g.pos.y;
    if (res.onGround && fallStart.current !== null) {
      const dist = fallStart.current - g.pos.y;
      if (dist > 3.5) damage(Math.floor(dist - 3), clock.current);
      fallStart.current = null;
    }
    if (g.pos.y < -20) damage(100, clock.current);

    // regen
    if (!ui.dead && ui.health < MAX_HEALTH && clock.current - g.lastHurt > 5) {
      regen.current += dt;
      if (regen.current > 3) {
        regen.current = 0;
        ui.health++;
        emit();
      }
    }
    if (ui.hurt > 0) {
      ui.hurt = Math.max(0, ui.hurt - dt * 2.5);
      if (ui.hurt === 0) emit(); else emitThrottled();
    }

    // smooth eye height after step-ups, plus a gentle walking head bob
    eyeOff.current = Math.max(-1, eyeOff.current - (res.stepped || 0));
    eyeOff.current *= Math.exp(-12 * dt);
    const speedH = Math.hypot(g.vel.x, g.vel.z);
    if (res.onGround && speedH > 0.5) bobT.current += dt * speedH * 1.9;
    const bobAmt = res.onGround ? Math.min(1, speedH / 5) : 0;
    const bob = Math.sin(bobT.current * 2) * 0.05 * bobAmt;
    camera.position.set(g.pos.x, g.pos.y + 1.62 + eyeOff.current + bob, g.pos.z);

    // targeting
    const t = raycast(g.world, camera.position, dir, REACH);
    target.current = t;
    if (highlight.current) {
      highlight.current.visible = !!t && active;
      if (t) highlight.current.position.set(t.pos[0] + 0.5, t.pos[1] + 0.5, t.pos[2] + 0.5);
    }

    // breaking
    if (breaking.current && t && active) {
      const key = t.pos.join(",");
      if (key !== breakKey.current) {
        breakKey.current = key;
        ui.breakProgress = 0;
      }
      const def = BLOCKS[t.id ?? 0]!;
      const item = HOTBAR[ui.selected]!;
      const right = item.kind === "tool" && def.tool === item.tool;
      const time = def.hardness * (right ? 0.25 : 1);
      ui.breakProgress += dt / time;
      if (ui.breakProgress >= 1) {
        g.world.set(t.pos[0], t.pos[1], t.pos[2], 0);
        if (def.drop) ui.counts[def.drop] = (ui.counts[def.drop] ?? 0) + 1;
        ui.breakProgress = 0;
        breakKey.current = "";
        emit();
      } else emitThrottled();
    } else if (ui.breakProgress) {
      ui.breakProgress = 0;
      emit();
    }
  });

  return (
    <lineSegments ref={highlight} geometry={edges}>
      <lineBasicMaterial color="#111111" />
    </lineSegments>
  );
}

// While the frame is rotated (portrait screen playing landscape), R3F measures
// the frame's on-screen bounding box instead of its rotated layout size, so the
// canvas keeps a portrait shape. Force the landscape buffer size and aspect.
function LandscapeFix({ portrait, w, h }: { portrait: boolean; w: number; h: number }) {
  const { gl, camera } = useThree();
  useFrame(() => {
    if (!portrait) return;
    const el = gl.domElement;
    if (el.clientWidth !== h || el.clientHeight !== w) {
      gl.setSize(h, w, false);
      el.style.width = `${h}px`;
      el.style.height = `${w}px`;
    }
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = h / w;
    if (cam.isPerspectiveCamera && Math.abs(cam.aspect - aspect) > 1e-4) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function Scene() {
  const zt = useRef<ZombieTarget>({ zombies: [] });
  const material = useMemo(() => {
    const canvas = drawAtlas();
    ui.atlasUrl = canvas.toDataURL();
    emit();
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 });
  }, []);
  return (
    <>
      <Sky />
      <Chunks material={material} />
      <Player zt={zt} />
      <Zombies target={zt} />
    </>
  );
}

// Tracks viewport size; when the screen is portrait the game is rendered
// rotated 90deg so it always plays landscape.
function useViewport() {
  const [dims, setDims] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const upd = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", upd);
    window.addEventListener("orientationchange", upd);
    return () => {
      window.removeEventListener("resize", upd);
      window.removeEventListener("orientationchange", upd);
    };
  }, []);
  return dims;
}

export function Game() {
  const g = getGame();
  const ui2 = useUI();
  const { w, h } = useViewport();
  const portrait = h > w;
  const frame: React.CSSProperties = portrait
    ? { position: "fixed", top: 0, left: w, width: h, height: w, transform: "rotate(90deg)", transformOrigin: "top left" }
    : { position: "fixed", inset: 0 };
  useEffect(() => {
    const id = setInterval(saveGame, 5000);
    window.addEventListener("beforeunload", saveGame);
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", saveGame);
    };
  }, []);
  return (
    <div className="select-none touch-none" style={frame}>
      <Canvas
        dpr={touch.enabled || isTouchDevice() ? 1 : [1, 1.5]}
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{ antialias: !isTouchDevice(), powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        onCreated={({ gl }) => {
          const el = gl.domElement;
          el.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            saveGame();
            setTimeout(() => window.location.reload(), 300);
          });
        }}
        camera={{ fov: 75, near: 0.05, far: 300, position: [g.pos.x, g.pos.y + 1.62, g.pos.z] }}>
        <Scene />
        <LandscapeFix portrait={portrait} w={w} h={h} />
        <PointerLockControls
          selector="#__no_auto_lock"
          ref={(c: any) => {
            g.controls = c;
          }}
          onLock={() => {
            ui.locked = true;
            emit();
          }}
          onUnlock={() => {
            ui.locked = false;
            emit();
            saveGame();
          }}
        />
      </Canvas>
      <HUD />
      {ui2.locked && !ui2.dead && touch.enabled && <TouchControls />}
    </div>
  );
}
