import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BuffaloHandle } from "./Buffalo";
import { input, world, setMode, stats, notifyStats, notifyMode, addCoins } from "./gameState";
import { audio } from "./audio";

// Simple stylized AI buffalo (cheap)
function MiniBuffalo({ color = "#2d2014" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[0.8, 14, 12]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.55, 0.85]}>
        <sphereGeometry args={[0.45, 12, 10]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      <mesh position={[-0.3, 0.85, 0.85]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.22, 0.06, 8, 12, Math.PI]} />
        <meshStandardMaterial color="#e8d5a8" />
      </mesh>
      <mesh position={[0.3, 0.85, 0.85]} rotation={[0, Math.PI, Math.PI / 2]}>
        <torusGeometry args={[0.22, 0.06, 8, 12, Math.PI]} />
        <meshStandardMaterial color="#e8d5a8" />
      </mesh>
      {[
        [-0.4, -0.1, 0.4],
        [0.4, -0.1, 0.4],
        [-0.4, -0.1, -0.4],
        [0.4, -0.1, -0.4],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <cylinderGeometry args={[0.13, 0.15, 0.6, 8]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

type Obstacle =
  | { kind: "mud"; x: number; z: number; r: number }
  | { kind: "hill"; x: number; z: number; w: number }
  | { kind: "hole"; x: number; z: number; r: number };

const RACE_FINISH_Z = -240;
const TRACK_HALF_WIDTH = 8;

function buildTrack(): Obstacle[] {
  // Pseudo-random layout along z. Obstacles spread across nearly the full
  // track width (lanes left/center/right), not just the middle.
  const list: Obstacle[] = [];
  let z = -10;
  let i = 0;
  let seed = 1337;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  while (z > -230) {
    const kind = Math.floor(rand() * 3) as 0 | 1 | 2;
    // pick lane: -1, 0, 1 then jitter; clamp inside fences
    const lane = Math.floor(rand() * 3) - 1;
    const x = Math.max(-7, Math.min(7, lane * 4.5 + (rand() - 0.5) * 2.5));
    if (kind === 0) list.push({ kind: "mud", x, z, r: 1.8 + rand() * 0.8 });
    else if (kind === 1) list.push({ kind: "hill", x, z, w: 3.0 + rand() * 1.5 });
    else list.push({ kind: "hole", x, z, r: 1.4 + rand() * 0.6 });
    // Occasionally drop a second obstacle on a different lane at the same z
    if (rand() < 0.35) {
      const lane2 = Math.floor(rand() * 3) - 1;
      const x2 = Math.max(-7, Math.min(7, lane2 * 4.5 + (rand() - 0.5) * 2));
      if (Math.abs(x2 - x) > 3) {
        const k2 = Math.floor(rand() * 3);
        if (k2 === 0) list.push({ kind: "mud", x: x2, z, r: 1.6 });
        else if (k2 === 1) list.push({ kind: "hill", x: x2, z, w: 2.6 });
        else list.push({ kind: "hole", x: x2, z, r: 1.3 });
      }
    }
    z -= 11 + rand() * 5;
    i++;
  }
  return list;
}

type Ai = {
  z: number;
  x: number;
  y: number;
  vy: number;
  speed: number;
  finished: boolean;
};

export function RaceScene({ buffaloRef }: { buffaloRef: React.MutableRefObject<BuffaloHandle> }) {
  const obstacles = useMemo(buildTrack, []);
  const startTime = useRef<number | null>(null);
  const ais = useRef<Ai[]>([
    { z: -2, x: -5, y: 0, vy: 0, speed: 7.8, finished: false },
    { z: -2, x: -2.5, y: 0, vy: 0, speed: 7.6, finished: false },
    { z: -2, x: 2.5, y: 0, vy: 0, speed: 8.0, finished: false },
    { z: -2, x: 5, y: 0, vy: 0, speed: 7.7, finished: false },
  ]);
  const aiRefs = useRef<(THREE.Group | null)[]>([]);
  const lockMessage = useRef(0);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;

    // Countdown handling
    if (world.mode === "race-countdown") {
      if (startTime.current === null) startTime.current = t;
      const elapsed = t - startTime.current;
      const remaining = Math.max(0, Math.ceil(5 - elapsed));
      if (remaining !== world.countdown) {
        world.countdown = remaining;
        notifyMode();
        if (remaining > 0) audio.playCountdownBeep(false);
      }
      if (elapsed >= 5) {
        startTime.current = t;
        world.raceTime = 0;
        audio.playCountdownBeep(true);
        setMode("race-running");
      }
      // Lock player in place during countdown
      input.controlsLockedUntil = t + 0.05;
    }

    if (world.mode !== "race-running" && world.mode !== "race-countdown") return;

    const buf = buffaloRef.current.group;
    if (!buf) return;

    if (world.mode === "race-running") {
      world.raceTime = t - (startTime.current ?? t);

      // Obstacle effects
      const bx = buf.position.x;
      const bz = buf.position.z;
      const by = buf.position.y;
      for (const o of obstacles) {
        const dx = bx - o.x;
        const dz = bz - o.z;
        if (o.kind === "mud") {
          if (dx * dx + dz * dz < o.r * o.r) {
            // Slow heavy: dampen velocity
            buffaloRef.current.velocity.x *= 0.86;
            buffaloRef.current.velocity.z *= 0.86;
          }
        } else if (o.kind === "hill") {
          // Wedge blocker — if buffalo is in zone and not airborne, push back along z
          if (Math.abs(dx) < o.w / 2 && Math.abs(dz) < 1.2) {
            if (by < 1.6) {
              // can't pass; bounce back
              buf.position.z += 0.6;
              buffaloRef.current.velocity.z = Math.max(0, buffaloRef.current.velocity.z);
            }
          }
        } else if (o.kind === "hole") {
          if (dx * dx + dz * dz < o.r * o.r && by < 0.9) {
            // Player did NOT jump in time → fall in, lock controls for 2s
            if (t > input.controlsLockedUntil - 1.5) {
              input.controlsLockedUntil = t + 2;
              lockMessage.current = t + 2;
              buffaloRef.current.velocity.set(0, 0, 0);
              buf.position.y = 0.25;
            }
          }
        }
      }

      // AI buffalo update — they read the same obstacles and must react.
      ais.current.forEach((ai, idx) => {
        if (!ai.finished) {
          // Rubber-band: speed up if behind, base difficulty hard.
          const playerProg = -buf.position.z;
          const myProg = -ai.z;
          const diff = playerProg - myProg;
          let boost = diff > 5 ? 1.35 : diff < -5 ? 0.85 : 1.0;

          // Look ahead for obstacles in this AI's column
          let mustJump = false;
          let blocked = false;
          for (const o of obstacles) {
            const ax = ai.x - o.x;
            const az = ai.z - o.z;
            // ahead means az > 0 (AI travels in -z)
            const lateral = o.kind === "hill" ? o.w / 2 + 0.6 : o.r + 0.6;
            if (Math.abs(ax) < lateral && az > -0.4 && az < 4) {
              if (o.kind === "mud") {
                if (az < 2) boost *= 0.55; // wade through, no jump
              } else if (o.kind === "hill") {
                if (az < 2.2 && ai.y < 0.4) mustJump = true;
                if (az < 1.0 && ai.y < 1.4) blocked = true;
                if (az < 3) boost *= 0.85;
              } else if (o.kind === "hole") {
                if (az < 2.0 && ai.y < 0.4) mustJump = true;
                if (az < 2) boost *= 0.7;
              }
            }
          }

          // Trigger a jump (impulse) — physics handled below
          if (mustJump && ai.y <= 0.05 && ai.vy <= 0) {
            ai.vy = 7.2;
          }

          // If still grounded right at a hill front face, halt forward progress
          if (blocked && ai.y < 1.4) {
            boost *= 0.05;
          }

          ai.z -= ai.speed * boost * dt;
          if (ai.z <= RACE_FINISH_Z) ai.finished = true;
        }

        // Vertical physics (jump arc)
        ai.vy -= 18 * dt;
        ai.y += ai.vy * dt;
        if (ai.y <= 0) { ai.y = 0; ai.vy = 0; }

        const g = aiRefs.current[idx];
        if (g) {
          // Bobbing only when grounded
          const bob = ai.y < 0.05 ? Math.abs(Math.sin(t * 8 + idx)) * 0.08 : 0;
          g.position.set(ai.x, ai.y + bob, ai.z);
          g.rotation.y = Math.PI;
          g.rotation.x = ai.vy > 0 ? -0.15 : ai.vy < -2 ? 0.15 : 0;
        }
      });

      // Clamp player to track width
      if (buf.position.x > TRACK_HALF_WIDTH) buf.position.x = TRACK_HALF_WIDTH;
      if (buf.position.x < -TRACK_HALF_WIDTH) buf.position.x = -TRACK_HALF_WIDTH;
      if (buf.position.z > 5) buf.position.z = 5;

      // Win/lose
      if (buf.position.z <= RACE_FINISH_Z) {
        const aiFinishedFirst = ais.current.some((a) => a.finished);
        if (aiFinishedFirst) setMode("race-lose");
        else {
          stats.racesWon++;
          notifyStats();
          addCoins(150, "race won!");
          setMode("race-win");
        }
      } else if (ais.current.every((a) => a.finished)) {
        setMode("race-lose");
      }

      // Fighting in race: if fightQueued and AI close, both take damage but you slow
      if (input.fightQueued) {
        input.fightQueued = false;
        let nearest = -1;
        let nd = 9;
        ais.current.forEach((ai, idx) => {
          if (ai.finished) return;
          const dx = ai.x - buf.position.x;
          const dz = ai.z - buf.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < nd) {
            nd = d2;
            nearest = idx;
          }
        });
        if (nearest >= 0) {
          ais.current[nearest].speed *= 0.92;
          // Player slowed too
          buffaloRef.current.velocity.x *= 0.5;
          buffaloRef.current.velocity.z *= 0.5;
          world.playerHp = Math.max(0, world.playerHp - 6);
          world.enemyHp = Math.max(0, world.enemyHp - 4);
          notifyMode();
          if (world.playerHp <= 0) setMode("race-lose");
        }
      }
    }
  });

  return (
    <group>
      {/* Track surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -120]} receiveShadow>
        <planeGeometry args={[24, 260]} />
        <meshStandardMaterial color="#7a5a3a" roughness={1} />
      </mesh>
      {/* Side fences */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (TRACK_HALF_WIDTH + 1.5), 0.6, -120]}>
          <boxGeometry args={[0.4, 1.2, 260]} />
          <meshStandardMaterial color="#3d2a1f" roughness={1} />
        </mesh>
      ))}
      {/* Start gate */}
      <group position={[0, 0, 2]}>
        <mesh position={[0, 4, 0]}>
          <boxGeometry args={[20, 0.6, 0.6]} />
          <meshStandardMaterial color="#c0392b" />
        </mesh>
        <mesh position={[-9.5, 2, 0]}>
          <boxGeometry args={[0.5, 4, 0.5]} />
          <meshStandardMaterial color="#c0392b" />
        </mesh>
        <mesh position={[9.5, 2, 0]}>
          <boxGeometry args={[0.5, 4, 0.5]} />
          <meshStandardMaterial color="#c0392b" />
        </mesh>
      </group>
      {/* Finish line */}
      <group position={[0, 0, RACE_FINISH_Z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[16, 2]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        <mesh position={[0, 5, 0]}>
          <boxGeometry args={[20, 0.6, 0.6]} />
          <meshStandardMaterial color="#1abc9c" />
        </mesh>
        <mesh position={[-9.5, 2.5, 0]}>
          <boxGeometry args={[0.5, 5, 0.5]} />
          <meshStandardMaterial color="#1abc9c" />
        </mesh>
        <mesh position={[9.5, 2.5, 0]}>
          <boxGeometry args={[0.5, 5, 0.5]} />
          <meshStandardMaterial color="#1abc9c" />
        </mesh>
      </group>

      {/* Obstacles */}
      {obstacles.map((o, i) => {
        if (o.kind === "mud") {
          return (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[o.x, 0.03, o.z]}>
              <circleGeometry args={[o.r, 16]} />
              <meshStandardMaterial color="#3a2410" roughness={1} />
            </mesh>
          );
        }
        if (o.kind === "hill") {
          return (
            <mesh key={i} position={[o.x, 0.8, o.z]}>
              <boxGeometry args={[o.w, 1.6, 2.5]} />
              <meshStandardMaterial color="#5a4030" roughness={0.95} />
            </mesh>
          );
        }
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[o.x, 0.04, o.z]}>
            <circleGeometry args={[o.r, 20]} />
            <meshStandardMaterial color="#0a0604" roughness={1} />
          </mesh>
        );
      })}

      {/* AI rival buffalos */}
      {ais.current.map((_, i) => (
        <group
          key={i}
          ref={(el) => {
            aiRefs.current[i] = el;
          }}
        >
          <MiniBuffalo color={["#2d2014", "#3d2a1f", "#4a3020", "#1a1208"][i]} />
        </group>
      ))}

      {/* Lots of grass tufts to fill the void */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, 0, -120]} receiveShadow>
        <planeGeometry args={[200, 280]} />
        <meshStandardMaterial color="#5a8a3a" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-60, 0, -120]} receiveShadow>
        <planeGeometry args={[200, 280]} />
        <meshStandardMaterial color="#5a8a3a" roughness={1} />
      </mesh>
    </group>
  );
}

// Expose AI positions so the Fight button in HUD can detect proximity
export function aiRivalNear(buf: THREE.Vector3): boolean {
  // placeholder; the RaceScene above keeps state internally — we expose via world
  return Math.abs(buf.z) > 0;
}
