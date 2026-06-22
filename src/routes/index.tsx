import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { audio } from "@/components/game/audio";
import { CinematicIntro } from "@/components/game/CinematicIntro";

const Game = lazy(() => import("@/components/game/Game").then((module) => ({ default: module.Game })));

async function requestLandscapeMode() {
  if (typeof window === "undefined") return;
  try {
    const element = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const requestFullscreen = element.requestFullscreen?.bind(element) ?? element.webkitRequestFullscreen?.bind(element);
    if (!document.fullscreenElement) await requestFullscreen?.();

    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    await orientation.lock?.("landscape");
  } catch {
    // Some mobile browsers and embedded previews do not allow orientation locking.
  }
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Buffalo Simulator: The Paddy Field Menace" },
      {
        name: "description",
        content:
          "Mobile 3D buffalo rampage in the paddy fields. Trample crops, ram tractors, and wreck combine harvesters.",
      },
      { property: "og:title", content: "Buffalo Simulator: The Paddy Field Menace" },
      {
        property: "og:description",
        content: "Mobile 3D buffalo rampage — trample crops and ram farm machinery.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [phase, setPhase] = useState<"title" | "cinematic" | "game">("title");

  if (phase === "title") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-amber-600 via-amber-700 to-emerald-900 px-6 text-center text-white">
        <h1 className="text-4xl font-extrabold tracking-tight drop-shadow-lg sm:text-5xl">
          🐃 Buffalo Simulator
        </h1>
        <p className="mt-2 text-xl font-semibold opacity-90">The Paddy Field Menace</p>
        <p className="mt-6 max-w-sm text-sm opacity-80">
          A water buffalo's story of revenge begins on a smoky highway...
        </p>
        <button
          onClick={() => {
            audio.init();
            void audio.resume();
            void requestLandscapeMode();
            setPhase("cinematic");
          }}
          className="mt-10 rounded-full bg-red-600 px-10 py-4 text-lg font-bold shadow-2xl ring-4 ring-red-400/50 transition hover:bg-red-700 active:scale-95"
        >
          BEGIN THE STORY
        </button>
        <p className="mt-8 text-xs opacity-60">Best on a phone in landscape mode.</p>
      </div>
    );
  }

  if (phase === "cinematic") {
    return <CinematicIntro onDone={() => setPhase("game")} />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-amber-700 to-emerald-800 text-white">
          <div className="text-lg font-semibold">Starting buffalo rampage…</div>
        </div>
      }
    >
      <Game />
    </Suspense>
  );
}
