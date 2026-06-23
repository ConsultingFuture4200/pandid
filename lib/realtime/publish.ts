// Server-side realtime publish (DEV-1192).
//
// Sends a content-free "changed" ping to a diagram's broadcast channel via the
// Supabase Realtime REST endpoint — plain HTTPS, so it works from a Vercel
// serverless function (where a persistent socket cannot live). Called after any
// change a viewer should see promptly: a proposal staged/decided, or a commit.
//
// Fire-and-forget + fully guarded: a realtime failure (or no config) must NEVER
// break the commit/stage it follows — the editor's safety poll still catches up.

import {
  DIAGRAM_CHANGED_EVENT,
  diagramTopic,
  realtimeConfig,
} from "./config";

/**
 * Broadcast "this diagram changed" to its channel. No-op when realtime isn't
 * configured; swallows transport errors (logs once) so it can't fail a commit.
 */
export async function publishDiagramChange(diagramId: string): Promise<void> {
  const config = realtimeConfig();
  if (config === null || diagramId.length === 0) {
    return;
  }
  try {
    await fetch(`${config.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: diagramTopic(diagramId),
            event: DIAGRAM_CHANGED_EVENT,
            // Ping only — no diagram data crosses the channel (see config.ts).
            payload: {},
          },
        ],
      }),
    });
  } catch (error) {
    // Realtime is best-effort; the change is already committed, and the poll is
    // the fallback. Never propagate.
    console.error("publishDiagramChange failed (non-fatal):", error);
  }
}
