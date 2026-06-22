import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { findSkin, type Skin } from "./skins";

type Props = { onDone: () => void };

// Scene timings (seconds, cumulative)
const SCENES = [
  { id: 0, until: 3.8, label: "A rainy highway at dawn..." },
  { id: 1, until: 6.6, label: "A tractor swerves into the lane!" },
  { id: 2, until: 8.8, label: "CRASH!" },
  { id: 3, until: 12.4, label: "The wounded trucker drags himself to the cage..." },
  { id: 4, until: 17.0, label: "" },
  { id: 5, until: 21.0, label: "" },
  { id: 6, until: 24.0, label: "" },
];

// Narration spoken at the start of each scene (browser SpeechSynthesis).
const NARRATION: Record<number, string> = {
  0: "On a quiet, rainy highway at dawn, a kind trucker drives home.",
  1: "Out of the rain, a tractor swerves into his lane.",
  2: "Crash!",
  3: "Wounded, he drags himself to the cage.",
  4: "Run free, buddy. Don't let them hurt you.",
  5: "Tell my wife and son... that I love them.",
  6: "Rest in peace, kind trucker.",
};
const TOTAL = SCENES[SCENES.length - 1].until;

export function CinematicIntro({ onDone }: Props) {
  const [t, setT] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      setT(elapsed);
      if (elapsed >= TOTAL && !doneRef.current) {
        doneRef.current = true;
        onDone();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  const scene = SCENES.find((s) => t < s.until)?.id ?? SCENES.length - 1;
  const skin = findSkin("classic");

  // Voiceover: speak each scene's narration line when the scene changes.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const text = NARRATION[scene];
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 0.9;
      u.volume = 1;
      // Prefer a deeper English voice when available.
      const voices = window.speechSynthesis.getVoices();
      const pick =
        voices.find((v) => /en[-_]?(US|GB)/i.test(v.lang) && /male|daniel|fred|alex/i.test(v.name)) ??
        voices.find((v) => v.lang?.startsWith("en"));
      if (pick) u.voice = pick;
      window.speechSynthesis.speak(u);
    } catch {
      // Speech synthesis blocked in some embedded previews; silent fallback.
    }
  }, [scene]);

  // Stop any narration if the user skips or the cinematic unmounts.
  useEffect(() => {
    return () => {
      try { window.speechSynthesis?.cancel(); } catch { /* */ }
    };
  }, []);

  // Speech bubble visibility / text per scene
  const bubble =
    scene === 4
      ? "💭 Go home, buddy... don't let them k*ll you."
      : scene === 5
        ? "💭 Tell my wife and son... that I love them."
        : null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black text-white select-none">
      <Canvas
        shadows
        camera={{ position: [0, 4, 14], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#3b4450"]} />
        <fog attach="fog" args={["#3b4450", 18, 55]} />
        <Suspense fallback={null}>
          <Scene t={t} scene={scene} skin={skin} />
        </Suspense>
      </Canvas>

      {/* White flash overlay during crash */}
      {scene === 2 && (
        <div
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ animation: "whiteFlash 0.6s ease-out forwards" }}
        />
      )}

      {/* Fade to black at end */}
      {scene === 6 && (
        <div
          className="pointer-events-none absolute inset-0 bg-black"
          style={{ animation: "fadeIn 2s ease-in forwards" }}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <div className="text-6xl">🕯️</div>
            <div className="mt-3 text-2xl font-extrabold tracking-wide text-amber-200">
              In memory of a kind trucker
            </div>
            <div className="mt-1 text-sm italic opacity-80">"Run free, buddy."</div>
          </div>
        </div>
      )}

      {/* Speech bubble */}
      {bubble && (
        <div
          key={scene}
          className="pointer-events-none absolute left-1/2 top-[22%] z-10 max-w-[80%] -translate-x-1/2 rounded-2xl bg-white px-5 py-3 text-center text-sm font-semibold text-black shadow-2xl sm:text-base"
          style={{ animation: "bubblePop 0.5s ease-out both" }}
        >
          {bubble}
          <div
            className="absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2"
            style={{
              borderLeft: "8px solid transparent",
              borderRight: "8px solid transparent",
              borderTop: "10px solid white",
            }}
          />
        </div>
      )}

      {/* Letterbox bars */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[10%] bg-black" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[10%] bg-black" />

      {/* Caption */}
      {SCENES[scene]?.label && (
        <div className="absolute left-1/2 top-[12%] -translate-x-1/2 rounded bg-black/60 px-4 py-1 text-xs italic tracking-wide text-amber-100 backdrop-blur-sm sm:text-sm">
          {SCENES[scene].label}
        </div>
      )}

      {/* Skip button */}
      <button
        onClick={() => {
          if (doneRef.current) return;
          doneRef.current = true;
          onDone();
        }}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/15 px-4 py-1.5 text-xs font-bold text-white backdrop-blur hover:bg-white/25"
      >
        Skip ▶
      </button>

      {/* Progress */}
      <div className="absolute bottom-1 left-0 right-0 h-0.5 bg-white/10">
        <div
          className="h-full bg-amber-400"
          style={{ width: `${Math.min(100, (t / TOTAL) * 100)}%` }}
        />
      </div>

      <style>{`
        @keyframes whiteFlash { 0% { opacity: 0.95; } 100% { opacity: 0; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bubblePop { 0% { transform: translateX(-50%) scale(0); opacity: 0; } 60% { transform: translateX(-50%) scale(1.1); opacity: 1; } 100% { transform: translateX(-50%) scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

/* ============================================================
   3D Scene — choreography
   ============================================================ */

function Scene({ t, scene, skin }: { t: number; scene: number; skin: Skin }) {
  // Overcast rainy sky throughout; brief red flash on crash.
  const skyColor = useMemo(() => {
    if (scene === 2) return new THREE.Color("#5a2a2a");
    return new THREE.Color("#4b5563");
  }, [scene]);

  const sunColor = scene === 2 ? "#ff8060" : "#aab4c0";
  const sunIntensity = scene === 2 ? 1.8 : 0.7;

  return (
    <>
      <ambientLight intensity={scene === 2 ? 0.55 : 0.75} color="#c4ccd6" />
      <directionalLight
        position={[8, 12, 6]}
        intensity={sunIntensity}
        color={sunColor}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={[skyColor, "#1c2229", 0.55]} />

      <Sky color={skyColor} />
      <Road />
      <Rain />
      <Camera t={t} scene={scene} />

      <Truck t={t} scene={scene} />
      <Tractor t={t} scene={scene} />
      <Trucker t={t} scene={scene} />
      <CinematicBuffalo t={t} scene={scene} skin={skin} />

      {scene >= 2 && <CrashParticles t={t} scene={scene} />}
      {scene === 2 && <CrashBurst />}
    </>
  );
}

/* Animated rain — vertical streaks falling and re-wrapping above the camera. */
function Rain() {
  const ref = useRef<THREE.Points>(null!);
  const COUNT = 900;
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      speeds[i] = 0.45 + Math.random() * 0.5;
    }
    return { positions, speeds };
  }, []);
  useFrame((_, delta) => {
    const p = ref.current;
    if (!p) return;
    const arr = (p.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] -= speeds[i] * delta * 38;
      if (arr[i * 3 + 1] < 0.1) {
        arr[i * 3 + 1] = 26 + Math.random() * 6;
        arr[i * 3 + 0] = (Math.random() - 0.5) * 60;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
      }
    }
    (p.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color="#c8d4e0" size={0.08} transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

function Sky({ color }: { color: THREE.Color }) {
  return (
    <mesh>
      <sphereGeometry args={[120, 16, 12]} />
      <meshBasicMaterial color={color} side={THREE.BackSide} />
    </mesh>
  );
}

function Road() {
  // long asphalt strip + side dirt
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#2a2418" roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[300, 8]} />
        <meshStandardMaterial color="#15171a" roughness={0.35} metalness={0.2} />
      </mesh>
      {/* dashed center line */}
      {Array.from({ length: 30 }).map((_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[-60 + i * 4, 0.04, 0]}
        >
          <planeGeometry args={[2, 0.22]} />
          <meshBasicMaterial color="#f4c430" />
        </mesh>
      ))}
      {/* edge lines */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.04, s * 3.8]}
        >
          <planeGeometry args={[300, 0.2]} />
          <meshBasicMaterial color="#f1f1f1" />
        </mesh>
      ))}
    </group>
  );
}

function Camera({ t, scene }: { t: number; scene: number }) {
  const { camera } = useThree();
  useFrame(() => {
    // Per-scene camera framing
    let target = new THREE.Vector3(0, 1.5, 0);
    let pos = new THREE.Vector3(0, 4, 14);

    if (scene === 0) {
      // wide tracking shot from the side, gently dollying
      const k = t / 3.5;
      pos.set(-8 - k * 2, 3.5, 8);
      target.set(0, 1.5, 0);
    } else if (scene === 1) {
      // front-3/4 of truck, tractor closing from left
      pos.set(6, 3, 9);
      target.set(0, 1.2, 0);
    } else if (scene === 2) {
      // shaky close-up of crash
      const shake = Math.sin(t * 60) * 0.15;
      pos.set(4 + shake, 3.2, 7 + shake);
      target.set(0, 1.5, 0);
    } else if (scene === 3) {
      // over-the-shoulder of trucker walking to cage
      pos.set(8, 2.6, 6);
      target.set(2, 1.2, 0);
    } else if (scene === 4) {
      // wide reveal: buffalo escaping, trucker by truck
      pos.set(6, 3, 11);
      target.set(-2, 1.2, 0);
    } else if (scene === 5) {
      // close on trucker collapsing
      pos.set(5, 2.2, 5);
      target.set(2.5, 1.0, 0);
    } else {
      pos.set(0, 3, 10);
      target.set(0, 1.2, 0);
    }
    camera.position.lerp(pos, 0.08);
    const cur = new THREE.Vector3();
    camera.getWorldDirection(cur);
    camera.lookAt(target);
  });
  return null;
}

/* ============================================================
   Truck (cab + cage trailer)
   ============================================================ */

function Truck({ t, scene }: { t: number; scene: number }) {
  const ref = useRef<THREE.Group>(null!);
  const fireRef = useRef<THREE.Group>(null!);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    let x = 0;
    let rotZ = 0;
    let rotY = 0;
    if (scene === 0) {
      // cruising along +X, moving left across screen
      x = 10 - (t / 3.5) * 14;
    } else if (scene === 1) {
      x = -2 + Math.sin(t * 20) * 0.05;
    } else if (scene >= 2) {
      // after crash: skewed and stopped
      x = -1.5;
      rotY = -0.25;
      rotZ = 0.05;
      if (scene === 2) {
        const shake = Math.sin(t * 80) * 0.08;
        x += shake;
      }
    }
    g.position.x = x;
    g.rotation.y = rotY;
    g.rotation.z = rotZ;

    if (fireRef.current) {
      fireRef.current.visible = scene >= 2;
      fireRef.current.children.forEach((c, i) => {
        const s = 0.8 + Math.sin(t * 8 + i) * 0.25;
        c.scale.setScalar(s);
      });
    }
  });
  const cageOpen = scene >= 4;
  return (
    <group ref={ref} position={[0, 0, 0]}>
      {/* trailer (cage) */}
      <group position={[-1.6, 0.9, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[3.6, 1.8, 2]} />
          <meshStandardMaterial color="#6b6b6b" roughness={0.8} />
        </mesh>
        {/* cage bars */}
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh
            key={i}
            position={[-1.6 + i * 0.64, 0, 1.01]}
            castShadow
          >
            <boxGeometry args={[0.08, 1.6, 0.06]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        ))}
        {/* back door (open after rescue) */}
        <mesh
          position={[1.85, 0, cageOpen ? 0.7 : 0]}
          rotation={[0, cageOpen ? -1.1 : 0, 0]}
          castShadow
        >
          <boxGeometry args={[0.08, 1.8, 2]} />
          <meshStandardMaterial color="#555" roughness={0.85} />
        </mesh>
      </group>
      {/* cab */}
      <group position={[1.4, 0.85, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.6, 1.7, 2]} />
          <meshStandardMaterial color="#1d4ed8" roughness={0.6} metalness={0.3} />
        </mesh>
        {/* windshield */}
        <mesh position={[0.81, 0.3, 0]}>
          <boxGeometry args={[0.02, 0.7, 1.6]} />
          <meshStandardMaterial color="#a0d4ff" metalness={0.5} roughness={0.2} />
        </mesh>
        {/* hood */}
        <mesh castShadow position={[1.1, -0.35, 0]}>
          <boxGeometry args={[0.8, 1.0, 1.9]} />
          <meshStandardMaterial color="#1d4ed8" roughness={0.6} metalness={0.3} />
        </mesh>
      </group>
      {/* wheels */}
      {[
        [-2.5, 0.35, 0.95],
        [-2.5, 0.35, -0.95],
        [-0.5, 0.35, 0.95],
        [-0.5, 0.35, -0.95],
        [1.6, 0.35, 0.95],
        [1.6, 0.35, -0.95],
      ].map((p, i) => (
        <mesh
          key={i}
          position={p as [number, number, number]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.35, 0.35, 0.3, 16]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      {/* fire on cab */}
      <group ref={fireRef} position={[1.4, 2.0, 0]} visible={false}>
        <mesh position={[0, 0, 0]}>
          <coneGeometry args={[0.4, 1.0, 8]} />
          <meshBasicMaterial color="#ff8800" />
        </mesh>
        <mesh position={[0.3, 0.2, 0.2]}>
          <coneGeometry args={[0.25, 0.8, 8]} />
          <meshBasicMaterial color="#ffd24a" />
        </mesh>
        <mesh position={[-0.3, 0.1, -0.2]}>
          <coneGeometry args={[0.2, 0.6, 8]} />
          <meshBasicMaterial color="#ff5522" />
        </mesh>
        <pointLight color="#ff8030" intensity={3} distance={10} />
      </group>
    </group>
  );
}

/* ============================================================
   Tractor — same red look as gameplay
   ============================================================ */

function Tractor({ t, scene }: { t: number; scene: number }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (scene === 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (scene === 1) {
      // swerves in from far +X behind the truck and crosses lane
      const k = Math.min(1, (t - 3.5) / 3.0);
      g.position.set(12 - k * 14, 0.8, -3 + k * 3);
      g.rotation.y = Math.PI + k * 0.6;
    } else {
      // wrecked, tilted, just past the truck
      g.position.set(2.5, 0.7, -1);
      g.rotation.set(0.4, Math.PI - 0.3, -0.3);
    }
  });
  return (
    <group ref={ref} position={[12, 0.8, -3]}>
      <mesh castShadow>
        <boxGeometry args={[1.6, 1.0, 2.4]} />
        <meshStandardMaterial color="#c0392b" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh castShadow position={[0, 0.7, -0.2]}>
        <boxGeometry args={[1.2, 0.8, 1.0]} />
        <meshStandardMaterial color="#922b21" roughness={0.4} metalness={0.4} />
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
    </group>
  );
}

/* ============================================================
   Trucker — simple humanoid (capsule body, sphere head)
   ============================================================ */

function Trucker({ t, scene }: { t: number; scene: number }) {
  const ref = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (scene < 3) {
      g.visible = false;
      return;
    }
    g.visible = true;
    let x = 1.2;
    let z = 1.5;
    let lean = 0;
    let fall = 0;
    if (scene === 3) {
      // limp walking from cab toward back of truck
      const k = Math.min(1, (t - 9.2) / 3.4);
      x = 1.4 - k * 3.0;
      z = 1.4 - k * 0.4;
      lean = 0.35 + Math.sin(t * 4) * 0.08;
      const swing = Math.sin(t * 6) * 0.4;
      if (legL.current) legL.current.rotation.x = swing;
      if (legR.current) legR.current.rotation.x = -swing;
    } else if (scene === 4) {
      x = -1.6;
      z = 1.0;
      lean = 0.3;
    } else if (scene === 5) {
      x = -1.6;
      z = 1.0;
      const k = Math.min(1, (t - 17.5) / 3.8);
      lean = 0.3 + k * 1.2;
      fall = k * 0.8;
    } else {
      g.visible = false;
    }
    g.position.set(x, 0.9 - fall, z);
    g.rotation.z = lean;
    g.rotation.y = Math.PI / 2;
  });
  return (
    <group ref={ref}>
      {/* body */}
      <mesh castShadow position={[0, 0, 0]}>
        <capsuleGeometry args={[0.28, 0.7, 6, 12]} />
        <meshStandardMaterial color="#7a3b1a" roughness={0.9} />
      </mesh>
      {/* head */}
      <mesh castShadow position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.26, 16, 12]} />
        <meshStandardMaterial color="#e0b48a" roughness={0.8} />
      </mesh>
      {/* cap */}
      <mesh castShadow position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.16, 16]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[0.2, 1.0, 0]} rotation={[0, 0, -0.3]}>
        <boxGeometry args={[0.3, 0.05, 0.4]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {/* arms */}
      <mesh castShadow position={[0, 0.1, 0.35]} rotation={[0.6, 0, 0]}>
        <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
        <meshStandardMaterial color="#e0b48a" />
      </mesh>
      <mesh castShadow position={[0, 0.1, -0.35]} rotation={[-0.4, 0, 0]}>
        <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
        <meshStandardMaterial color="#e0b48a" />
      </mesh>
      {/* legs */}
      <group ref={legL} position={[0, -0.55, 0.15]}>
        <mesh castShadow position={[0, -0.25, 0]}>
          <capsuleGeometry args={[0.11, 0.4, 4, 8]} />
          <meshStandardMaterial color="#2a2218" />
        </mesh>
      </group>
      <group ref={legR} position={[0, -0.55, -0.15]}>
        <mesh castShadow position={[0, -0.25, 0]}>
          <capsuleGeometry args={[0.11, 0.4, 4, 8]} />
          <meshStandardMaterial color="#2a2218" />
        </mesh>
      </group>
    </group>
  );
}

/* ============================================================
   Cinematic Buffalo — passive version of the in-game buffalo
   ============================================================ */

function CinematicBuffalo({ t, scene, skin }: { t: number; scene: number; skin: Skin }) {
  const ref = useRef<THREE.Group>(null!);
  const legFL = useRef<THREE.Group>(null!);
  const legFR = useRef<THREE.Group>(null!);
  const legBL = useRef<THREE.Group>(null!);
  const legBR = useRef<THREE.Group>(null!);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (scene < 4) {
      g.visible = false;
      return;
    }
    g.visible = true;
    let x = -2;
    let z = 0.5;
    let ry = -Math.PI / 2;
    let gait = 0;
    if (scene === 4) {
      // gallops out from the back of the cage toward camera-left
      const k = Math.min(1, (t - 12.8) / 4.5);
      x = -2 - k * 8;
      z = 0.5 - k * 0.5;
      ry = -Math.PI / 2 + k * 0.2;
      gait = t * 10;
    } else if (scene === 5) {
      x = -10;
      z = 0;
      gait = t * 6;
    } else {
      x = -14;
      z = 0;
    }
    g.position.set(x, 0.75, z);
    g.rotation.y = ry;
    const swing = scene === 4 ? 0.9 : 0.3;
    if (legFL.current) legFL.current.rotation.x = Math.sin(gait) * swing;
    if (legBR.current) legBR.current.rotation.x = Math.sin(gait) * swing;
    if (legFR.current) legFR.current.rotation.x = Math.sin(gait + Math.PI) * swing;
    if (legBL.current) legBL.current.rotation.x = Math.sin(gait + Math.PI) * swing;
  });
  const dark = useMemo(() => new THREE.Color(skin.dark), [skin.dark]);
  const light = useMemo(() => new THREE.Color(skin.light), [skin.light]);
  const horn = useMemo(() => new THREE.Color(skin.hornColor ?? "#f4e6c8"), [skin.hornColor]);
  return (
    <group ref={ref} visible={false}>
      {/* body */}
      <mesh castShadow position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.95, 20, 14]} />
        <meshStandardMaterial color={dark} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 0.05, 0]} scale={[1.05, 0.75, 1.45]}>
        <sphereGeometry args={[0.9, 20, 14]} />
        <meshStandardMaterial color={dark} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 0.65, 0.4]} scale={[0.9, 0.7, 0.9]}>
        <sphereGeometry args={[0.55, 14, 10]} />
        <meshStandardMaterial color={light} roughness={0.95} />
      </mesh>
      {/* head */}
      <group position={[0, 0.45, 1.05]}>
        <mesh castShadow scale={[0.95, 0.9, 1.05]}>
          <sphereGeometry args={[0.55, 16, 12]} />
          <meshStandardMaterial color={dark} />
        </mesh>
        <mesh castShadow position={[0, -0.18, 0.5]} scale={[0.85, 0.7, 0.8]}>
          <sphereGeometry args={[0.38, 14, 10]} />
          <meshStandardMaterial color="#8a6450" />
        </mesh>
        {/* horns */}
        <group position={[-0.4, 0.45, 0.05]} rotation={[0.1, 0, 0.4]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.32, 0.07, 8, 12, Math.PI]} />
            <meshStandardMaterial color={horn} />
          </mesh>
        </group>
        <group position={[0.4, 0.45, 0.05]} rotation={[0.1, 0, -0.4]}>
          <mesh castShadow rotation={[0, Math.PI, Math.PI / 2]}>
            <torusGeometry args={[0.32, 0.07, 8, 12, Math.PI]} />
            <meshStandardMaterial color={horn} />
          </mesh>
        </group>
        {/* eyes */}
        <mesh position={[-0.28, 0.18, 0.5]}>
          <sphereGeometry args={[0.1, 10, 8]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
        <mesh position={[0.28, 0.18, 0.5]}>
          <sphereGeometry args={[0.1, 10, 8]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
      </group>
      {/* legs */}
      {[
        { ref: legFL, x: -0.45, z: 0.55 },
        { ref: legFR, x: 0.45, z: 0.55 },
        { ref: legBL, x: -0.45, z: -0.55 },
        { ref: legBR, x: 0.45, z: -0.55 },
      ].map((l, i) => (
        <group key={i} ref={l.ref} position={[l.x, -0.1, l.z]}>
          <mesh castShadow position={[0, -0.4, 0]}>
            <cylinderGeometry args={[0.16, 0.18, 0.75, 8]} />
            <meshStandardMaterial color={dark} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ============================================================
   Crash effects
   ============================================================ */

function CrashBurst() {
  return (
    <group position={[1, 2, 0]}>
      <pointLight color="#ffd24a" intensity={6} distance={20} />
      <mesh>
        <sphereGeometry args={[1.2, 12, 10]} />
        <meshBasicMaterial color="#ffd24a" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function CrashParticles({ t, scene }: { t: number; scene: number }) {
  // simple drifting smoke puffs
  const puffs = useMemo(
    () =>
      Array.from({ length: 10 }).map((_, i) => ({
        x: 1 + (Math.random() - 0.5) * 2,
        z: (Math.random() - 0.5) * 2,
        seed: i,
      })),
    [],
  );
  const t0 = scene >= 2 ? Math.max(0, t - 6.8) : 0;
  return (
    <group>
      {puffs.map((p) => {
        const k = (t0 * 0.4 + p.seed * 0.1) % 4;
        return (
          <mesh
            key={p.seed}
            position={[p.x, 1.5 + k * 0.6, p.z + Math.sin(t + p.seed) * 0.2]}
          >
            <sphereGeometry args={[0.4 + k * 0.15, 8, 6]} />
            <meshBasicMaterial
              color="#3a3a3a"
              transparent
              opacity={Math.max(0, 0.6 - k * 0.15)}
            />
          </mesh>
        );
      })}
    </group>
  );
}
