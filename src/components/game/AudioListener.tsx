import { useFrame } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import type { BuffaloHandle } from "./Buffalo";
import { audio } from "./audio";

export function AudioListener({ buffaloRef }: { buffaloRef: MutableRefObject<BuffaloHandle> }) {
  useFrame(() => {
    const g = buffaloRef.current.group;
    if (!g) return;
    audio.setListener(g.position.x, g.position.y + 1.2, g.position.z, g.rotation.y);
  });
  return null;
}
