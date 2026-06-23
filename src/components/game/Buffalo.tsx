import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { input, world } from "./gameState";
import type { Skin } from "./skins";

const MAP_BOUND = 240;
// Starting point: far outside the city, on the road, heading east toward town.
export const BUFFALO_START_X = -210;
export const BUFFALO_START_Z = 0;
export const BUFFALO_START_YAW = Math.PI / 2; // faces +X (toward city at origin)

export type BuffaloHandle = {
  group: THREE.Group | null;
  velocity: THREE.Vector3;
  grounded: boolean;
};

export function Buffalo({ apiRef, skin }: { apiRef: React.MutableRefObject<BuffaloHandle>; skin: Skin }) {
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const tail = useRef<THREE.Group>(null!);
  const legFL = useRef<THREE.Group>(null!);
  const legFR = useRef<THREE.Group>(null!);
  const legBL = useRef<THREE.Group>(null!);
  const legBR = useRef<THREE.Group>(null!);

  const velocity = useRef(new THREE.Vector3());
  const yaw = useRef(BUFFALO_START_YAW);
  const grounded = useRef(true);
  const phase = useRef(0);

  // Cartoon palette — driven by selected skin.
  const furDark = useMemo(() => new THREE.Color(skin.dark), [skin.dark]);
  const furLight = useMemo(() => new THREE.Color(skin.light), [skin.light]);
  const horn = useMemo(() => new THREE.Color(skin.hornColor ?? "#f4e6c8"), [skin.hornColor]);
  const hoof = useMemo(() => new THREE.Color("#1a1208"), []);
  const snout = useMemo(() => new THREE.Color("#8a6450"), []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    apiRef.current.group = g;
    apiRef.current.velocity = velocity.current;

    // Race start: snap yaw to face down the track (-Z).
    if (world.pendingYawReset) {
      yaw.current = Math.PI;
      g.rotation.y = Math.PI;
      world.pendingYawReset = false;
    }

    const locked = state.clock.elapsedTime < input.controlsLockedUntil;
    const mv = input.move;
    const turnInput = locked ? 0 : Math.max(-1, Math.min(1, mv.x));
    const fwdInput = locked ? 0 : Math.max(-1, Math.min(1, -mv.y)); // stick up = forward
    const mag = Math.min(1, Math.max(Math.abs(turnInput), Math.abs(fwdInput)));

    // Tank-style steering with chase camera:
    //  - Left/right rotates the buffalo (camera trails behind via FollowCamera)
    //  - Forward/back drives along the buffalo's current facing direction
    const turnRate = 2.6; // rad/sec
    yaw.current -= turnInput * turnRate * dt;
    g.rotation.y = yaw.current;

    const dashing = !locked && state.clock.elapsedTime < input.dashUntil;
    const racing = world.mode === "race-running" || world.mode === "race-countdown";
    const baseSpeed = racing ? 9 : 6;
    const speed = dashing ? (racing ? 14 : 16) : baseSpeed;

    // Move along the buffalo's own forward vector (local space).
    const fwd = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    const desired = fwd.multiplyScalar(fwdInput * speed);
    velocity.current.x += (desired.x - velocity.current.x) * Math.min(1, dt * 8);
    velocity.current.z += (desired.z - velocity.current.z) * Math.min(1, dt * 8);
    velocity.current.y -= 22 * dt;




    if (!locked && input.jumpQueued && grounded.current) {
      velocity.current.y = 9;
      grounded.current = false;
    }
    input.jumpQueued = false;

    if (locked) {
      // sunk-in-hole: kill horizontal velocity
      velocity.current.x = 0;
      velocity.current.z = 0;
    }

    g.position.x += velocity.current.x * dt;
    g.position.y += velocity.current.y * dt;
    g.position.z += velocity.current.z * dt;

    const groundY = locked ? 0.25 : 0.75;
    if (g.position.y <= groundY) {
      g.position.y = groundY;
      velocity.current.y = 0;
      grounded.current = true;
    }
    apiRef.current.grounded = grounded.current;

    // Map boundary in open world (race scene clamps separately)
    if (world.mode === "open") {
      if (g.position.x > MAP_BOUND) { g.position.x = MAP_BOUND; velocity.current.x = Math.min(0, velocity.current.x); }
      if (g.position.x < -MAP_BOUND) { g.position.x = -MAP_BOUND; velocity.current.x = Math.max(0, velocity.current.x); }
      if (g.position.z > MAP_BOUND) { g.position.z = MAP_BOUND; velocity.current.z = Math.min(0, velocity.current.z); }
      if (g.position.z < -MAP_BOUND) { g.position.z = -MAP_BOUND; velocity.current.z = Math.max(0, velocity.current.z); }
    }

    // Animation: gait, body bob, head sway, tail wag.
    const gaitSpeed = mag > 0.1 ? (dashing ? 16 : 9) : 2;
    phase.current += dt * gaitSpeed;
    const p = phase.current;
    const swing = mag > 0.1 ? (dashing ? 0.9 : 0.6) : 0.05;

    if (legFL.current && legFR.current && legBL.current && legBR.current) {
      legFL.current.rotation.x = Math.sin(p) * swing;
      legBR.current.rotation.x = Math.sin(p) * swing;
      legFR.current.rotation.x = Math.sin(p + Math.PI) * swing;
      legBL.current.rotation.x = Math.sin(p + Math.PI) * swing;
    }
    if (body.current) {
      body.current.position.y = Math.abs(Math.sin(p * 2)) * 0.06 * mag;
      body.current.rotation.z = Math.sin(p) * 0.04 * mag;
    }
    if (head.current) {
      head.current.rotation.y = Math.sin(p * 0.5) * 0.1 * mag;
      head.current.rotation.x = dashing ? -0.25 : -0.05;
    }
    if (tail.current) {
      tail.current.rotation.y = Math.sin(p * 1.5) * 0.6;
      tail.current.rotation.x = 0.4 + Math.sin(p) * 0.2;
    }
  });

  return (
    <group ref={group} position={[BUFFALO_START_X, 0.75, BUFFALO_START_Z]} rotation={[0, BUFFALO_START_YAW, 0]}>
      <group ref={body}>
        {/* Belly/body — chunky cartoon barrel */}
        <mesh castShadow receiveShadow position={[0, 0.2, 0]}>
          <sphereGeometry args={[0.95, 24, 18]} />
          <meshStandardMaterial color={furDark} roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 0.05, 0]} scale={[1.05, 0.75, 1.45]}>
          <sphereGeometry args={[0.9, 24, 18]} />
          <meshStandardMaterial color={furDark} roughness={0.95} />
        </mesh>
        {/* Shoulder hump */}
        <mesh castShadow position={[0, 0.65, 0.4]} scale={[0.9, 0.7, 0.9]}>
          <sphereGeometry args={[0.55, 16, 12]} />
          <meshStandardMaterial color={furLight} roughness={0.95} />
        </mesh>

        {/* Head group */}
        <group ref={head} position={[0, 0.45, 1.05]}>
          <mesh castShadow scale={[0.95, 0.9, 1.05]}>
            <sphereGeometry args={[0.55, 20, 16]} />
            <meshStandardMaterial color={furDark} roughness={0.95} />
          </mesh>
          {/* Snout */}
          <mesh castShadow position={[0, -0.18, 0.5]} scale={[0.85, 0.7, 0.8]}>
            <sphereGeometry args={[0.38, 18, 14]} />
            <meshStandardMaterial color={snout} roughness={0.8} />
          </mesh>
          {/* Nostrils */}
          <mesh position={[-0.12, -0.18, 0.82]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#000" />
          </mesh>
          <mesh position={[0.12, -0.18, 0.82]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#000" />
          </mesh>
          {/* Eyes — cartoon big whites + pupils */}
          <mesh position={[-0.28, 0.18, 0.42]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.28, 0.18, 0.42]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[-0.28, 0.18, 0.52]}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshStandardMaterial color="#000" />
          </mesh>
          <mesh position={[0.28, 0.18, 0.52]}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshStandardMaterial color="#000" />
          </mesh>
          {/* Ears */}
          <mesh castShadow position={[-0.55, 0.3, -0.05]} rotation={[0, 0, -0.6]} scale={[0.5, 0.25, 0.3]}>
            <sphereGeometry args={[0.3, 12, 10]} />
            <meshStandardMaterial color={furLight} />
          </mesh>
          <mesh castShadow position={[0.55, 0.3, -0.05]} rotation={[0, 0, 0.6]} scale={[0.5, 0.25, 0.3]}>
            <sphereGeometry args={[0.3, 12, 10]} />
            <meshStandardMaterial color={furLight} />
          </mesh>
          {/* Curved cartoon horns */}
          <group position={[-0.4, 0.45, 0.05]} rotation={[0.1, 0, 0.4]}>
            <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.32, 0.07, 10, 16, Math.PI]} />
              <meshStandardMaterial color={horn} roughness={0.4} />
            </mesh>
          </group>
          <group position={[0.4, 0.45, 0.05]} rotation={[0.1, 0, -0.4]}>
            <mesh castShadow rotation={[0, Math.PI, Math.PI / 2]}>
              <torusGeometry args={[0.32, 0.07, 10, 16, Math.PI]} />
              <meshStandardMaterial color={horn} roughness={0.4} />
            </mesh>
          </group>
          {/* Forehead tuft */}
          <mesh castShadow position={[0, 0.45, 0.25]} scale={[0.6, 0.3, 0.5]}>
            <sphereGeometry args={[0.25, 12, 10]} />
            <meshStandardMaterial color="#2a1810" />
          </mesh>
        </group>

        {/* Legs (pivot at hip, leg hangs down) */}
        {[
          { ref: legFL, x: -0.45, z: 0.55 },
          { ref: legFR, x: 0.45, z: 0.55 },
          { ref: legBL, x: -0.45, z: -0.55 },
          { ref: legBR, x: 0.45, z: -0.55 },
        ].map((l, i) => (
          <group key={i} ref={l.ref} position={[l.x, -0.1, l.z]}>
            <mesh castShadow position={[0, -0.4, 0]}>
              <cylinderGeometry args={[0.16, 0.18, 0.75, 10]} />
              <meshStandardMaterial color={furDark} roughness={0.95} />
            </mesh>
            <mesh castShadow position={[0, -0.82, 0.02]}>
              <cylinderGeometry args={[0.19, 0.19, 0.12, 10]} />
              <meshStandardMaterial color={hoof} roughness={0.7} />
            </mesh>
          </group>
        ))}

        {/* Tail */}
        <group ref={tail} position={[0, 0.3, -0.95]}>
          <mesh castShadow position={[0, -0.25, -0.1]} rotation={[0.6, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.09, 0.6, 8]} />
            <meshStandardMaterial color={furDark} />
          </mesh>
          <mesh castShadow position={[0, -0.5, -0.35]}>
            <sphereGeometry args={[0.13, 10, 10]} />
            <meshStandardMaterial color="#1a0e08" />
          </mesh>
        </group>
      </group>
    </group>
  );
}
