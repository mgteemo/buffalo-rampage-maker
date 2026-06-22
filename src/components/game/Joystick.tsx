import { useCallback, useEffect, useRef, useState } from "react";

export type JoystickVec = { x: number; y: number };

type Dir = "up" | "down" | "left" | "right";

// 4-way arrow D-Pad. Emits unit vector matching previous joystick interface
// (x = right, y = down in screen space; buffalo uses y as forward axis).
export function Joystick({ onChange }: { onChange: (v: JoystickVec) => void }) {
  const active = useRef<Set<Dir>>(new Set());
  // Track which pointerId is holding each direction so a tap on an unrelated
  // button (Jump/Ram/Fight) does NOT release the joystick.
  const dirIds = useRef<Map<Dir, number>>(new Map());
  const [, force] = useState(0);

  const emit = useCallback(() => {
    let x = 0;
    let y = 0;
    if (active.current.has("left")) x -= 1;
    if (active.current.has("right")) x += 1;
    if (active.current.has("up")) y -= 1;
    if (active.current.has("down")) y += 1;
    const m = Math.hypot(x, y) || 1;
    onChange({ x: x / m, y: y / m });
    force((n) => n + 1);
  }, [onChange]);

  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      let changed = false;
      for (const [d, id] of dirIds.current) {
        if (id === e.pointerId) {
          dirIds.current.delete(d);
          active.current.delete(d);
          changed = true;
        }
      }
      if (changed) emit();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [emit]);

  const press = (d: Dir) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    active.current.add(d);
    dirIds.current.set(d, e.pointerId);
    emit();
  };
  const release = (d: Dir) => (e: React.PointerEvent) => {
    if (!active.current.has(d)) return;
    const id = dirIds.current.get(d);
    if (id !== undefined && id !== e.pointerId) return;
    active.current.delete(d);
    dirIds.current.delete(d);
    emit();
  };

  const btn = (d: Dir, label: string, cls: string) => (
    <button
      onPointerDown={press(d)}
      onPointerUp={release(d)}
      onPointerLeave={release(d)}
      className={`pointer-events-auto flex items-center justify-center rounded-2xl bg-black/55 border-2 border-white/40 text-white text-2xl font-black backdrop-blur-sm active:bg-red-600 active:scale-95 touch-none select-none shadow-lg ${cls} ${
        active.current.has(d) ? "bg-red-600/80" : ""
      }`}
      style={{ touchAction: "none", width: 56, height: 56 }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="pointer-events-none grid gap-1.5"
      style={{
        gridTemplateColumns: "56px 56px 56px",
        gridTemplateRows: "56px 56px 56px",
      }}
    >
      <div />
      {btn("up", "▲", "")}
      <div />
      {btn("left", "◀", "")}
      <div />
      {btn("right", "▶", "")}
      <div />
      {btn("down", "▼", "")}
      <div />
    </div>
  );
}
