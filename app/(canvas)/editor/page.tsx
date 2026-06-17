"use client";

/**
 * Canvas route (DEV-1137, FR-1). Mounts the Excalidraw editor + equipment
 * palette CLIENT-SIDE ONLY: Excalidraw crashes under SSR (CLAUDE.md fact #2),
 * so the wrapper is loaded via `dynamic(..., { ssr:false })`.
 *
 * This route is the editor shell only. Canonical diagram state, persistence,
 * sync, and metadata are owned by other tasks (DEV-1135/1136/1151); this task
 * renders the canvas and the palette and wires palette → placement.
 */
import dynamic from "next/dynamic";

const PidCanvas = dynamic(
  () => import("@/components/canvas/pid-canvas").then((m) => m.PidCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-gray-500">
        Loading canvas…
      </div>
    ),
  },
);

export default function CanvasPage() {
  return <PidCanvas />;
}
