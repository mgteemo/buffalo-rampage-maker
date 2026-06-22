// Shared mutable input state to avoid React re-renders inside R3F loop.
export const input = {
  move: { x: 0, y: 0 },
  jumpQueued: false,
  dashQueued: false,
  dashUntil: 0,
  fightQueued: false,
  controlsLockedUntil: 0, // when player is stuck in a hole
  // Attack: increment attackId each press; attackUntil opens a short hit window.
  // Destructible objects consume each attack at most once by comparing attackId.
  attackId: 0,
  attackUntil: 0,
};

export function triggerAttack() {
  input.attackId++;
  input.attackUntil = performance.now() / 1000 + 0.35;
}

// Reach of the buffalo's swing — used by all destructible obstacles.
export const ATTACK_RANGE = 3.6;

export const stats = {
  destroyed: 0,
  cropsTrampled: 0,
  racesWon: 0,
  fightsWon: 0,
  npcsHit: 0,
  karma: 100,
};

// ----- Player progression: coins + skins + best records -----
const STORAGE_KEY = "buffalo-player-v1";
type PersistedPlayer = {
  coins: number;
  ownedSkins: string[];
  equippedSkin: string;
  bestLevel?: number;
  bestScore?: number;
};

const DEFAULTS: PersistedPlayer = {
  coins: 0,
  ownedSkins: ["classic"],
  equippedSkin: "classic",
  bestLevel: 1,
  bestScore: 0,
};

function loadPlayer(): PersistedPlayer {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as PersistedPlayer;
    if (!p.ownedSkins?.includes("classic")) p.ownedSkins = ["classic", ...(p.ownedSkins ?? [])];
    if (!p.equippedSkin) p.equippedSkin = "classic";
    if (typeof p.bestLevel !== "number") p.bestLevel = 1;
    if (typeof p.bestScore !== "number") p.bestScore = 0;
    return p;
  } catch {
    return { ...DEFAULTS };
  }
}

const persisted = loadPlayer();
export const player = {
  coins: persisted.coins,
  ownedSkins: new Set<string>(persisted.ownedSkins),
  equippedSkin: persisted.equippedSkin,
  bestLevel: persisted.bestLevel ?? 1,
  bestScore: persisted.bestScore ?? 0,
};

const playerListeners = new Set<() => void>();
export function subscribePlayer(l: () => void) {
  playerListeners.add(l);
  return () => playerListeners.delete(l);
}
function savePlayer() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        coins: player.coins,
        ownedSkins: Array.from(player.ownedSkins),
        equippedSkin: player.equippedSkin,
        bestLevel: player.bestLevel,
        bestScore: player.bestScore,
      } as PersistedPlayer),
    );
  } catch { /* */ }
}
function notifyPlayer() { playerListeners.forEach((l) => l()); }

export function reportBest(currentLevel: number, currentScore: number) {
  let changed = false;
  if (currentLevel > player.bestLevel) { player.bestLevel = currentLevel; changed = true; }
  if (currentScore > player.bestScore) { player.bestScore = currentScore; changed = true; }
  if (changed) { savePlayer(); notifyPlayer(); }
}

export function addCoins(n: number, reason?: string) {
  if (n <= 0) return;
  player.coins += n;
  savePlayer();
  notifyPlayer();
  if (reason) emitEvent({ type: "coin", message: `+${n} 🪙 ${reason}`, severity: "minor" });
}

export function buySkin(id: string, price: number): boolean {
  if (player.ownedSkins.has(id)) return true;
  if (player.coins < price) return false;
  player.coins -= price;
  player.ownedSkins.add(id);
  savePlayer();
  notifyPlayer();
  return true;
}

export function equipSkin(id: string) {
  if (!player.ownedSkins.has(id)) return;
  player.equippedSkin = id;
  savePlayer();
  notifyPlayer();
}

// Lightweight event bus for transient gameplay events (toasts, punishments).
type GameEvent = { type: "punish" | "coin"; message: string; severity: "minor" | "major" };
const eventListeners = new Set<(e: GameEvent) => void>();
export function subscribeEvents(l: (e: GameEvent) => void) {
  eventListeners.add(l);
  return () => eventListeners.delete(l);
}
export function emitEvent(e: GameEvent) {
  eventListeners.forEach((l) => l(e));
}


export type StatsListener = () => void;
const listeners = new Set<StatsListener>();
export function subscribeStats(l: StatsListener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function notifyStats() {
  listeners.forEach((l) => l());
}

// World mode
export type Mode =
  | "open"
  | "race-prompt"
  | "race-countdown"
  | "race-running"
  | "race-win"
  | "race-lose";

export const world = {
  mode: "open" as Mode,
  countdown: 5,
  raceTime: 0,
  raceFinishZ: -240,
  playerHp: 100,
  enemyHp: 100,
  nearEnemyId: -1 as number,
  fightingId: -1 as number,
  // When true, Buffalo will reset its yaw to face -Z (down the race track) next frame.
  pendingYawReset: false,
};

const modeListeners = new Set<() => void>();
export function subscribeMode(l: () => void) {
  modeListeners.add(l);
  return () => modeListeners.delete(l);
}
export function setMode(m: Mode) {
  world.mode = m;
  modeListeners.forEach((l) => l());
}
export function notifyMode() {
  modeListeners.forEach((l) => l());
}
