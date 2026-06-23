// Realtime config (DEV-1192) — Supabase Realtime Broadcast transport.
//
// Vercel serverless can't host a long-lived WebSocket, so realtime delivery of
// "this diagram changed" pings runs over Supabase Realtime Broadcast channels
// (transport-only — independent of our Neon Postgres, which rules out Supabase's
// Postgres-changes feature). When the env isn't configured everything degrades
// to polling, so the app works with or without realtime.
//
// SECURITY: the channel carries only a content-free ping (no diagram data). The
// browser reacts by re-fetching through the existing authenticated, account-
// scoped server action — so even a public broadcast channel leaks nothing.

/** Public Supabase project URL (browser-safe; also used for the REST publish). */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
/** Public anon key (browser-safe). Sufficient for public broadcast subscribe +
 * the REST broadcast publish used here. */
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when both Supabase values are present — else callers fall back to polling. */
export function isRealtimeConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/** The resolved Supabase credentials, or null when not configured. */
export function realtimeConfig(): { url: string; anonKey: string } | null {
  return isRealtimeConfigured()
    ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
    : null;
}

/** Broadcast channel topic for a diagram — one channel per diagram. */
export function diagramTopic(diagramId: string): string {
  return `diagram:${diagramId}`;
}

/** The single broadcast event name carried on a diagram channel. */
export const DIAGRAM_CHANGED_EVENT = "changed";
