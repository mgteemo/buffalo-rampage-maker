import { stats, subscribeStats } from "./gameState";

export type Mission = {
  id: string;
  title: string;
  description: string;
  goal: number;
  reward: string;
  getProgress: () => number;
};

// Mission ideas — chained progression of escalating chaos.
export const MISSIONS: Mission[] = [
  {
    id: "first-stomp",
    title: "First Stomp",
    description: "Trample 25 rice crops in the paddy field.",
    goal: 25,
    reward: "🌾 Mud-Hoof Badge",
    getProgress: () => stats.cropsTrampled,
  },
  {
    id: "tractor-trouble",
    title: "Tractor Trouble",
    description: "Ram and wreck 1 tractor.",
    goal: 1,
    reward: "🚜 Scrapyard Stomper",
    getProgress: () => stats.destroyed,
  },
  {
    id: "harvest-havoc",
    title: "Harvest Havoc",
    description: "Trample 100 crops to ruin the harvest.",
    goal: 100,
    reward: "🌾🌾 Field Tyrant",
    getProgress: () => stats.cropsTrampled,
  },
  {
    id: "machine-mayhem",
    title: "Machine Mayhem",
    description: "Wreck 5 pieces of machinery.",
    goal: 5,
    reward: "💥 Demolition Bull",
    getProgress: () => stats.destroyed,
  },
  {
    id: "paddy-apocalypse",
    title: "Paddy Apocalypse",
    description: "Trample 300 crops AND wreck 10 machines.",
    goal: 310,
    reward: "👑 Menace of the Fields",
    getProgress: () => stats.cropsTrampled + stats.destroyed * 30,
  },
];

export type MissionListener = (m: Mission, completed: Mission[]) => void;

class MissionTracker {
  index = 0;
  completed: Mission[] = [];
  listeners = new Set<MissionListener>();
  unsub: (() => void) | null = null;

  start() {
    if (this.unsub) return;
    this.unsub = subscribeStats(() => this.tick()) as () => void;
  }
  stop() {
    this.unsub?.();
    this.unsub = null;
  }
  current(): Mission | null {
    return this.index < MISSIONS.length ? MISSIONS[this.index] : null;
  }
  tick() {
    const cur = this.current();
    if (!cur) return this.emit();
    if (cur.getProgress() >= cur.goal) {
      this.completed.push(cur);
      this.index++;
    }
    this.emit();
  }
  emit() {
    const cur = this.current();
    if (cur) this.listeners.forEach((l) => l(cur, this.completed));
  }
  subscribe(l: MissionListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const missionTracker = new MissionTracker();
