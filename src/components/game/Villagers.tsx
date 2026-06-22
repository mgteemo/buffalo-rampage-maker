import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { BuffaloHandle } from "./Buffalo";
import { stats, notifyStats, emitEvent, input, world, addCoins, ATTACK_RANGE } from "./gameState";
import { audio } from "./audio";
import { ROAD_LEN, ROAD_Z } from "./Environment";

type Job = "plant" | "tree" | "walk" | "drive";

type Npc = {
  id: number;
  job: Job;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  phase: number;
  // walk/drive waypoints
  target: THREE.Vector3;
  // hit cooldown timestamp (sec)
  hitUntil: number;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  carColor?: THREE.Color;
  // drive only
  dir?: 1 | -1; // travel direction along +x or -x
  lane?: number; // z offset within the road
  speed?: number; // cruise speed
  stopped?: boolean;
  driverOut?: boolean; // is driver leaning out the window shouting
  // Destruction state
  dead: boolean; // human: knocked down dead
  onFire: boolean; // car: burning wreck
  fallProgress: number; // 0 → 1 for dead human topple
  lastAttackId: number;
};




const SHIRT_COLORS = ["#d94545", "#3a7bd5", "#e0a32e", "#2fa56b", "#8d5fd3", "#e6713a"];
const PANT_COLORS = ["#2b2b3a", "#3b2a1a", "#1f3a2a", "#2e2e2e"];
const SKIN_COLORS = ["#c79a72", "#b07852", "#9b6a44", "#d6a884"];
const CAR_COLORS = ["#c52d2d", "#1e6fc5", "#e2b400", "#2fa56b", "#e8e8e8", "#222831"];
// Lane offsets (z position within road). Positive z = +x bound, negative z = -x bound.
const CAR_LANES: { lane: number; dir: 1 | -1 }[] = [
  { lane: 3, dir: 1 },
  { lane: -3, dir: -1 },
];

function pickColor(arr: string[], i: number) {
  return new THREE.Color(arr[i % arr.length]);
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}




export function Villagers({ buffaloRef }: { buffaloRef: React.MutableRefObject<BuffaloHandle> }) {
  const groupRef = useRef<THREE.Group>(null!);
  // Per-driver "is shouting at the buffalo right now" — drives speech bubble + driver-out animation.
  const [shouting, setShouting] = useState<Record<number, boolean>>({});
  const shoutingRef = useRef<Record<number, boolean>>({});


  const npcs = useMemo<Npc[]>(() => {
    const list: Npc[] = [];
    let id = 0;
    const make = (job: Job, x: number, z: number, carIdx = 0): Npc => ({
      id: id++,
      job,
      pos: new THREE.Vector3(x, 0, z),
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      target: new THREE.Vector3(x + rand(-8, 8), 0, z + rand(-8, 8)),
      hitUntil: 0,
      shirt: pickColor(SHIRT_COLORS, id),
      pants: pickColor(PANT_COLORS, id),
      skin: pickColor(SKIN_COLORS, id),
      carColor: job === "drive" ? pickColor(CAR_COLORS, carIdx) : undefined,
      dead: false,
      onFire: false,
      fallProgress: 0,
      lastAttackId: 0,
    });

    // 8 rice planters scattered in paddy
    for (let i = 0; i < 8; i++) list.push(make("plant", rand(-30, 30), rand(-30, 30)));
    // 4 tree growers near forest edge
    for (let i = 0; i < 4; i++) list.push(make("tree", rand(-38, 38), rand(20, 38)));
    // 5 walkers wandering
    for (let i = 0; i < 5; i++) list.push(make("walk", rand(-35, 35), rand(-35, 35)));
    // 6 drivers on the straight road, alternating directions and lanes
    const CAR_COUNT = 6;
    for (let i = 0; i < CAR_COUNT; i++) {
      const ln = CAR_LANES[i % CAR_LANES.length];
      const x = -ROAD_LEN / 2 + ((i + 1) / (CAR_COUNT + 1)) * ROAD_LEN;
      const z = ROAD_Z + ln.lane;
      const n = make("drive", x, z, i);
      n.dir = ln.dir;
      n.lane = ln.lane;
      n.speed = 7 + Math.random() * 2;
      n.yaw = ln.dir === 1 ? 0 : Math.PI;
      n.stopped = false;
      n.driverOut = false;
      list.push(n);
    }
    return list;
  }, []);

  // Per-NPC refs to manipulate transforms each frame
  const refs = useRef<(THREE.Group | null)[]>([]);
  const legL = useRef<(THREE.Group | null)[]>([]);
  const legR = useRef<(THREE.Group | null)[]>([]);
  const armL = useRef<(THREE.Group | null)[]>([]);
  const armR = useRef<(THREE.Group | null)[]>([]);

  useEffect(() => {
    npcs.forEach((n) => {
      audio.registerSource(`npc-${n.id}`, n.job === "drive" ? "car" : "human");
    });
    return () => {
      npcs.forEach((n) => audio.removeSource(`npc-${n.id}`));
    };
  }, [npcs]);

  useFrame((state, dt) => {
    const buf = buffaloRef.current.group;
    if (!buf) return;
    const bx = buf.position.x;
    const bz = buf.position.z;
    const bufSpeed = Math.hypot(buffaloRef.current.velocity.x, buffaloRef.current.velocity.z);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      const g = refs.current[i];
      if (!g) continue;

      const dx = n.pos.x - bx;
      const dz = n.pos.z - bz;
      const dist = Math.hypot(dx, dz);

      // ------- ATTACK: kill humans / ignite cars when in swing range -------
      const attacking = t < input.attackUntil;
      const npcAttackR = n.job === "drive" ? ATTACK_RANGE + 1.5 : ATTACK_RANGE;
      if (
        attacking &&
        n.lastAttackId !== input.attackId &&
        !n.dead && !n.onFire &&
        dist < npcAttackR
      ) {
        n.lastAttackId = input.attackId;
        if (n.job === "drive") {
          n.onFire = true;
          n.stopped = true;
          n.driverOut = false;
          shoutingRef.current[n.id] = false;
          setShouting({ ...shoutingRef.current });
          stats.destroyed++;
          notifyStats();
          addCoins(70, "torched a car!");
          emitEvent({ type: "coin", message: "🔥 Car on fire!", severity: "major" });
        } else {
          n.dead = true;
          stats.destroyed++;
          notifyStats();
          addCoins(25, "knocked out a villager!");
          emitEvent({ type: "coin", message: "💀 Villager down!", severity: "major" });
          // Knockback the corpse away from buffalo
          const nx = dx / (dist || 1);
          const nz = dz / (dist || 1);
          n.vel.x += nx * 5;
          n.vel.z += nz * 5;
        }
      }

      // ------- Destroyed NPCs: lay still + push buffalo away (solid wreck/body) -------
      if (n.dead || n.onFire) {
        // Stop motion (humans drift to a halt, cars stay parked).
        n.vel.x *= Math.max(0, 1 - dt * 3);
        n.vel.z *= Math.max(0, 1 - dt * 3);
        n.pos.x += n.vel.x * dt;
        n.pos.z += n.vel.z * dt;
        if (n.dead && n.fallProgress < 1) {
          n.fallProgress = Math.min(1, n.fallProgress + dt * 3);
        }
        // Wreck collision so buffalo can't ghost through.
        const solidR = n.onFire ? 1.6 : 0.6;
        const cdx = bx - n.pos.x;
        const cdz = bz - n.pos.z;
        const cd = Math.hypot(cdx, cdz);
        if (cd < solidR && cd > 0) {
          const nx = cdx / cd;
          const nz = cdz / cd;
          buf.position.x = n.pos.x + nx * solidR;
          buf.position.z = n.pos.z + nz * solidR;
          const v = buffaloRef.current.velocity;
          const inward = -(v.x * nx + v.z * nz);
          if (inward > 0) {
            v.x += nx * inward;
            v.z += nz * inward;
          }
        }
        g.position.set(n.pos.x, 0, n.pos.z);
        g.rotation.y = n.yaw;
        // Human topples: rotate around z-axis as it dies
        if (n.dead) {
          g.rotation.z = n.fallProgress * (Math.PI / 2 - 0.08);
        }
        continue;
      }


      // Punishment on collision
      const hitR = n.job === "drive" ? 2.2 : 1.1;
      if (dist < hitR && t > n.hitUntil) {
        n.hitUntil = t + 2.5;
        stats.npcsHit++;
        const dashing = t < input.dashUntil;
        const minor = bufSpeed < 4 && !dashing;
        const loss = minor ? 4 : 10;
        stats.karma = Math.max(0, stats.karma - loss);
        notifyStats();
        // RAM rewards (only when actually charging)
        if (dashing) {
          if (n.job === "drive") addCoins(40, "rammed a car!");
          else addCoins(15, "rammed a villager!");
        }
        emitEvent({
          type: "punish",
          message: minor
            ? `😠 Villager bumped! -${loss} karma`
            : n.job === "drive"
              ? `🚗💥 You hit a car! -${loss} karma`
              : `💢 You trampled a villager! -${loss} karma`,
          severity: minor ? "minor" : "major",
        });
        // Knockback NPC away from buffalo
        const nx = dx / (dist || 1); // points from buffalo -> npc (away)
        const nz = dz / (dist || 1);
        n.vel.x += nx * 6;
        n.vel.z += nz * 6;
        // Knockback buffalo away from npc (do NOT lock controls — PUBG-style stays free)
        if (!minor) {
          buffaloRef.current.velocity.x = -nx * 4;
          buffaloRef.current.velocity.z = -nz * 4;
        }
      }

      // Behaviour
      const fearR = n.job === "drive" ? 0 : 8;
      const scared = dist < fearR && bufSpeed > 1.5;

      if (n.job === "drive") {
        // Detect buffalo near the car. Use hysteresis so the state doesn't flicker.
        const STOP_R = 9;
        const RESUME_R = 13;
        const prev = !!n.stopped;
        if (!n.stopped && dist < STOP_R) {
          n.stopped = true;
          n.driverOut = true;
        } else if (n.stopped && dist > RESUME_R) {
          n.stopped = false;
          n.driverOut = false;
        }
        if (prev !== n.stopped) {
          shoutingRef.current[n.id] = !!n.stopped;
          // Schedule a single React update — avoids per-frame setState churn.
          setShouting({ ...shoutingRef.current });
        }
        const targetSpeed = n.stopped ? 0 : (n.speed ?? 7);
        // Ease current velocity toward target speed along travel direction
        const dir = n.dir ?? 1;
        const cur = n.vel.x * dir; // scalar along travel dir (>=0 when moving forward)
        const accel = n.stopped ? 14 : 6; // brake faster than accelerate
        const next = cur + Math.sign(targetSpeed - cur) * Math.min(Math.abs(targetSpeed - cur), accel * dt);
        n.vel.x = next * dir;
        n.vel.z = 0;
        n.pos.x += n.vel.x * dt;
        // Snap to lane z
        n.pos.z = ROAD_Z + (n.lane ?? 0);
        // Loop around when leaving the road
        const halfLen = ROAD_LEN / 2;
        if (n.pos.x > halfLen + 4) n.pos.x = -halfLen - 4;
        else if (n.pos.x < -halfLen - 4) n.pos.x = halfLen + 4;
        n.yaw = dir === 1 ? 0 : Math.PI;
      } else if (scared) {
        // Run AWAY from buffalo: direction = (npc - buffalo)
        const speed = 5.5;
        const ax = dx / (dist || 1);
        const az = dz / (dist || 1);
        n.pos.x += ax * speed * dt;
        n.pos.z += az * speed * dt;
        n.yaw = Math.atan2(ax, az);
        n.phase += dt * 12;
      } else if (n.job === "walk") {
        // Wander toward target
        const tx = n.target.x - n.pos.x;
        const tz = n.target.z - n.pos.z;
        const td = Math.hypot(tx, tz);
        if (td < 1) {
          n.target.set(rand(-35, 35), 0, rand(-35, 35));
        } else {
          const speed = 1.6;
          n.pos.x += (tx / td) * speed * dt;
          n.pos.z += (tz / td) * speed * dt;
          n.yaw = Math.atan2(tx, tz);
          n.phase += dt * 5;
        }
      } else {
        // plant / tree: stationary working animation
        n.phase += dt * 3;
      }

      // Apply knockback inertia (skip for drive — cars manage their own motion)
      if (n.job !== "drive") {
        n.pos.x += n.vel.x * dt;
        n.pos.z += n.vel.z * dt;
        n.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
        n.pos.x = Math.max(-48, Math.min(48, n.pos.x));
        n.pos.z = Math.max(-48, Math.min(48, n.pos.z));
      }

      g.position.set(n.pos.x, 0, n.pos.z);
      g.rotation.y = n.yaw;

      // Audio: proximity-based intensity (cars rev, humans scream when close)
      const audioRange = n.job === "drive" ? 25 : 14;
      const proximity = Math.max(0, Math.min(1, 1 - dist / audioRange));
      audio.updateSource(`npc-${n.id}`, n.pos.x, 1.2, n.pos.z, proximity);

      // Crouch pose for planters
      const crouch = n.job === "plant" && !scared;

      // Limb animation
      const ll = legL.current[i];
      const lr = legR.current[i];
      const al = armL.current[i];
      const ar = armR.current[i];
      if (ll && lr) {
        const swing = scared || n.job === "walk" ? Math.sin(n.phase) * 0.7 : 0;
        ll.rotation.x = swing;
        lr.rotation.x = -swing;
        // crouch lowers everything
        const baseY = crouch ? -0.25 : 0;
        ll.position.y = baseY + 0.55;
        lr.position.y = baseY + 0.55;
      }
      if (al && ar) {
        if (n.job === "plant" && !scared) {
          // both arms reach down, bobbing
          al.rotation.x = 1.3 + Math.sin(n.phase) * 0.3;
          ar.rotation.x = 1.3 + Math.sin(n.phase + 0.5) * 0.3;
        } else if (n.job === "tree" && !scared) {
          // watering: one arm up, bob
          al.rotation.x = -1.0 + Math.sin(n.phase) * 0.2;
          ar.rotation.x = -0.4;
        } else if (scared) {
          // flailing
          al.rotation.x = Math.sin(n.phase) * 1.4;
          ar.rotation.x = -Math.sin(n.phase) * 1.4;
        } else {
          al.rotation.x = Math.sin(n.phase) * 0.5;
          ar.rotation.x = -Math.sin(n.phase) * 0.5;
        }
      }

      // Body crouch translation
      const bodyY = crouch ? 0.55 : 0.9;
      g.position.y = bodyY - 0.9; // because internal model is centered at y≈0.9
    }
    void world; // silence unused warning if removed elsewhere
  });

  return (
    <group ref={groupRef}>
      {npcs.map((n, i) => (
        <group key={n.id} ref={(el) => (refs.current[i] = el)}>
          {n.job === "drive" ? (
            <Car
              color={n.carColor!}
              skin={n.skin}
              shirt={n.shirt}
              shouting={!!shouting[n.id] && !n.onFire}
              onFire={n.onFire}
            />
          ) : (
            <Human
              shirt={n.shirt}
              pants={n.pants}
              skin={n.skin}
              legLRef={(el) => (legL.current[i] = el)}
              legRRef={(el) => (legR.current[i] = el)}
              armLRef={(el) => (armL.current[i] = el)}
              armRRef={(el) => (armR.current[i] = el)}
              job={n.job}
              dead={n.dead}
            />
          )}
        </group>
      ))}
    </group>
  );
}

function Human({
  shirt,
  pants,
  skin,
  legLRef,
  legRRef,
  armLRef,
  armRRef,
  job,
  dead = false,
}: {
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  legLRef: (el: THREE.Group | null) => void;
  legRRef: (el: THREE.Group | null) => void;
  armLRef: (el: THREE.Group | null) => void;
  armRRef: (el: THREE.Group | null) => void;
  job: Job;
  dead?: boolean;
}) {
  const hatColor = useMemo(() => new THREE.Color(job === "plant" ? "#d9c27a" : "#3a2a1a"), [job]);
  return (
    <group position={[0, 0.9, 0]}>
      {dead && (
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial color="#ff3344" />
        </mesh>
      )}
      {/* Torso */}
      <mesh castShadow position={[0, 0.55, 0]}>
        <boxGeometry args={[0.55, 0.7, 0.32]} />
        <meshStandardMaterial color={shirt} roughness={0.9} />
      </mesh>
      {/* Head */}
      <mesh castShadow position={[0, 1.1, 0]}>
        <sphereGeometry args={[0.22, 14, 12]} />
        <meshStandardMaterial color={skin} roughness={0.8} />
      </mesh>
      {/* Conical / brim hat */}
      <mesh castShadow position={[0, 1.32, 0]}>
        <coneGeometry args={[0.34, 0.22, 14]} />
        <meshStandardMaterial color={hatColor} roughness={0.9} />
      </mesh>
      {/* Arms — pivot at shoulder so rotation.x swings the arm */}
      <group ref={armLRef} position={[-0.36, 0.85, 0]}>
        <mesh castShadow position={[0, -0.3, 0]}>
          <boxGeometry args={[0.16, 0.6, 0.16]} />
          <meshStandardMaterial color={shirt} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, -0.66, 0]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>
      <group ref={armRRef} position={[0.36, 0.85, 0]}>
        <mesh castShadow position={[0, -0.3, 0]}>
          <boxGeometry args={[0.16, 0.6, 0.16]} />
          <meshStandardMaterial color={shirt} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, -0.66, 0]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>
      {/* Legs — pivot at hip */}
      <group ref={legLRef} position={[-0.14, 0.2, 0]}>
        <mesh castShadow position={[0, -0.32, 0]}>
          <boxGeometry args={[0.18, 0.65, 0.2]} />
          <meshStandardMaterial color={pants} roughness={0.9} />
        </mesh>
      </group>
      <group ref={legRRef} position={[0.14, 0.2, 0]}>
        <mesh castShadow position={[0, -0.32, 0]}>
          <boxGeometry args={[0.18, 0.65, 0.2]} />
          <meshStandardMaterial color={pants} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function Car({
  color,
  skin,
  shirt,
  shouting,
  onFire = false,
}: {
  color: THREE.Color;
  skin: THREE.Color;
  shirt: THREE.Color;
  shouting: boolean;
  onFire?: boolean;
}) {
  // When shouting, the driver leans out the LEFT-side window (driver's side at +z).
  const driverPos: [number, number, number] = shouting ? [-0.1, 1.05, 0.55] : [-0.1, 1.0, 0];
  const driverRot: [number, number, number] = shouting ? [0, 0, 0.2] : [0, 0, 0];
  const bodyColor = onFire ? "#3a1a14" : (color as THREE.Color);
  const flameRef = useRef<THREE.Group>(null!);
  useFrame((state) => {
    if (onFire && flameRef.current) {
      const t = state.clock.elapsedTime;
      flameRef.current.scale.setScalar(0.8 + Math.sin(t * 12) * 0.15);
      flameRef.current.rotation.y = t * 2;
    }
  });
  return (
    <group position={[0, 0, 0]}>
      {/* Body */}
      <mesh castShadow position={[0, 0.55, 0]}>
        <boxGeometry args={[1.9, 0.55, 0.95]} />
        <meshStandardMaterial color={bodyColor} roughness={onFire ? 1 : 0.5} metalness={onFire ? 0 : 0.3} />
      </mesh>
      {/* Cabin */}
      <mesh castShadow position={[-0.1, 0.95, 0]}>
        <boxGeometry args={[1.05, 0.45, 0.85]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Windshield */}
      <mesh position={[0.42, 0.98, 0]}>
        <boxGeometry args={[0.02, 0.35, 0.78]} />
        <meshStandardMaterial color="#9ad7ff" roughness={0.1} metalness={0.6} />
      </mesh>
      {/* Driver — leans out the window when shouting */}
      <group position={driverPos} rotation={driverRot}>
        <mesh castShadow position={[0, 0.15, 0]}>
          <sphereGeometry args={[0.16, 12, 10]} />
          <meshStandardMaterial color={skin} />
        </mesh>
        <mesh castShadow position={[0, -0.1, 0]}>
          <boxGeometry args={[0.35, 0.3, 0.3]} />
          <meshStandardMaterial color={shirt} />
        </mesh>
        {/* Waving arm */}
        {shouting && (
          <mesh castShadow position={[0.0, 0.05, 0.25]} rotation={[0, 0, -0.8]}>
            <boxGeometry args={[0.12, 0.5, 0.12]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
        )}
      </group>
      {/* Speech bubble */}
      {shouting && (
        <Html
          position={[-0.1, 2.1, 0]}
          center
          distanceFactor={10}
          zIndexRange={[100, 0]}
          pointerEvents="none"
        >
          <div
            style={{
              background: "white",
              color: "#222",
              border: "2px solid #222",
              borderRadius: 14,
              padding: "6px 10px",
              fontFamily: "system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 14,
              whiteSpace: "nowrap",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              userSelect: "none",
            }}
          >
            💢 Shoo… shoo, go away! 💭
          </div>
        </Html>
      )}

      {/* Wheels */}
      {[
        [-0.7, 0.25, 0.5],
        [0.7, 0.25, 0.5],
        [-0.7, 0.25, -0.5],
        [0.7, 0.25, -0.5],
      ].map((p, i) => (
        <mesh key={i} castShadow position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.18, 12]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      ))}
      {/* Headlights */}
      <mesh position={[0.96, 0.55, 0.3]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color="#fff7c0" emissive="#fff5b0" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.96, 0.55, -0.3]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color="#fff7c0" emissive="#fff5b0" emissiveIntensity={0.6} />
      </mesh>
      {/* FIRE: flickering flames + smoke when wrecked */}
      {onFire && (
        <>
          <group ref={flameRef} position={[0, 1.3, 0]}>
            <mesh>
              <coneGeometry args={[0.6, 1.4, 10]} />
              <meshBasicMaterial color="#ff8800" transparent opacity={0.95} />
            </mesh>
            <mesh position={[0, 0.4, 0]}>
              <coneGeometry args={[0.35, 0.9, 8]} />
              <meshBasicMaterial color="#ffe24a" transparent opacity={0.9} />
            </mesh>
            <mesh position={[0.3, -0.1, 0.2]}>
              <coneGeometry args={[0.3, 0.7, 8]} />
              <meshBasicMaterial color="#ff4400" transparent opacity={0.9} />
            </mesh>
          </group>
          {/* Smoke plume */}
          <mesh position={[0, 2.5, 0]}>
            <sphereGeometry args={[0.7, 10, 8]} />
            <meshStandardMaterial color="#444" transparent opacity={0.55} />
          </mesh>
          <mesh position={[0.2, 3.2, 0.1]}>
            <sphereGeometry args={[0.55, 10, 8]} />
            <meshStandardMaterial color="#333" transparent opacity={0.45} />
          </mesh>
          <pointLight color="#ff6622" intensity={2.5} distance={8} position={[0, 1.2, 0]} />
        </>
      )}
    </group>
  );
}

