// Buffalo skin catalog. Colors are used by Buffalo.tsx for fur tinting.
export type Skin = {
  id: string;
  name: string;
  emoji: string;
  price: number;
  dark: string;
  light: string;
  hornColor?: string;
};

export const SKINS: Skin[] = [
  { id: "classic", name: "Classic Brown", emoji: "🐃", price: 0, dark: "#3d2a1f", light: "#5a3d2a", hornColor: "#f4e6c8" },
  { id: "midnight", name: "Midnight Black", emoji: "🌑", price: 200, dark: "#16110b", light: "#2c1f15", hornColor: "#dcd0a8" },
  { id: "albino", name: "Albino Spirit", emoji: "👻", price: 400, dark: "#e8dcc8", light: "#f4ead6", hornColor: "#bda57a" },
  { id: "golden", name: "Golden Royal", emoji: "👑", price: 700, dark: "#8b6914", light: "#c9a236", hornColor: "#fff4c0" },
  { id: "crimson", name: "Crimson Beast", emoji: "🔥", price: 1200, dark: "#5a1a1a", light: "#8b2a2a", hornColor: "#1a0808" },
];

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
