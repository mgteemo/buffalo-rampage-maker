import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BuffaloHandle } from "./Buffalo";
import { input } from "./gameState";

export function FollowCamera({ targetRef }: { targetRef: React.MutableRefObject<BuffaloHandle> }) {
  const { camera } = useThree();
  const current = useRef(new THREE.Vector3(0, 6, -10));
  const lookAt = useRef(new THREE.Vector3());
  const cameraYaw = useRef(0);

  useFrame((_, dt) => {
    const buf = targetRef.current.group;
    if (!buf) return;

    // Camera always trails directly behind the player's facing direction.
    const targetYaw = buf.rotation.y;
    const diff = Math.atan2(Math.sin(targetYaw - cameraYaw.current), Math.cos(targetYaw - cameraYaw.current));
    cameraYaw.current += diff * Math.min(1, dt * 7);

    const move = input.move;
    const mag = Math.min(1, Math.hypot(move.x, move.y));
    const followDistance = mag > 0.08 ? 8.5 : 7;
    const offset = new THREE.Vector3(
      -Math.sin(cameraYaw.current) * followDistance,
      4.6,
      -Math.cos(cameraYaw.current) * followDistance,
    );
    const desired = buf.position.clone().add(offset);
    current.current.lerp(desired, Math.min(1, dt * 4));
    camera.position.copy(current.current);

    const lookAhead = new THREE.Vector3(Math.sin(cameraYaw.current), 0, Math.cos(cameraYaw.current)).multiplyScalar(mag * 3);
    const target = buf.position.clone().add(new THREE.Vector3(0, 1, 0)).add(lookAhead);
    lookAt.current.lerp(target, Math.min(1, dt * 6));
    camera.lookAt(lookAt.current);
  });


  return null;
}
