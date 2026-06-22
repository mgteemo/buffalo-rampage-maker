// Level / Timer / Score system.
// Lightweight observer pattern (no React state inside the R3F loop).
import { stats, subscribeStats, addCoins, emitEvent, reportBest } from "./gameState";

export type LevelState = {
  level: number;
  score: number;        // accumulated rampage points this level
  target: number;       // points needed to clear the level
  timeLeft: number;     // seconds remaining
  duration: number;     // base duration for this level
  running: boolean;
  combo: number;
  comboUntil: number;   // performance.now() / 1000
};

export const level: LevelState = {
  level: 1,
  score: 0,
  target: 40,
  timeLeft: 90,
  duration: 90,
  running: true,
  combo: 0,
  comboUntil: 0,
};

const listeners = new Set<() => void>();
export function subscribeLevel(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function notify() { listeners.forEach((l) => l()); }

// Track stat deltas → rampage points.
let prev = { destroyed: 0, cropsTrampled: 0, npcsHit: 0, racesWon: 0 };

function bumpCombo() {
  const now = performance.now() / 1000;
  if (now < level.comboUntil) level.combo = Math.min(level.combo + 1, 20);
  else level.combo = 1;
  level.comboUntil = now + 4;
}

let started = false;
export function startLevelSystem() {
  if (started) return;
  started = true;
  prev = { ...prev, destroyed: stats.destroyed, cropsTrampled: stats.cropsTrampled, npcsHit: stats.npcsHit, racesWon: stats.racesWon };

  subscribeStats(() => {
    if (!level.running) return;
    let pts = 0;
    const dDestroyed = stats.destroyed - prev.destroyed;
    const dCrops = stats.cropsTrampled - prev.cropsTrampled;
    const dHits = stats.npcsHit - prev.npcsHit;
    const dRaces = stats.racesWon - prev.racesWon;
    if (dDestroyed > 0) { pts += dDestroyed * 6; bumpCombo(); }
    if (dHits > 0) { pts += dHits * 3; bumpCombo(); }
    if (dCrops > 0) { pts += dCrops * 1; }
    if (dRaces > 0) { pts += dRaces * 25; bumpCombo(); }
    if (pts > 0) {
      const multiplier = 1 + Math.max(0, level.combo - 1) * 0.1; // up to ~3x
      level.score += Math.round(pts * multiplier);
    }
    prev = {
      destroyed: stats.destroyed,
      cropsTrampled: stats.cropsTrampled,
      npcsHit: stats.npcsHit,
      racesWon: stats.racesWon,
    };
    notify();
  });

  // 4 Hz timer tick.
  setInterval(() => {
    const now = performance.now() / 1000;
    if (now > level.comboUntil) level.combo = 0;

    if (!level.running) { notify(); return; }
    level.timeLeft = Math.max(0, level.timeLeft - 0.25);

    if (level.score >= level.target) {
      // Level up!
      const bonus = 50 + level.level * 25;
      addCoins(bonus, `Level ${level.level} cleared!`);
      emitEvent({ type: "coin", message: `🏆 LEVEL ${level.level} CLEARED`, severity: "minor" });
      level.level += 1;
      level.score = 0;
      level.target = Math.round(level.target * 1.5);
      level.duration = Math.max(60, level.duration - 5);
      level.timeLeft = level.duration;
    } else if (level.timeLeft <= 0) {
      // Time up — restart the level (no penalty, but lose combo).
      emitEvent({ type: "punish", message: `⏱ Time up — Level ${level.level} restart`, severity: "minor" });
      level.score = 0;
      level.combo = 0;
      level.timeLeft = level.duration;
    }
    notify();
  }, 250);
}
