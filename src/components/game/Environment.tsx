import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BuffaloHandle } from "./Buffalo";
import { input, stats, notifyStats, world, addCoins, ATTACK_RANGE, emitEvent } from "./gameState";


// Shared collision helper: pushes the buffalo out of a circular obstacle so it
// cannot pass through. Also zeroes the inward component of velocity so the
// player doesn't grind through walls. Call from useFrame for each solid.
function collideBuffalo(buf: THREE.Group, vel: THREE.Vector3, ox: number, oz: number, r: number) {
  const dx = buf.position.x - ox;
  const dz = buf.position.z - oz;
  const dist = Math.hypot(dx, dz);
  if (dist >= r || dist === 0) return;
  const nx = dx / (dist || 1);
  const nz = dz / (dist || 1);
  buf.position.x = ox + nx * r;
  buf.position.z = oz + nz * r;
  const inward = -(vel.x * nx + vel.z * nz);
  if (inward > 0) {
    vel.x += nx * inward;
    vel.z += nz * inward;
  }
}

// Returns true if buffalo is within ATTACK_RANGE of the obstacle.
function inAttackRange(buf: THREE.Group, ox: number, oz: number, extraR = 0) {
  const dx = buf.position.x - ox;
  const dz = buf.position.z - oz;
  return dx * dx + dz * dz < (ATTACK_RANGE + extraR) * (ATTACK_RANGE + extraR);
}


// Realistic rice plants: instanced stems + grain heads, with crops that fold over when trampled.
export function Crops({ buffaloRef }: { buffaloRef: React.MutableRefObject<BuffaloHandle> }) {
  const COUNT = 220;
  const stemRef = useRef<THREE.InstancedMesh>(null!);
  const grainRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => {
    const arr: { x: number; z: number; r: number; trampled: boolean; tilt: number }[] = [];
    for (let i = 0; i < COUNT; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 80,
        z: (Math.random() - 0.5) * 80,
        r: Math.random() * Math.PI,
        trampled: false,
        tilt: 0,
      });
    }
    return arr;
  }, []);

  useFrame(() => {
    const s = stemRef.current;
    const g = grainRef.current;
    if (!s || !g) return;
    const buf = buffaloRef.current.group;
    if (!buf) return;
    const bx = buf.position.x;
    const bz = buf.position.z;
    let dirty = false;
    for (let i = 0; i < COUNT; i++) {
      const d = data[i];
      if (!d.trampled) {
        const dx = d.x - bx;
        const dz = d.z - bz;
        if (dx * dx + dz * dz < 1.2 * 1.2) {
          d.trampled = true;
          stats.cropsTrampled++;
          dirty = true;
        }
      }
      // animate flopping over once trampled
      if (d.trampled && d.tilt < 1) d.tilt = Math.min(1, d.tilt + 0.15);

      const tilt = d.tilt * (Math.PI / 2 - 0.1);
      dummy.position.set(d.x, 0, d.z);
      dummy.rotation.set(tilt, d.r, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      s.setMatrixAt(i, dummy.matrix);

      // Grain head sits at the top of the stem; offset along local Y before rotation.
      const headLocalY = 0.95;
      const px = d.x + Math.sin(tilt) * headLocalY * Math.cos(d.r);
      const pz = d.z - Math.sin(tilt) * headLocalY * Math.sin(d.r);
      const py = Math.cos(tilt) * headLocalY;
      dummy.position.set(px, py, pz);
      dummy.rotation.set(tilt, d.r, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      g.setMatrixAt(i, dummy.matrix);
    }
    s.instanceMatrix.needsUpdate = true;
    g.instanceMatrix.needsUpdate = true;
    if (dirty) notifyStats();
  });

  return (
    <>
      <instancedMesh ref={stemRef} args={[undefined, undefined, COUNT]} castShadow>
        <cylinderGeometry args={[0.025, 0.04, 0.95, 5]} />
        <meshStandardMaterial color="#7fa64a" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={grainRef} args={[undefined, undefined, COUNT]} castShadow>
        <coneGeometry args={[0.08, 0.35, 6]} />
        <meshStandardMaterial color="#d9c66a" roughness={0.7} />
      </instancedMesh>
    </>
  );
}

type Machine = {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  angVel: THREE.Vector3;
  destroyed: boolean;
  destroyedAt: number;
  kind: "tractor" | "harvester";
  working: boolean;
};

export function Machinery({ buffaloRef }: { buffaloRef: React.MutableRefObject<BuffaloHandle> }) {
  const machines = useMemo<Machine[]>(() => {
    const arr: Machine[] = [];
    // Layout: 4 tractors (only first 3 are working), 4 harvesters working as before.
    const placements: { x: number; z: number; kind: Machine["kind"]; working: boolean }[] = [
      { x: 8, z: 10, kind: "tractor", working: true },
      { x: -12, z: 5, kind: "harvester", working: true },
      { x: 15, z: -8, kind: "harvester", working: true },
      { x: -6, z: -14, kind: "tractor", working: true },
      { x: 20, z: 18, kind: "tractor", working: true },
      { x: -22, z: -3, kind: "harvester", working: true },
      { x: 3, z: 25, kind: "tractor", working: false },   // parked / off
      { x: -18, z: 22, kind: "tractor", working: false }, // parked / off
    ];
    placements.forEach((p, i) => {
      arr.push({
        id: i,
        pos: new THREE.Vector3(p.x, p.kind === "harvester" ? 1.2 : 0.8, p.z),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(0, Math.random() * Math.PI * 2, 0),
        angVel: new THREE.Vector3(),
        destroyed: false,
        destroyedAt: 0,
        kind: p.kind,
        working: p.working,
      });
    });
    return arr;
  }, []);

  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  // Tractor / harvester audio removed per design — machines are silent now.
  useEffect(() => {
    void machines;
  }, [machines]);


  useFrame((state, dt) => {
    if (world.mode !== "open") return;
    const buf = buffaloRef.current.group;
    if (!buf) return;
    const bvel = buffaloRef.current.velocity;
    const dashing = state.clock.elapsedTime < input.dashUntil;

    machines.forEach((m, i) => {
      const g = groupRefs.current[i];
      if (!g) return;
      const dx = m.pos.x - buf.position.x;
      const dz = m.pos.z - buf.position.z;
      const distSq = dx * dx + dz * dz;
      const radius = m.kind === "harvester" ? 2.6 : 2.0;
      if (!m.destroyed && distSq < (radius + 0.8) * (radius + 0.8)) {
        const dist = Math.sqrt(distSq) || 0.001;
        const nx = dx / dist;
        const nz = dz / dist;
        const speed = Math.hypot(bvel.x, bvel.z);
        const force = dashing ? 18 + speed * 0.8 : 4 + speed * 0.3;
        m.vel.x += nx * force;
        m.vel.z += nz * force;
        m.vel.y += dashing ? 6 : 1.5;
        m.angVel.x += (Math.random() - 0.5) * (dashing ? 8 : 2);
        m.angVel.y += (Math.random() - 0.5) * (dashing ? 8 : 2);
        m.angVel.z += (Math.random() - 0.5) * (dashing ? 8 : 2);
        buf.position.x -= nx * 0.1;
        buf.position.z -= nz * 0.1;
        if (dashing && !m.destroyed) {
          m.destroyed = true;
          m.destroyedAt = state.clock.elapsedTime;
          stats.destroyed++;
          notifyStats();
          addCoins(m.kind === "harvester" ? 60 : 35, "wreck!");
        }
      }
      m.vel.y -= 18 * dt;
      m.pos.addScaledVector(m.vel, dt);
      m.vel.x *= 0.96;
      m.vel.z *= 0.96;
      const groundY = m.kind === "harvester" ? 1.2 : 0.8;
      if (m.pos.y < groundY) {
        m.pos.y = groundY;
        m.vel.y = Math.max(0, -m.vel.y * 0.2);
        m.angVel.multiplyScalar(0.85);
      }
      m.rot.x += m.angVel.x * dt;
      m.rot.y += m.angVel.y * dt;
      m.rot.z += m.angVel.z * dt;

      g.position.copy(m.pos);
      g.rotation.copy(m.rot);
    });
  });


  return (
    <>
      {machines.map((m, i) => (
        <group
          key={m.id}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          {m.kind === "tractor" ? <TractorMesh stopped={!m.working} /> : <HarvesterMesh />}
        </group>
      ))}
    </>
  );
}

function TractorMesh({ stopped = false }: { stopped?: boolean }) {
  const bodyColor = stopped ? "#7a4a3e" : "#c0392b";
  const cabinColor = stopped ? "#5a342c" : "#922b21";
  return (
    <group>
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[1.6, 1.0, 2.4]} />
        <meshStandardMaterial color={bodyColor} roughness={stopped ? 0.95 : 0.6} metalness={stopped ? 0.05 : 0.3} />
      </mesh>
      <mesh castShadow position={[0, 0.7, -0.2]}>
        <boxGeometry args={[1.2, 0.8, 1.0]} />
        <meshStandardMaterial color={cabinColor} roughness={stopped ? 0.95 : 0.4} metalness={stopped ? 0.05 : 0.4} />
      </mesh>
      <mesh castShadow position={[-0.95, -0.4, -0.7]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.7, 0.7, 0.3, 16]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh castShadow position={[0.95, -0.4, -0.7]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.7, 0.7, 0.3, 16]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh castShadow position={[-0.9, -0.55, 0.9]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.45, 0.45, 0.25, 16]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh castShadow position={[0.9, -0.55, 0.9]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.45, 0.45, 0.25, 16]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh castShadow position={[0.5, 1.3, 0.9]}>
        <cylinderGeometry args={[0.08, 0.08, 0.8, 8]} />
        <meshStandardMaterial color="#333" metalness={0.7} />
      </mesh>
      {stopped && (
        <mesh position={[0, 1.85, 0]}>
          <planeGeometry args={[0.9, 0.35]} />
          <meshBasicMaterial color="#222" />
        </mesh>
      )}
    </group>
  );
}

function HarvesterMesh() {
  return (
    <group>
      <mesh castShadow position={[0, 0.2, 0]}>
        <boxGeometry args={[2.4, 1.6, 3.6]} />
        <meshStandardMaterial color="#e67e22" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh castShadow position={[0, 1.3, -0.4]}>
        <boxGeometry args={[1.6, 1.0, 1.6]} />
        <meshStandardMaterial color="#34495e" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh castShadow position={[0, -0.4, 2.2]}>
        <boxGeometry args={[3.2, 0.5, 0.8]} />
        <meshStandardMaterial color="#7f8c8d" metalness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 0.1, 2.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.4, 0.4, 3.0, 12]} />
        <meshStandardMaterial color="#f1c40f" />
      </mesh>
      {[
        [-1.2, -0.8, 1.0],
        [1.2, -0.8, 1.0],
        [-1.2, -0.8, -1.2],
        [1.2, -0.8, -1.2],
      ].map((p, i) => (
        <mesh key={i} castShadow position={p as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.7, 0.7, 0.35, 16]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      ))}
    </group>
  );
}

export const ROAD_LEN = 540;
export const ROAD_WIDTH = 12;
export const ROAD_Z = 0;
export const CROSS_ROAD_LEN = 540;
export const CROSS_ROAD_X = 0;

export function Ground() {
  const BOUND = 240;
  const dashes = useMemo(() => {
    const arr: { x: number }[] = [];
    const step = 4;
    for (let x = -ROAD_LEN / 2 + 2; x <= ROAD_LEN / 2 - 2; x += step) {
      arr.push({ x });
    }
    return arr;
  }, []);
  const crossDashes = useMemo(() => {
    const arr: { z: number }[] = [];
    const step = 4;
    for (let z = -CROSS_ROAD_LEN / 2 + 2; z <= CROSS_ROAD_LEN / 2 - 2; z += step) {
      arr.push({ z });
    }
    return arr;
  }, []);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1400, 1400]} />
        <meshStandardMaterial color="#6b4a2b" roughness={1} />
      </mesh>
      {/* Patchwork of grass/farm fields spread across the larger map */}
      {Array.from({ length: 64 }).map((_, i) => {
        const gx = (i % 8) - 3.5;
        const gz = Math.floor(i / 8) - 3.5;
        const x = gx * 56;
        const z = gz * 56;
        const isFarm = (gx + gz) % 2 === 0;
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, z]} receiveShadow>
            <planeGeometry args={[48, 48]} />
            <meshStandardMaterial color={isFarm ? "#7d6232" : "#4a6b3a"} roughness={0.9} />
          </mesh>
        );
      })}
      {/* Main east-west highway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, ROAD_Z]} receiveShadow>
        <planeGeometry args={[ROAD_LEN, ROAD_WIDTH]} />
        <meshStandardMaterial color="#2d2d2d" roughness={0.95} />
      </mesh>
      {/* Cross road through the township */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CROSS_ROAD_X, 0.03, 0]} receiveShadow>
        <planeGeometry args={[ROAD_WIDTH, CROSS_ROAD_LEN]} />
        <meshStandardMaterial color="#2d2d2d" roughness={0.95} />
      </mesh>
      {/* White lane edges on main road */}
      {[-1, 1].map((s) => (
        <mesh
          key={`edge-${s}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.04, ROAD_Z + (s * ROAD_WIDTH) / 2 - s * 0.25]}
        >
          <planeGeometry args={[ROAD_LEN, 0.25]} />
          <meshBasicMaterial color="#f5f5f5" />
        </mesh>
      ))}
      {/* Yellow dashed center line on main road */}
      {dashes.map((d, i) => (
        <mesh key={`dash-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[d.x, 0.05, ROAD_Z]}>
          <planeGeometry args={[2.2, 0.28]} />
          <meshBasicMaterial color="#f4c430" />
        </mesh>
      ))}
      {/* Yellow dashed center line on cross road */}
      {crossDashes.map((d, i) => (
        <mesh key={`cdash-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[CROSS_ROAD_X, 0.05, d.z]}>
          <planeGeometry args={[0.28, 2.2]} />
          <meshBasicMaterial color="#f4c430" />
        </mesh>
      ))}
      {/* Wooden boundary fence — visual marker for the playable area */}
      {[-1, 1].flatMap((s) => [
        <mesh key={`fx${s}`} position={[s * BOUND, 1.0, 0]} castShadow>
          <boxGeometry args={[0.4, 2.0, BOUND * 2]} />
          <meshStandardMaterial color="#5a3a22" roughness={1} />
        </mesh>,
        <mesh key={`fz${s}`} position={[0, 1.0, s * BOUND]} castShadow>
          <boxGeometry args={[BOUND * 2, 2.0, 0.4]} />
          <meshStandardMaterial color="#5a3a22" roughness={1} />
        </mesh>,
      ])}
    </>
  );
}

// Realistic grass: many thin blades clustered in tufts, with 3 color shades
// for natural variation. Uses a tall thin tapered cone as the blade primitive.
export function GrassTufts() {
  const PER_SHADE = 320;
  const shades = useMemo(
    () => [
      { color: "#5d8a2a", h: 0.55, r: 0.022 },
      { color: "#7bb04a", h: 0.45, r: 0.018 },
      { color: "#3f6b1f", h: 0.62, r: 0.025 },
    ],
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  return (
    <>
      {shades.map((s, si) => (
        <instancedMesh
          key={si}
          ref={(m) => {
            if (!m) return;
            for (let i = 0; i < PER_SHADE; i++) {
              // Cluster blades in tufts: pick a tuft center, then jitter.
              const tx = (Math.random() - 0.5) * 460;
              const tz = (Math.random() - 0.5) * 460;
              const jx = (Math.random() - 0.5) * 0.6;
              const jz = (Math.random() - 0.5) * 0.6;
              const scale = 0.7 + Math.random() * 0.7;
              const tilt = (Math.random() - 0.5) * 0.25;
              dummy.position.set(tx + jx, (s.h * scale) / 2, tz + jz);
              dummy.rotation.set(tilt, Math.random() * Math.PI, tilt);
              dummy.scale.set(scale, scale, scale);
              dummy.updateMatrix();
              m.setMatrixAt(i, dummy.matrix);
            }
            m.instanceMatrix.needsUpdate = true;
          }}
          args={[undefined, undefined, PER_SHADE]}
          castShadow
          receiveShadow
        >
          <coneGeometry args={[s.r, s.h, 4]} />
          <meshStandardMaterial color={s.color} roughness={0.95} />
        </instancedMesh>
      ))}
    </>
  );
}

// === Township buildings (houses + shops + streetlights) ===
type Building = {
  x: number; z: number; w: number; d: number; h: number;
  body: string; roof: string; shop: boolean;
  destroyed: boolean;
  collapse: number;
  lastAttackId: number;
};

export function Township({ buffaloRef }: { buffaloRef: React.MutableRefObject<BuffaloHandle> }) {
  const buildings = useMemo<Building[]>(() => {
    const arr: Building[] = [];
    const palette = [
      { body: "#e8c39a", roof: "#9b3a2a" },
      { body: "#f3e3c1", roof: "#3a5a78" },
      { body: "#d39a72", roof: "#5b2f1f" },
      { body: "#b9c9d3", roof: "#2d4a3a" },
      { body: "#ead9b6", roof: "#7a3a2a" },
    ];
    const blocks: { cx: number; cz: number }[] = [];
    // Township blocks near origin (the city) — keep it lean for perf
    for (let bx = -1; bx <= 1; bx++) {
      for (let bz = -1; bz <= 1; bz++) {
        if (bx === 0 && bz === 0) continue;
        blocks.push({ cx: bx * 38, cz: bz * 38 });
      }
    }
    // A few outlying farmhouse clusters
    [
      { cx: -130, cz: 70 }, { cx: 140, cz: -70 },
      { cx: -160, cz: -40 }, { cx: 150, cz: 80 },
    ].forEach((b) => blocks.push(b));
    blocks.forEach((b, bi) => {
      const count = Math.abs(b.cx) > 100 || Math.abs(b.cz) > 100 ? 2 : 3;
      for (let i = 0; i < count; i++) {
        const p = palette[(bi + i) % palette.length];
        const w = 4 + Math.random() * 3;
        const d = 4 + Math.random() * 3;
        const h = 3 + Math.random() * 5;
        const px = b.cx + (Math.random() - 0.5) * 18;
        const pz = b.cz + (Math.random() - 0.5) * 18;
        // Don't drop buildings on the road
        if (Math.abs(pz) < 8 && Math.abs(px) < ROAD_LEN / 2) continue;
        if (Math.abs(px) < 8 && Math.abs(pz) < CROSS_ROAD_LEN / 2) continue;
        arr.push({
          x: px, z: pz,
          w, d, h,
          body: p.body,
          roof: p.roof,
          shop: i === 0,
          destroyed: false,
          collapse: 0,
          lastAttackId: 0,
        });
      }
    });
    return arr;
  }, []);

  const lamps = useMemo(() => {
    const arr: { x: number; z: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      arr.push({ x: Math.cos(a) * 20, z: Math.sin(a) * 20 });
    }
    return arr;
  }, []);

  const refs = useRef<(THREE.Group | null)[]>([]);

  useFrame((state, dt) => {
    const buf = buffaloRef.current.group;
    if (!buf) return;
    const vel = buffaloRef.current.velocity;
    const now = state.clock.elapsedTime;
    const attacking = now < input.attackUntil;

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const g = refs.current[i];
      const collideR = Math.max(b.w, b.d) * 0.55;
      if (!b.destroyed) {
        collideBuffalo(buf, vel, b.x, b.z, collideR);
        if (
          attacking &&
          b.lastAttackId !== input.attackId &&
          inAttackRange(buf, b.x, b.z, collideR)
        ) {
          b.lastAttackId = input.attackId;
          b.destroyed = true;
          stats.destroyed++;
          notifyStats();
          addCoins(45, "smashed a building!");
          emitEvent({ type: "coin", message: "🏚️ Building collapsed!", severity: "minor" });
        }
      } else if (b.collapse < 1) {
        b.collapse = Math.min(1, b.collapse + dt * 1.6);
      }
      if (g) {
        const c = b.collapse;
        g.scale.set(1 + c * 0.15, Math.max(0.18, 1 - c * 0.82), 1 + c * 0.15);
        g.rotation.z = c * 0.18;
      }
    }
  });

  return (
    <>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} ref={(el) => (refs.current[i] = el)}>
          <mesh castShadow receiveShadow position={[0, b.h / 2, 0]}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.body} roughness={0.85} />
          </mesh>
          <mesh castShadow position={[0, b.h + 0.6, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[Math.max(b.w, b.d) * 0.78, 1.4, 4]} />
            <meshStandardMaterial color={b.roof} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.9, b.d / 2 + 0.01]}>
            <planeGeometry args={[0.9, 1.6]} />
            <meshStandardMaterial color="#3a2418" roughness={1} />
          </mesh>
          <mesh position={[-b.w / 3, b.h * 0.6, b.d / 2 + 0.01]}>
            <planeGeometry args={[0.7, 0.7]} />
            <meshStandardMaterial color="#9ad6ff" emissive="#3b6e9c" emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[b.w / 3, b.h * 0.6, b.d / 2 + 0.01]}>
            <planeGeometry args={[0.7, 0.7]} />
            <meshStandardMaterial color="#9ad6ff" emissive="#3b6e9c" emissiveIntensity={0.25} />
          </mesh>
          {b.shop && (
            <>
              <mesh position={[0, 2.1, b.d / 2 + 0.5]} rotation={[Math.PI / 8, 0, 0]}>
                <boxGeometry args={[b.w * 0.9, 0.08, 1.0]} />
                <meshStandardMaterial color="#c0392b" />
              </mesh>
              <mesh position={[0, b.h + 0.05, b.d / 2 + 0.02]}>
                <planeGeometry args={[b.w * 0.8, 0.5]} />
                <meshBasicMaterial color="#222" />
              </mesh>
            </>
          )}
          {b.destroyed && (
            <mesh position={[0, 0.6, 0]}>
              <sphereGeometry args={[Math.max(b.w, b.d) * 0.6, 10, 8]} />
              <meshStandardMaterial color="#888" transparent opacity={0.35} />
            </mesh>
          )}
        </group>
      ))}
      {lamps.map((l, i) => (
        <group key={`lamp-${i}`} position={[l.x, 0, l.z]}>
          <mesh castShadow position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 3.0, 6]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[0, 3.1, 0]}>
            <sphereGeometry args={[0.22, 10, 8]} />
            <meshStandardMaterial color="#fff2b0" emissive="#ffb84a" emissiveIntensity={1.2} />
          </mesh>
        </group>
      ))}
    </>
  );
}

type Tree = {
  x: number; z: number; s: number;
  fallen: boolean;
  fallProgress: number;
  fallDir: number;
  lastAttackId: number;
};

export function Trees({ buffaloRef }: { buffaloRef: React.MutableRefObject<BuffaloHandle> }) {
  const trees = useMemo<Tree[]>(() => {
    const arr: Tree[] = [];
    for (let i = 0; i < 70; i++) {
      // Spread across the whole countryside, but keep clear of the highways.
      let x = 0, z = 0;
      for (let tries = 0; tries < 6; tries++) {
        x = (Math.random() - 0.5) * 420;
        z = (Math.random() - 0.5) * 420;
        if (Math.abs(z) > 9 || Math.abs(x) > ROAD_LEN / 2 - 4) {
          if (Math.abs(x) > 9 || Math.abs(z) > CROSS_ROAD_LEN / 2 - 4) break;
        }
      }
      arr.push({
        x, z,
        s: 0.8 + Math.random() * 0.8,
        fallen: false,
        fallProgress: 0,
        fallDir: 0,
        lastAttackId: 0,
      });
    }
    return arr;
  }, []);

  const refs = useRef<(THREE.Group | null)[]>([]);

  useFrame((state, dt) => {
    const buf = buffaloRef.current.group;
    if (!buf) return;
    const vel = buffaloRef.current.velocity;
    const now = state.clock.elapsedTime;
    const attacking = now < input.attackUntil;

    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const g = refs.current[i];
      const collideR = 0.55 * t.s;
      if (!t.fallen) {
        collideBuffalo(buf, vel, t.x, t.z, collideR);
        if (
          attacking &&
          t.lastAttackId !== input.attackId &&
          inAttackRange(buf, t.x, t.z, collideR)
        ) {
          t.lastAttackId = input.attackId;
          t.fallen = true;
          const dx = t.x - buf.position.x;
          const dz = t.z - buf.position.z;
          t.fallDir = Math.atan2(dx, dz);
          stats.destroyed++;
          notifyStats();
          addCoins(20, "chopped a tree!");
        }
      } else if (t.fallProgress < 1) {
        t.fallProgress = Math.min(1, t.fallProgress + dt * 1.4);
      }
      if (g) {
        g.rotation.y = t.fallDir;
      }
    }
  });

  return (
    <>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} ref={(el) => (refs.current[i] = el)}>
          <TreeMesh tree={t} />
        </group>
      ))}
    </>
  );
}

function TreeMesh({ tree }: { tree: Tree }) {
  const innerRef = useRef<THREE.Group>(null!);
  useFrame(() => {
    if (innerRef.current) {
      innerRef.current.rotation.x = tree.fallProgress * (Math.PI / 2 - 0.05);
    }
  });
  return (
    <group ref={innerRef} scale={[tree.s, tree.s, tree.s]}>
      <mesh castShadow position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.25, 0.35, 2.4, 8]} />
        <meshStandardMaterial color="#6b4423" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 3.0, 0]}>
        <sphereGeometry args={[1.4, 14, 12]} />
        <meshStandardMaterial color={tree.fallen ? "#5a6a32" : "#3f7a2a"} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.5, 3.7, 0.3]}>
        <sphereGeometry args={[0.9, 12, 10]} />
        <meshStandardMaterial color={tree.fallen ? "#6a7a40" : "#4f9035"} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[-0.4, 3.5, -0.4]}>
        <sphereGeometry args={[0.8, 12, 10]} />
        <meshStandardMaterial color={tree.fallen ? "#4a5a28" : "#356a23"} roughness={0.9} />
      </mesh>
    </group>
  );
}



export function Mountains() {
  const peaks = useMemo(() => {
    const arr: { x: number; z: number; h: number; r: number; c: string }[] = [];
    const colors = ["#6b7a8a", "#5a6a78", "#7a8a99", "#4d5a68"];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.1;
      const dist = 320 + Math.random() * 40;
      arr.push({
        x: Math.cos(ang) * dist,
        z: Math.sin(ang) * dist,
        h: 22 + Math.random() * 22,
        r: 14 + Math.random() * 10,
        c: colors[i % colors.length],
      });
    }
    return arr;
  }, []);
  return (
    <>
      {peaks.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh>
            <coneGeometry args={[p.r, p.h, 6]} />
            <meshStandardMaterial color={p.c} roughness={1} />
          </mesh>
          <mesh position={[0, p.h * 0.32, 0]}>
            <coneGeometry args={[p.r * 0.4, p.h * 0.3, 6]} />
            <meshStandardMaterial color="#f4f8ff" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function Clouds() {
  const groupRef = useRef<THREE.Group>(null!);
  const clouds = useMemo(() => {
    const arr: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 10; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 240,
        y: 35 + Math.random() * 15,
        z: (Math.random() - 0.5) * 240,
        s: 1 + Math.random() * 2,
      });
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.position.x += dt * 0.5;
    if (groupRef.current && groupRef.current.position.x > 60) {
      groupRef.current.position.x = -60;
    }
  });
  return (
    <group ref={groupRef}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s, c.s]}>
          <mesh>
            <sphereGeometry args={[2.2, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={1} />
          </mesh>
          <mesh position={[2.0, 0.2, 0]}>
            <sphereGeometry args={[1.6, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={1} />
          </mesh>
          <mesh position={[-1.8, 0.1, 0.3]}>
            <sphereGeometry args={[1.8, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={1} />
          </mesh>
          <mesh position={[0.6, 0.9, 0.2]}>
            <sphereGeometry args={[1.4, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ============= Race-mission marker (GTA-style waypoint) =============
export const RACE_WAYPOINT = new THREE.Vector3(28, 0, 28);

export function RaceWaypoint({
  buffaloRef,
  onEnter,
}: {
  buffaloRef: React.MutableRefObject<BuffaloHandle>;
  onEnter: () => void;
}) {
  const beam = useRef<THREE.Mesh>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const triggered = useRef(false);
  useFrame((state) => {
    if (beam.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
      beam.current.scale.set(s, 1, s);
    }
    if (ring.current) {
      ring.current.rotation.z += 0.02;
    }
    if (triggered.current) return;
    const buf = buffaloRef.current.group;
    if (!buf) return;
    const dx = buf.position.x - RACE_WAYPOINT.x;
    const dz = buf.position.z - RACE_WAYPOINT.z;
    if (dx * dx + dz * dz < 2.5 * 2.5) {
      triggered.current = true;
      onEnter();
    }
  });
  if (world.mode !== "open") return null;
  return (
    <group position={[RACE_WAYPOINT.x, 0, RACE_WAYPOINT.z]}>
      <mesh ref={beam} position={[0, 15, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 30, 16, 1, true]} />
        <meshBasicMaterial color="#ffe24a" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[1.6, 2.2, 24]} />
        <meshBasicMaterial color="#ffe24a" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 2.2, 0]}>
        <coneGeometry args={[0.5, 1.0, 6]} />
        <meshStandardMaterial color="#ffd400" emissive="#ffaa00" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

// ============= Countryside: parks, farms, country homes along the highway =============
// Static visual decoration spread across the larger map to make it feel alive.
// Kept simple/no-collision to avoid frame cost; players can drive through parks.
export function Countryside() {
  const homes = useMemo(() => {
    const arr: { x: number; z: number; rot: number; body: string; roof: string }[] = [];
    const palette = [
      { body: "#e8c39a", roof: "#9b3a2a" },
      { body: "#f3e3c1", roof: "#3a5a78" },
      { body: "#d39a72", roof: "#5b2f1f" },
      { body: "#ead9b6", roof: "#7a3a2a" },
    ];
    // Roadside homes along the main highway, alternating sides.
    for (let i = 0; i < 26; i++) {
      const x = -ROAD_LEN / 2 + 30 + i * 18 + (Math.random() - 0.5) * 4;
      if (Math.abs(x) < 60) continue; // leave room for the township near origin
      const side = i % 2 === 0 ? 1 : -1;
      const z = side * (16 + Math.random() * 8);
      const p = palette[i % palette.length];
      arr.push({ x, z, rot: side > 0 ? Math.PI : 0, body: p.body, roof: p.roof });
    }
    return arr;
  }, []);

  const parks = useMemo(() => {
    // Small green parks with a few trees each.
    const arr: { x: number; z: number; trees: { x: number; z: number; s: number }[] }[] = [];
    const spots = [
      { x: -180, z: 60 }, { x: -100, z: -70 }, { x: 70, z: -55 },
      { x: 150, z: 50 }, { x: -50, z: 100 }, { x: 110, z: 130 },
      { x: -150, z: -140 }, { x: 200, z: -150 },
    ];
    spots.forEach((s) => {
      const trees = Array.from({ length: 5 }).map(() => ({
        x: (Math.random() - 0.5) * 18,
        z: (Math.random() - 0.5) * 18,
        s: 0.7 + Math.random() * 0.6,
      }));
      arr.push({ x: s.x, z: s.z, trees });
    });
    return arr;
  }, []);

  const farms = useMemo(() => {
    // Tilled farm plots near outlying farmhouses.
    const arr: { x: number; z: number; color: string }[] = [];
    const spots = [
      { x: -130, z: -30 }, { x: -160, z: 100 }, { x: 130, z: 90 },
      { x: 170, z: -50 }, { x: -60, z: -170 }, { x: 80, z: 170 },
    ];
    const colors = ["#8a6a32", "#a37c3a", "#6b5a2a", "#9c8240"];
    spots.forEach((s, i) => arr.push({ ...s, color: colors[i % colors.length] }));
    return arr;
  }, []);

  return (
    <>
      {/* Park lawns with trees */}
      {parks.map((p, i) => (
        <group key={`park-${i}`} position={[p.x, 0, p.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
            <planeGeometry args={[22, 22]} />
            <meshStandardMaterial color="#4f8a3a" roughness={0.9} />
          </mesh>
          {/* park bench */}
          <mesh position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[1.6, 0.15, 0.4]} />
            <meshStandardMaterial color="#6b3a1f" />
          </mesh>
          {p.trees.map((t, ti) => (
            <group key={ti} position={[t.x, 0, t.z]} scale={[t.s, t.s, t.s]}>
              <mesh castShadow position={[0, 1.0, 0]}>
                <cylinderGeometry args={[0.2, 0.3, 2.0, 6]} />
                <meshStandardMaterial color="#6b4423" />
              </mesh>
              <mesh castShadow position={[0, 2.6, 0]}>
                <sphereGeometry args={[1.2, 10, 8]} />
                <meshStandardMaterial color="#3f7a2a" />
              </mesh>
            </group>
          ))}
        </group>
      ))}

      {/* Farm plots */}
      {farms.map((f, i) => (
        <group key={`farm-${i}`} position={[f.x, 0, f.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
            <planeGeometry args={[26, 18]} />
            <meshStandardMaterial color={f.color} roughness={1} />
          </mesh>
          {/* furrow stripes */}
          {Array.from({ length: 9 }).map((_, k) => (
            <mesh
              key={k}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[-12 + k * 3, 0.04, 0]}
            >
              <planeGeometry args={[0.3, 17]} />
              <meshStandardMaterial color="#3a2a14" />
            </mesh>
          ))}
        </group>
      ))}

      {/* Roadside country homes */}
      {homes.map((h, i) => (
        <group key={`home-${i}`} position={[h.x, 0, h.z]} rotation={[0, h.rot, 0]}>
          <mesh castShadow receiveShadow position={[0, 1.7, 0]}>
            <boxGeometry args={[5, 3.4, 4.5]} />
            <meshStandardMaterial color={h.body} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, 4.0, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[3.8, 1.8, 4]} />
            <meshStandardMaterial color={h.roof} roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.0, 2.26]}>
            <planeGeometry args={[1, 1.8]} />
            <meshStandardMaterial color="#3a2418" />
          </mesh>
          {/* mailbox by the road */}
          <mesh castShadow position={[0, 0.8, 6]}>
            <boxGeometry args={[0.4, 0.3, 0.6]} />
            <meshStandardMaterial color="#b03a2e" />
          </mesh>
        </group>
      ))}
    </>
  );
}
