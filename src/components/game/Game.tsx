import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import * as THREE from "three";
import { Buffalo, type BuffaloHandle } from "./Buffalo";
import { FollowCamera } from "./FollowCamera";
import {
  Ground,
  Crops,
  Machinery,
  Trees,
  Mountains,
  Clouds,
  GrassTufts,
  Township,
  Countryside,
} from "./Environment";
import { Joystick, type JoystickVec } from "./Joystick";
import { input, stats, subscribeStats, subscribeEvents, player, subscribePlayer, buySkin, equipSkin, triggerAttack } from "./gameState";
import { level, startLevelSystem, subscribeLevel } from "./level";
import { missionTracker, MISSIONS } from "./missions";
import { Villagers } from "./Villagers";
import { AudioListener } from "./AudioListener";
import { audio } from "./audio";
import { SKINS, findSkin } from "./skins";

export function Game() {
  const buffaloRef = useRef<BuffaloHandle>({
    group: null,
    velocity: new THREE.Vector3(),
    grounded: true,
  });

  const [, force] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [punishToast, setPunishToast] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const [storeOpen, setStoreOpen] = useState(false);

  useEffect(() => {
    startLevelSystem();
    const unsubL = subscribeLevel(() => force((n) => n + 1));
    const unsubP = subscribePlayer(() => force((n) => n + 1));
    const unsub = subscribeStats(() => force((n) => n + 1));
    
    missionTracker.start();
    let prevDone = 0;
    const unsubM = missionTracker.subscribe((_cur, completed) => {
      if (completed.length > prevDone) {
        const just = completed[completed.length - 1];
        prevDone = completed.length;
        setToast(`✅ ${just.title} complete! ${just.reward}`);
        setTimeout(() => setToast(null), 3500);
      }
      force((n) => n + 1);
    });
    const unsubE = subscribeEvents((e) => {
      if (e.type === "punish") {
        setPunishToast(e.message);
        setFlash(e.severity === "major");
        setTimeout(() => setPunishToast(null), 1800);
        if (e.severity === "major") setTimeout(() => setFlash(false), 250);
      }
    });
    return () => {
      unsub();
      unsubM();
      
      unsubE();
      unsubP();
      unsubL();
      missionTracker.stop();
    };
  }, []);

  useEffect(() => {
    audio.startMusic();
    return () => { audio.stopMusic(); };
  }, []);

  const handleJoystick = useCallback((v: JoystickVec) => {
    input.move.x = v.x;
    input.move.y = v.y;
  }, []);

  const onJump = useCallback(() => {
    input.jumpQueued = true;
  }, []);

  const onAttack = useCallback(() => {
    triggerAttack();
  }, []);

  const [dashCooldown, setDashCooldown] = useState(0);
  const [showRotate, setShowRotate] = useState(true);
  const onDash = useCallback(() => {
    if (performance.now() / 1000 < dashCooldown) return;
    const now = performance.now() / 1000;
    input.dashUntil = now + 1.2;
    setDashCooldown(now + 4);
  }, [dashCooldown]);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  const now = performance.now() / 1000;
  const dashing = now < input.dashUntil;
  const cdLeft = Math.max(0, dashCooldown - now);

  return (
    <div className="fixed inset-0 overflow-hidden bg-sky-300 select-none landscape-game">
      <Canvas
        camera={{ fov: 60, near: 0.1, far: 500, position: [0, 6, -10] }}
        dpr={[1, 1.25]}
        gl={{ powerPreference: "high-performance", antialias: false }}
      >
        <Sky sunPosition={[100, 50, 100]} turbidity={3} rayleigh={1.2} mieCoefficient={0.005} mieDirectionalG={0.8} />
        <ambientLight intensity={0.65} color="#fff5e0" />
        <hemisphereLight args={["#bfe3ff", "#5a4a2a", 0.45]} />
        <directionalLight position={[40, 60, 20]} intensity={1.6} color="#fff1d0" />
        <fog attach="fog" args={["#dbeaf2", 120, 480]} />

        <Mountains />
        <Clouds />

        <Ground />
        <GrassTufts />
        <Countryside />
        <Trees buffaloRef={buffaloRef} />
        <Township buffaloRef={buffaloRef} />
        <Crops buffaloRef={buffaloRef} />
        <Machinery buffaloRef={buffaloRef} />
        <Villagers buffaloRef={buffaloRef} />

        <Buffalo apiRef={buffaloRef} skin={findSkin(player.equippedSkin)} />
        <FollowCamera targetRef={buffaloRef} />
        <AudioListener buffaloRef={buffaloRef} />
      </Canvas>

      {showRotate && (
        <div className="rotate-phone-overlay absolute inset-0 items-center justify-center bg-emerald-950/80 px-8 text-center text-white backdrop-blur-sm">
          <div>
            <div className="text-5xl">↻</div>
            <div className="mt-3 text-lg font-extrabold">Rotate your phone</div>
            <div className="mt-1 text-sm opacity-80">Landscape gives the buffalo more room to run.</div>
            <button
              onClick={() => setShowRotate(false)}
              className="mt-5 rounded-full bg-red-600 px-6 py-2 text-sm font-bold shadow-lg active:scale-95"
            >
              Play in portrait
            </button>
          </div>
        </div>
      )}

      {/* === HUD === compact, hugs corners so the buffalo is never blocked === */}
      <div className="pointer-events-none absolute inset-0">
        {/* Top-left: title + stats */}
        <div className="absolute left-2 top-2 rounded-lg bg-black/45 px-2 py-1.5 text-white backdrop-blur-sm text-[10px] leading-tight">
          <div className="font-bold">🐃 Paddy Menace</div>
          <div className="opacity-80">Crops {stats.cropsTrampled} · Wreck {stats.destroyed} · Race {stats.racesWon}</div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className={stats.karma < 30 ? "text-red-300 font-bold" : stats.karma < 60 ? "text-yellow-300" : "text-emerald-300"}>
              ❤ Karma {stats.karma}
            </span>
            <span className="opacity-60">· Hits {stats.npcsHit}</span>
          </div>
          <div className="mt-0.5 font-bold text-yellow-300">🪙 {player.coins}</div>
        </div>

        {/* Store button */}
        <button
          onClick={() => setStoreOpen(true)}
          className="pointer-events-auto absolute left-2 top-[68px] rounded-full bg-yellow-500 px-3 py-1 text-[11px] font-bold text-black shadow active:scale-95"
        >
          🛍️ Skin Store
        </button>


        {/* Top-right: compact mission */}
        {(() => {
          const cur = missionTracker.current();
          const done = missionTracker.completed.length;
          if (!cur) {
            return (
              <div className="absolute right-2 top-2 rounded-lg bg-yellow-500/90 px-2 py-1 text-[10px] font-bold text-black shadow">
                👑 All missions done
              </div>
            );
          }
          const prog = Math.min(cur.getProgress(), cur.goal);
          const pct = (prog / cur.goal) * 100;
          return (
            <div className="absolute right-2 top-2 w-[140px] rounded-lg bg-black/55 px-2 py-1.5 text-white backdrop-blur-sm text-[10px] leading-tight">
              <div className="flex justify-between opacity-70">
                <span>M{done + 1}/{MISSIONS.length}</span>
                <span>{prog}/{cur.goal}</span>
              </div>
              <div className="font-bold truncate">{cur.title}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })()}

        {/* Level / Timer / Score HUD (top-center) */}
        {(() => {
          const pct = Math.min(100, (level.score / level.target) * 100);
          const low = level.timeLeft < 15;
          return (
            <div className="absolute left-1/2 top-2 -translate-x-1/2 w-[170px] rounded-lg bg-black/55 px-2 py-1 text-white backdrop-blur-sm text-[10px] leading-tight">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-yellow-300">LV {level.level}</span>
                <span className={low ? "font-bold text-red-300 animate-pulse" : "opacity-80"}>
                  ⏱ {Math.ceil(level.timeLeft)}s
                </span>
                {level.combo > 1 && (
                  <span className="font-bold text-orange-300">x{level.combo}</span>
                )}
              </div>
              <div className="flex items-center justify-between opacity-90">
                <span>Score {level.score}/{level.target}</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full bg-yellow-400" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })()}

        {toast && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow-xl">
            {toast}
          </div>
        )}

        {punishToast && (
          <div className="absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white shadow-xl animate-pulse">
            {punishToast}
          </div>
        )}

        {flash && (
          <div className="absolute inset-0 bg-red-500/40 pointer-events-none" />
        )}



        {/* Bottom-left: DPad */}
        <div className="absolute bottom-3 left-3">
          <Joystick onChange={handleJoystick} />
        </div>

        {/* Bottom-right: action buttons. */}
        <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2" style={{ touchAction: "none" }}>
          <button
            onPointerDown={(e) => { e.preventDefault(); if (cdLeft <= 0) onDash(); }}
            disabled={cdLeft > 0}
            className={`pointer-events-auto h-14 w-14 rounded-full font-bold text-white text-xs shadow-xl active:scale-95 transition touch-none select-none ${
              dashing ? "bg-yellow-500 ring-4 ring-yellow-300" : cdLeft > 0 ? "bg-gray-500/60" : "bg-red-600"
            }`}
            style={{ touchAction: "none" }}
          >
            {cdLeft > 0 && !dashing ? cdLeft.toFixed(1) : "RAM"}
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); onJump(); }}
            className="pointer-events-auto h-14 w-14 rounded-full bg-emerald-600 font-bold text-white text-xs shadow-xl active:scale-95 touch-none select-none"
            style={{ touchAction: "none" }}
          >
            JUMP
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); onAttack(); }}
            className="pointer-events-auto h-14 w-14 rounded-full bg-rose-700 font-bold text-white text-[11px] shadow-xl active:scale-95 touch-none select-none ring-2 ring-rose-300"
            style={{ touchAction: "none" }}
          >
            ATTACK
          </button>
        </div>


        {/* Skin Store */}
        {storeOpen && (
          <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/80 p-2 sm:p-4">
            <div className="flex max-h-[96vh] w-full max-w-sm flex-col rounded-2xl bg-emerald-950 p-3 text-white shadow-2xl landscape:max-w-2xl landscape:max-h-[94vh]">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-sm font-extrabold landscape:text-base">🛍️ Buffalo Skin Store</div>
                <div className="text-xs font-bold text-yellow-300 landscape:text-sm">🪙 {player.coins}</div>
              </div>
              <div className="mb-2 text-[10px] opacity-70 landscape:hidden">
                Earn coins by RAMming villagers/cars, wrecking machines, and winning races.
              </div>
              <div className="flex-1 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-2 landscape:grid-cols-4">
                  {SKINS.map((s) => {
                    const owned = player.ownedSkins.has(s.id);
                    const equipped = player.equippedSkin === s.id;
                    const canAfford = player.coins >= s.price;
                    return (
                      <div
                        key={s.id}
                        className={`rounded-xl p-2 text-center text-[11px] ${
                          equipped ? "bg-yellow-500/30 ring-2 ring-yellow-400" : "bg-black/40"
                        }`}
                      >
                        <div
                          className="mx-auto mb-1 h-10 w-10 rounded-full ring-2 ring-white/30 landscape:h-9 landscape:w-9"
                          style={{ background: `linear-gradient(135deg, ${s.dark}, ${s.light})` }}
                        />
                        <div className="font-bold truncate">{s.emoji} {s.name}</div>
                        <div className="opacity-70">{s.price === 0 ? "Free" : `🪙 ${s.price}`}</div>
                        {equipped ? (
                          <div className="mt-1 rounded-full bg-yellow-400 py-1 text-[10px] font-bold text-black">EQUIPPED</div>
                        ) : owned ? (
                          <button
                            onClick={() => equipSkin(s.id)}
                            className="mt-1 w-full rounded-full bg-emerald-500 py-1 text-[10px] font-bold text-black active:scale-95"
                          >
                            Equip
                          </button>
                        ) : (
                          <button
                            onClick={() => buySkin(s.id, s.price)}
                            disabled={!canAfford}
                            className={`mt-1 w-full rounded-full py-1 text-[10px] font-bold active:scale-95 ${
                              canAfford ? "bg-red-500 text-white" : "bg-gray-600 text-white/50"
                            }`}
                          >
                            {canAfford ? "Buy" : "Need 🪙"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => setStoreOpen(false)}
                className="mt-2 w-full rounded-full bg-white py-2 text-sm font-bold text-black"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
